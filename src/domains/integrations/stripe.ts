import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { orders } from "@/domains/commerce/schema";
import { recordProviderPayment, recordProviderRefund } from "@/domains/commerce/orders";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { appUrl } from "@/server/app-url";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { encryptionConfigured } from "@/server/crypto";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { formatMoney } from "@/lib/money";
import { parseInput } from "@/server/validate";
import { activeConnection, credentialsOf, markDisconnected, needManage, upsertConnection } from "./connections";
import { paymentLinks } from "./schema";

export const STRIPE_API_VERSION = "2026-10-28.endive" as const;
/** Events the per-workspace webhook endpoint subscribes to. */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
] as const;

interface StripeCreds { apiKey: string; webhookSecret: string; webhookEndpointId: string; livemode: boolean }

/** One client instance per call (never the deprecated global key pattern). Uses fetch so tests can stub the network. */
export function stripeClient(apiKey: string) {
  return new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION, httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, appInfo: { name: "SalesGel" } });
}

const connectSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/, "Paste a Stripe restricted key (starts with rk_live_ or rk_test_)"),
});

function stripeErrorMessage(err: unknown) {
  if (err instanceof Stripe.errors.StripeAuthenticationError) return "Stripe rejected this key. Check that you copied the whole key.";
  if (err instanceof Stripe.errors.StripePermissionError) return "This key is missing permissions. Give the restricted key write access to Checkout Sessions and Webhook Endpoints, and read access to Refunds.";
  if (err instanceof Stripe.errors.StripeConnectionError) return "Couldn't reach Stripe. Try again in a moment.";
  if (err instanceof Stripe.errors.StripeError) return err.message;
  return err instanceof Error ? err.message : "Stripe request failed";
}

/**
 * Connects the workspace's own Stripe account with a restricted API key. SalesGel creates the
 * webhook endpoint itself (so the signing secret is never pasted around) and stores the key and
 * secret encrypted.
 */
export async function connectStripe(ctx: OrgContext, input: { apiKey: string }) {
  needManage(ctx);
  if (!encryptionConfigured()) throw new ConflictError("Integrations aren't configured on this server yet (missing encryption key).");
  const { apiKey } = parseInput(connectSchema, input);
  const client = stripeClient(apiKey);
  const connectionId = await withTenant(ctx, async (tx) => (await activeConnection(tx, ctx.orgId, "stripe"))?.id ?? null);
  // Create the endpoint first; the connection id goes in the URL so deliveries route to this workspace.
  const pendingId = connectionId ?? crypto.randomUUID();
  let endpoint: Stripe.WebhookEndpoint;
  try {
    endpoint = await client.webhookEndpoints.create({
      url: `${appUrl()}/api/webhooks/stripe/${pendingId}`,
      enabled_events: [...STRIPE_EVENTS],
      description: `SalesGel · ${ctx.orgName}`,
      metadata: { salesgel_org: ctx.orgId },
    });
  } catch (err) {
    throw new ValidationError(stripeErrorMessage(err), { apiKey: [stripeErrorMessage(err)] });
  }
  return withTenant(ctx, async (tx) => {
    const previous = await activeConnection(tx, ctx.orgId, "stripe");
    const creds: StripeCreds = { apiKey, webhookSecret: endpoint.secret!, webhookEndpointId: endpoint.id, livemode: endpoint.livemode };
    const id = await upsertConnection(tx, ctx.orgId, {
      id: pendingId, provider: "stripe", externalAccountId: endpoint.id, displayName: endpoint.livemode ? "Stripe (live)" : "Stripe (test mode)",
      credentials: creds, settings: { livemode: endpoint.livemode }, userId: ctx.userId,
    });
    await audit(tx, ctx, { action: "integration.connected", entityType: "integration", entityId: id, metadata: { provider: "stripe", livemode: endpoint.livemode, keyType: apiKey.slice(0, 2) } });
    // Remove the old endpoint we created previously (best effort, after the new one is stored).
    if (previous && previous.id === id) {
      const old = credentialsOf<StripeCreds>(previous);
      if (old.webhookEndpointId !== endpoint.id) await stripeClient(old.apiKey).webhookEndpoints.del(old.webhookEndpointId).catch(() => undefined);
    }
    return { id, livemode: endpoint.livemode, warning: apiKey.startsWith("sk_") ? "You used a secret key. A restricted key with only the needed permissions is safer." : null };
  });
}

