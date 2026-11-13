import "server-only";
import { eq } from "drizzle-orm";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { appUrl } from "@/server/app-url";
import { encryptionConfigured, hmacSha256, safeEqual } from "@/server/crypto";
import { withScope, withTenant } from "@/server/db/tenant";
import { ConflictError, ValidationError } from "@/server/errors";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { activeConnection, markDisconnected, needManage, upsertConnection } from "../connections";
import { integrationConnections } from "../schema";
import { accessTokenFor } from "./sync";
import { authorizeUrl, exchangeCode, missingScopes, normalizeShopDomain, shopifyConfig, verifyCallbackHmac } from "./client";

export const SHOPIFY_STATE_COOKIE = "sg_shopify_oauth";
const STATE_TTL_MS = 10 * 60_000;

export const shopifyRedirectUri = () => `${appUrl()}/api/integrations/shopify/callback`;

function stateSecret() {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new ConflictError("Server secret missing.");
  return s;
}

interface OAuthState { org: string; slug: string; user: string; shop: string; nonce: string; exp: number }

export function signState(s: OAuthState) {
  const body = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${body}.${hmacSha256(stateSecret(), body, "base64").replace(/=+$/, "")}`;
}
export function readState(cookie: string | undefined): OAuthState | null {
  if (!cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig || !safeEqual(hmacSha256(stateSecret(), body, "base64").replace(/=+$/, ""), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** Step 1: validate the store domain and build the Shopify install/authorize URL plus a signed state cookie. */
export function startShopifyConnect(ctx: OrgContext, input: { shop: string }) {
  needManage(ctx);
  if (!shopifyConfig()) throw new ConflictError("The Shopify app isn't configured on this server yet.");
  if (!encryptionConfigured()) throw new ConflictError("Integrations aren't configured on this server yet (missing encryption key).");
  const shop = normalizeShopDomain(input.shop ?? "");
  if (!shop) throw new ValidationError("Enter your store's myshopify.com domain.", { shop: ["Use the form your-store.myshopify.com."] });
  const nonce = crypto.randomUUID();
  const cookie = signState({ org: ctx.orgId, slug: ctx.orgSlug, user: ctx.userId, shop, nonce, exp: Date.now() + STATE_TTL_MS });
  return { url: authorizeUrl(shop, nonce, shopifyRedirectUri()), cookie, maxAge: STATE_TTL_MS / 1000 };
}

/**
 * Step 2 (callback): checks Shopify's HMAC, our state nonce, and that the shop matches what the
 * user typed; then exchanges the code for an expiring offline token and stores it encrypted.
 */
export async function completeShopifyConnect(ctx: OrgContext, params: URLSearchParams, stateCookie: string | undefined) {
  needManage(ctx);
  const cfg = shopifyConfig();
  if (!cfg) throw new ConflictError("The Shopify app isn't configured on this server yet.");
  const state = readState(stateCookie);
  const shop = normalizeShopDomain(params.get("shop") ?? "");
  if (!state || state.org !== ctx.orgId || state.user !== ctx.userId) throw new ValidationError("This Shopify connection request expired. Start again.");
  if (!verifyCallbackHmac(params, cfg.clientSecret)) throw new ValidationError("Shopify's response couldn't be verified.");
  if (!params.get("state") || !safeEqual(params.get("state")!, state.nonce)) throw new ValidationError("This Shopify connection request expired. Start again.");
  if (!shop || shop !== state.shop) throw new ValidationError("The store that responded doesn't match the one you entered.");
  const code = params.get("code");
  if (!code) throw new ValidationError("Shopify didn't return an authorization code.");
  const tokens = await exchangeCode(shop, code);
  const missing = missingScopes(tokens.scope);
  if (missing.length) throw new ValidationError(`SalesGel needs these Shopify permissions: ${missing.join(", ")}.`);
  return withTenant(ctx, async (tx) => {
    const id = await upsertConnection(tx, ctx.orgId, {
      provider: "shopify", externalAccountId: shop, displayName: shop, credentials: tokens, scopes: tokens.scope.split(","), userId: ctx.userId,
    });
    await audit(tx, ctx, { action: "integration.connected", entityType: "integration", entityId: id, metadata: { provider: "shopify", shop } });
    await enqueue(tx, ctx.orgId, "shopify.setup", { connectionId: id }, { idempotencyKey: `shopify-setup:${id}:${Date.now()}` });
    return { id, shop };
  });
}

export async function disconnectShopify(ctx: OrgContext) {
  needManage(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await activeConnection(tx, ctx.orgId, "shopify");
    if (!c) return { ok: true };
    await markDisconnected(tx, c.id);
    await audit(tx, ctx, { action: "integration.disconnected", entityType: "integration", entityId: c.id, metadata: { provider: "shopify", shop: c.externalAccountId } });
    return { ok: true, note: "Imported records stay in SalesGel. Uninstall the app in Shopify to revoke its access." };
  });
}

/** Background: reads shop details (currency, name), then starts the initial import. */
export async function runShopifySetup(job: JobContext) {
  const { connectionId } = job.payload as { connectionId: string };
  const conn = await withScope({ orgId: job.orgId }, async (tx) => {
    const [c] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
    return c && c.status !== "disconnected" ? c : null;
  });
  if (!conn) return;
  const { shopifyGraphql } = await import("./client");
  const token = await accessTokenFor(conn);
  const d = await shopifyGraphql<{ shop: { name: string; currencyCode: string; ianaTimezone: string; myshopifyDomain: string } }>(conn.externalAccountId, token, "query { shop { name currencyCode ianaTimezone myshopifyDomain } }");
  await withScope({ orgId: job.orgId }, async (tx) => {
    await tx
      .update(integrationConnections)
      .set({ displayName: d.shop.name, settings: { ...(conn.settings ?? {}), currency: d.shop.currencyCode, timezone: d.shop.ianaTimezone, shopName: d.shop.name }, updatedAt: new Date() })
      .where(eq(integrationConnections.id, conn.id));
    await enqueue(tx, job.orgId, "shopify.sync", { connectionId: conn.id, mode: "backfill" }, { idempotencyKey: `shopify-backfill:${conn.id}:${job.jobId}` });
  });
}

/** Queues an incremental import now (last 3 days of changes, plus anything a webhook missed). */
export async function syncShopifyNow(ctx: OrgContext) {
  needManage(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await activeConnection(tx, ctx.orgId, "shopify");
    if (!c || c.status === "disconnected") throw new ConflictError("Shopify isn't connected.");
    const minute = new Date().toISOString().slice(0, 16);
    await enqueue(tx, ctx.orgId, "shopify.sync", { connectionId: c.id, mode: "incremental", since: new Date(Date.now() - 3 * 86_400_000).toISOString() }, { idempotencyKey: `shopify-sync-now:${c.id}:${minute}` });
    return { ok: true };
  });
}
