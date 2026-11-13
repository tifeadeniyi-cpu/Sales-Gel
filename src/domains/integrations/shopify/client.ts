import "server-only";
import { hmacSha256, safeEqual } from "@/server/crypto";

/** Shopify Admin GraphQL API version (latest stable when Phase 6 was built; Shopify falls forward if retired). */
export const SHOPIFY_API_VERSION = "2026-10";
export const SHOPIFY_SCOPES = ["read_orders", "read_products", "read_customers"] as const;

export function shopifyConfig() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Accepts "store", "store.myshopify.com" or an admin URL; returns "store.myshopify.com" or null. */
export function normalizeShopDomain(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const admin = input.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i);
  if (admin) s = admin[1].toLowerCase();
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

export function authorizeUrl(shop: string, state: string, redirectUri: string) {
  const cfg = shopifyConfig()!;
  const q = new URLSearchParams({ client_id: cfg.clientId, scope: SHOPIFY_SCOPES.join(","), redirect_uri: redirectUri, state });
  return `https://${shop}/admin/oauth/authorize?${q}`;
}

/** Validates the `hmac` Shopify adds to OAuth callback query strings (hex HMAC of the sorted params). */
export function verifyCallbackHmac(params: URLSearchParams, secret: string) {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const message = [...params.entries()].filter(([k]) => k !== "hmac" && k !== "signature").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return safeEqual(hmacSha256(secret, message, "hex"), hmac);
}

/** Webhook deliveries: base64 HMAC-SHA256 of the raw body with the app secret. */
export function verifyWebhookHmac(rawBody: string, header: string | null, secret: string) {
  if (!header) return false;
  return safeEqual(hmacSha256(secret, rawBody, "base64"), header);
}

export interface ShopifyTokens { accessToken: string; refreshToken: string | null; expiresAt: string | null; refreshExpiresAt: string | null; scope: string }

async function tokenRequest(shop: string, body: Record<string, string>): Promise<ShopifyTokens> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new ShopifyAuthError(res.status === 401 || res.status === 400 ? "reauthorize" : "retry", `Shopify token request failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope: string };
  const now = Date.now();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(now + j.expires_in * 1000).toISOString() : null,
    refreshExpiresAt: j.refresh_token_expires_in ? new Date(now + j.refresh_token_expires_in * 1000).toISOString() : null,
    scope: j.scope,
  };
}

export class ShopifyAuthError extends Error {
  constructor(public kind: "reauthorize" | "retry", message: string) { super(message); }
}

/** Exchanges the OAuth code for an expiring offline token (with refresh token). */
export function exchangeCode(shop: string, code: string) {
  const cfg = shopifyConfig()!;
  return tokenRequest(shop, { client_id: cfg.clientId, client_secret: cfg.clientSecret, code, expiring: "1" });
}

export function refreshTokens(shop: string, refreshToken: string) {
  const cfg = shopifyConfig()!;
  return tokenRequest(shop, { client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
}

export function missingScopes(granted: string) {
  const g = granted.split(",").map((s) => s.trim());
  return SHOPIFY_SCOPES.filter((s) => !g.includes(s) && !(s.startsWith("read_") && g.includes(`write_${s.slice(5)}`)));
}

export class ShopifyApiError extends Error {
  constructor(public status: number, message: string, public throttled = false) { super(message); }
}

export async function shopifyGraphql<T>(shop: string, accessToken: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new ShopifyAuthError("reauthorize", "Shopify rejected the access token");
  if (res.status === 429) throw new ShopifyApiError(429, "Shopify rate limit", true);
  if (!res.ok) throw new ShopifyApiError(res.status, `Shopify GraphQL request failed (${res.status})`);
  const j = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (j.errors?.length) {
    const throttled = j.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new ShopifyApiError(200, j.errors.map((e) => e.message).join("; "), throttled);
  }
  return j.data as T;
}