export async function disconnectStripe(ctx: OrgContext) {
  needManage(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await activeConnection(tx, ctx.orgId, "stripe");
    if (!c) return;
    const creds = credentialsOf<StripeCreds>(c);
    await stripeClient(creds.apiKey).webhookEndpoints.del(creds.webhookEndpointId).catch(() => undefined);
    await markDisconnected(tx, c.id);
    await audit(tx, ctx, { action: "integration.disconnected", entityType: "integration", entityId: c.id, metadata: { provider: "stripe" } });
  });
}

/** Verifies a delivery against the connection's signing secret. Throws on a bad signature. */
export function verifyStripeEvent(rawBody: string, signature: string | null, webhookSecret: string): Stripe.Event {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret, 300);
}
export function stripeSecretsFor(c: { credentials: string }) {
  return credentialsOf<StripeCreds>(c);
}

const randomLetters = (n: number) => Array.from(randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join("");

/**
 * Creates a Stripe Checkout payment page for the order's current balance. Payment is recorded only
 * when Stripe's signed webhook confirms it — never when the customer lands on the return page.
 */
export async function createPaymentLink(ctx: OrgContext, orderId: string) {
  if (!ctx.permissions.has("orders.write") || !ctx.permissions.has("orders.financials")) throw new ForbiddenError(undefined, "orders.financials");
  const prep = await withTenant(ctx, async (tx) => {
    const c = await activeConnection(tx, ctx.orgId, "stripe");
    if (!c || c.status !== "active") throw new ConflictError("Connect Stripe in Apps & Integrations to send payment links.");
    const [o] = await tx.select().from(orders).where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, orderId)));
    if (!o) throw new ValidationError("Order not found.");
    if (o.orderStatus === "cancelled") throw new ConflictError("This order is cancelled.");
    const due = o.totalAmount - (o.paidAmount - o.refundedAmount);
    if (due <= 0) throw new ConflictError("Nothing is due on this order.");
    // Reuse a still-open link for the same amount instead of creating duplicates.
    const [open] = await tx
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.organizationId, ctx.orgId), eq(paymentLinks.orderId, o.id), eq(paymentLinks.status, "open"), eq(paymentLinks.amount, due), gt(paymentLinks.expiresAt, new Date(Date.now() + 10 * 60_000))))
      .orderBy(desc(paymentLinks.createdAt))
      .limit(1);
    return { c, o, due, open };
  });
  if (prep.open) return { id: prep.open.id, url: prep.open.url, amount: prep.open.amount, currency: prep.open.currency, reused: true };
  const { c, o, due } = prep;
  const creds = credentialsOf<StripeCreds>(c);
  const linkId = crypto.randomUUID();
  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient(creds.apiKey).checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: o.currency.toLowerCase(), unit_amount: due, product_data: { name: `Order ORD-${o.number}`, description: `${ctx.orgName} · balance due` } } }],
        client_reference_id: o.id,
        customer_email: o.contactEmail ?? undefined,
        metadata: { salesgel_org: ctx.orgId, salesgel_order: o.id, salesgel_link: linkId },
        payment_intent_data: { metadata: { salesgel_org: ctx.orgId, salesgel_order: o.id, salesgel_link: linkId } },
        success_url: `${appUrl()}/pay/complete?status=paid`,
        cancel_url: `${appUrl()}/pay/complete?status=cancelled`,
        integration_identifier: `salesgel_order_link_${randomLetters(8)}`,
      },
      { idempotencyKey: `salesgel-link-${linkId}` },
    );
  } catch (err) {
    throw new ConflictError(stripeErrorMessage(err));
  }
  return withTenant(ctx, async (tx) => {
    await tx.insert(paymentLinks).values({
      id: linkId, organizationId: ctx.orgId, orderId: o.id, connectionId: c.id, provider: "stripe", providerSessionId: session.id, url: session.url!, amount: due,
      currency: o.currency, status: "open", expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null, createdByUserId: ctx.userId,
    });
    await audit(tx, ctx, { action: "payment_link.created", entityType: "order", entityId: o.id, metadata: { linkId, amount: due, currency: o.currency, provider: "stripe" } });
    return { id: linkId, url: session.url!, amount: due, currency: o.currency, reused: false };
  });
}

export async function listPaymentLinks(ctx: OrgContext, orderId: string) {
  if (!ctx.permissions.has("orders.financials")) return [];
  return withTenant(ctx, (tx) => tx.select().from(paymentLinks).where(and(eq(paymentLinks.organizationId, ctx.orgId), eq(paymentLinks.orderId, orderId))).orderBy(desc(paymentLinks.createdAt)));
}

/** Applies one verified Stripe event inside the workspace's tenant scope. */
export async function applyStripeEvent(tx: Tx, orgId: string, connectionId: string, event: Stripe.Event): Promise<"processed" | "ignored"> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== "paid") return "ignored"; // delayed methods: wait for async_payment_succeeded
      const orderId = s.metadata?.salesgel_order;
      if (!orderId || s.metadata?.salesgel_org !== orgId) return "ignored";
      const providerPaymentId = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? s.id);
      const res = await recordProviderPayment(tx, orgId, { orderId, provider: "stripe", providerPaymentId, amount: s.amount_total ?? 0, currency: s.currency ?? "", method: "payment_link", reference: s.id, receivedAt: new Date(event.created * 1000) });
      await tx.update(paymentLinks).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(and(eq(paymentLinks.provider, "stripe"), eq(paymentLinks.providerSessionId, s.id)));
      if (!res.duplicate && "order" in res && res.order) await notifyPaid(tx, orgId, res.order, s.amount_total ?? 0);
      return "processed";
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      await tx
        .update(paymentLinks)
        .set({ status: event.type === "checkout.session.expired" ? "expired" : "failed", updatedAt: new Date() })
        .where(and(eq(paymentLinks.organizationId, orgId), eq(paymentLinks.provider, "stripe"), eq(paymentLinks.providerSessionId, s.id), eq(paymentLinks.status, "open")));
      return "processed";
    }
    case "refund.created":
    case "refund.updated": {
      const r = event.data.object as Stripe.Refund;
      if (r.status !== "succeeded") return "ignored";
      const pi = typeof r.payment_intent === "string" ? r.payment_intent : r.payment_intent?.id;
      if (!pi) return "ignored";
      const res = await recordProviderRefund(tx, orgId, { provider: "stripe", providerRefundId: r.id, providerPaymentId: pi, amount: r.amount, currency: r.currency, reason: r.reason ? `Stripe: ${r.reason.replace(/_/g, " ")}` : null });
      return res.id ? "processed" : "ignored";
    }
    default:
      void connectionId;
      return "ignored";
  }
}

async function notifyPaid(tx: Tx, orgId: string, o: typeof orders.$inferSelect, amount: number) {
  const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  const recipients = new Set<string>();
  if (o.assignedMembershipId) {
    const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, o.assignedMembershipId));
    if (m) recipients.add(m.userId);
  }
  if (o.createdByUserId) recipients.add(o.createdByUserId);
  for (const userId of recipients) {
    await notify(tx, { orgId, recipientUserId: userId, type: "payment.received", title: `ORD-${o.number} paid ${formatMoney(amount, o.currency)} via Stripe`, link: `/o/${org.slug}/orders/${o.id}`, entityType: "order", entityId: o.id });
  }
}

/** Whether this workspace can create payment links right now (active Stripe connection). */
export async function stripeReady(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => (await activeConnection(tx, ctx.orgId, "stripe"))?.status === "active");
}
