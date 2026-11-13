import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { createCustomer } from "@/domains/customers/service";
import { createProduct, getProduct } from "@/domains/commerce/products";
import { createOrder, getOrder, listOrders, recordPayment } from "@/domains/commerce/orders";
import { orders, payments, refunds } from "@/domains/commerce/schema";
import { customers } from "@/domains/customers/schema";
import { listConnections, markDisconnected, resolveRoute } from "@/domains/integrations/connections";
import { integrationConnections, integrationRoutes, jobs, paymentLinks, webhookEvents } from "@/domains/integrations/schema";
import { connectStripe, createPaymentLink, disconnectStripe, verifyStripeEvent } from "@/domains/integrations/stripe";
import { recordWebhook } from "@/domains/integrations/webhooks";
import { completeShopifyConnect, signState, startShopifyConnect } from "@/domains/integrations/shopify/connect";
import { applyShopifyWebhook, upsertShopifyOrder, type SOrder } from "@/domains/integrations/shopify/sync";
import { createTask } from "@/domains/tasks/service";
import { listNotifications } from "@/domains/platform/notifications";
import { withScope, withTenant } from "@/server/db/tenant";
import { JOB_HANDLERS } from "@/server/jobs/registry";
import { enqueue } from "@/server/jobs/queue";
import { runDueWork } from "@/server/jobs/worker";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];
type Responder = (url: string, init: RequestInit) => unknown;

/** Every outbound HTTP call in these tests is answered here — nothing reaches Stripe or Shopify. */
function stubFetch(routes: Record<string, Responder>) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    calls.push({ url, body });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 500 });
    const out = routes[key](url, init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  }));
  return calls;
}

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SHOPIFY_CLIENT_ID = "client-id";
  process.env.SHOPIFY_CLIENT_SECRET = "app-secret";
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
});
afterEach(() => vi.unstubAllGlobals());

async function orderWithBalance(ctx: Ctx) {
  const { id: productId } = await createProduct(ctx, { name: "Ankara Dress", variants: [{ name: "One", sku: `ANK-${randomBytes(3).toString("hex")}`, price: "45.00" }] });
  const p = (await getProduct(ctx, productId))!;
  const c = await createCustomer(ctx, { firstName: "Ada", emails: [{ email: `ada-${randomBytes(3).toString("hex")}@example.com` }] });
  const { id } = await createOrder(ctx, { customerId: c.id, lines: [{ variantId: p.variants[0].id, quantity: 2 }] });
  return id;
}

async function connectStripeFor(ctx: Ctx) {
  stubFetch({ "/v1/webhook_endpoints": () => ({ id: `we_${randomBytes(4).toString("hex")}`, object: "webhook_endpoint", secret: "whsec_test_secret", livemode: false }) });
  return connectStripe(ctx, { apiKey: "rk_test_" + "a".repeat(30) });
}

function signed(event: object, secret = "whsec_test_secret") {
  const payload = JSON.stringify(event);
  return { payload, header: Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

describe("stripe connection", () => {
  it("validates the key, creates the webhook endpoint, and stores secrets encrypted", async () => {
    const { ctx } = await createOrgWithOwner("StripeCo");
    await expect(connectStripe(ctx, { apiKey: "pk_test_nope" })).rejects.toBeInstanceOf(ValidationError);
    const calls = stubFetch({ "/v1/webhook_endpoints": () => ({ id: "we_1", object: "webhook_endpoint", secret: "whsec_test_secret", livemode: false }) });
    const res = await connectStripe(ctx, { apiKey: "rk_test_" + "a".repeat(30) });
    expect(res.livemode).toBe(false);
    expect(res.warning).toBeNull();
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("url")).toBe(`http://localhost:3000/api/webhooks/stripe/${res.id}`);
    expect(body.getAll("enabled_events[]").length + [...body.keys()].filter((k) => k.startsWith("enabled_events[")).length).toBeGreaterThan(0);
    const raw = await withTenant(ctx, async (tx) => (await tx.select().from(integrationConnections).where(eq(integrationConnections.id, res.id)))[0]);
    expect(raw.credentials).not.toContain("rk_test");
    expect(raw.credentials).not.toContain("whsec");
    const listed = await listConnections(ctx);
    expect(JSON.stringify(listed)).not.toContain("credentials");
    expect(await resolveRoute("stripe", { connectionId: res.id })).toMatchObject({ organizationId: ctx.orgId });
  });

  it("only integration managers can connect", async () => {
    const { ctx } = await createOrgWithOwner("StripePerms");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    await expect(connectStripe(rep, { apiKey: "rk_test_" + "a".repeat(30) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects webhook payloads with a bad or missing signature", () => {
    const { payload, header } = signed({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: {} } });
    expect(verifyStripeEvent(payload, header, "whsec_test_secret").id).toBe("evt_1");
    expect(() => verifyStripeEvent(payload, header, "whsec_other")).toThrow();
    expect(() => verifyStripeEvent(payload.replace("evt_1", "evt_2"), header, "whsec_test_secret")).toThrow();
    expect(() => verifyStripeEvent(payload, null, "whsec_test_secret")).toThrow();
  });
});

describe("payment links and webhook-driven payments", () => {
  it("creates one Checkout Session per balance, records payment only from the webhook, idempotently", async () => {
    const { ctx } = await createOrgWithOwner("LinkCo");
    const orderId = await orderWithBalance(ctx);
    await expect(createPaymentLink(ctx, orderId)).rejects.toBeInstanceOf(ConflictError); // not connected yet
    const conn = await connectStripeFor(ctx);

    const pi = `pi_${randomBytes(6).toString("hex")}`;
    const cs = `cs_test_${randomBytes(6).toString("hex")}`;
    const calls = stubFetch({ "/v1/checkout/sessions": () => ({ id: cs, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${cs}`, expires_at: Math.floor(Date.now() / 1000) + 86_400 }) });
    const link = await createPaymentLink(ctx, orderId);
    expect(link).toMatchObject({ amount: 9000, url: `https://checkout.stripe.com/c/pay/${cs}`, reused: false });
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("mode")).toBe("payment");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("9000");
    expect(body.get("metadata[salesgel_order]")).toBe(orderId);
    expect(body.get("integration_identifier")).toMatch(/^salesgel_order_link_[a-z]{8}$/);
    expect([...body.keys()].some((k) => k.startsWith("payment_method_types"))).toBe(false);
    expect(body.get("success_url")).toBe("http://localhost:3000/pay/complete?status=paid");
    expect((await createPaymentLink(ctx, orderId)).reused).toBe(true);

    // The success page never marks anything paid.
    expect((await getOrder(ctx, orderId))!.paymentStatus).toBe("unpaid");

    const event = {
      id: "evt_paid_1", object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), api_version: "2026-10-28.endive",
      data: { object: { id: cs, object: "checkout.session", payment_status: "paid", payment_intent: pi, amount_total: 9000, currency: "usd", metadata: { salesgel_org: ctx.orgId, salesgel_order: orderId, salesgel_link: link.id } } },
    };
    const first = await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: event.id, topic: event.type, payload: event });
    const again = await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: event.id, topic: event.type, payload: event });
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    await runDueWork({ orgId: ctx.orgId });
    const paid = (await getOrder(ctx, orderId))!;
    expect(paid.paymentStatus).toBe("paid");
    expect(paid.payments).toHaveLength(1);
    expect(paid.payments[0]).toMatchObject({ provider: "stripe", amount: 9000, method: "payment_link" });
    const ev = await withTenant(ctx, async (tx) => (await tx.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, "evt_paid_1")))[0]);
    expect(ev.status).toBe("processed");
    const [l] = await withTenant(ctx, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, link.id)));
    expect(l.status).toBe("paid");
    const notes = await listNotifications(ctx);
    expect(notes.some((n) => n.type === "payment.received")).toBe(true);

    // Same payment intent arriving via a second event id doesn't double-record.
    const dup = { ...event, id: "evt_paid_2", type: "checkout.session.async_payment_succeeded" };
    await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: dup.id, topic: dup.type, payload: dup });
    await runDueWork({ orgId: ctx.orgId });
    expect((await getOrder(ctx, orderId))!.payments).toHaveLength(1);

    // Refund from Stripe.
    const refund = { id: "evt_ref_1", object: "event", type: "refund.created", created: Math.floor(Date.now() / 1000), data: { object: { id: "re_1", object: "refund", status: "succeeded", payment_intent: pi, amount: 2500, currency: "usd", reason: "requested_by_customer" } } };
    await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: refund.id, topic: refund.type, payload: refund });
    await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: "evt_ref_1b", topic: "refund.updated", payload: { ...refund, id: "evt_ref_1b", type: "refund.updated" } });
    await runDueWork({ orgId: ctx.orgId });
    const after = (await getOrder(ctx, orderId))!;
    expect(after.refunds).toHaveLength(1);
    expect(after.refundedAmount).toBe(2500);
    expect(after.paymentStatus).toBe("partially_refunded");
  });

  it("ignores an unpaid (delayed) checkout completion and events for another workspace", async () => {
    const { ctx } = await createOrgWithOwner("DelayCo");
    const orderId = await orderWithBalance(ctx);
    const conn = await connectStripeFor(ctx);
    const mk = (id: string, org: string, status: string) => ({ id, object: "event", type: "checkout.session.completed", created: 1, data: { object: { id: `cs_${id}`, payment_status: status, payment_intent: `pi_${id}`, amount_total: 9000, currency: "usd", metadata: { salesgel_org: org, salesgel_order: orderId } } } });
    await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: "e1", topic: "checkout.session.completed", payload: mk("e1", ctx.orgId, "unpaid") });
    await recordWebhook(ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: "e2", topic: "checkout.session.completed", payload: mk("e2", crypto.randomUUID(), "paid") });
    await runDueWork({ orgId: ctx.orgId });
    expect((await getOrder(ctx, orderId))!.payments).toHaveLength(0);
  });

  it("refuses a link when nothing is due, and disconnect cancels open links", async () => {
    const { ctx } = await createOrgWithOwner("DueCo");
    const orderId = await orderWithBalance(ctx);
    await connectStripeFor(ctx);
    const csx = `cs_${randomBytes(6).toString("hex")}`;
    stubFetch({ "/v1/checkout/sessions": () => ({ id: csx, url: `https://checkout.stripe.com/c/pay/${csx}`, expires_at: Math.floor(Date.now() / 1000) + 86_400 }), "/v1/webhook_endpoints": () => ({ id: "we", deleted: true }) });
    const link = await createPaymentLink(ctx, orderId);
    await disconnectStripe(ctx);
    const [l] = await withTenant(ctx, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, link.id)));
    expect(l.status).toBe("cancelled");
    const other = await orderWithBalance(ctx);
    await recordPayment(ctx, other, { amount: "90.00", method: "cash" });
    await connectStripeFor(ctx);
    await expect(createPaymentLink(ctx, other)).rejects.toThrow(/Nothing is due/);
  });

  it("keeps webhook events and payment links tenant-isolated", async () => {
    const a = await createOrgWithOwner("IsoA");
    const b = await createOrgWithOwner("IsoB");
    const conn = await connectStripeFor(a.ctx);
    await recordWebhook(a.ctx.orgId, { connectionId: conn.id, provider: "stripe", providerEventId: "iso_1", topic: "x", payload: {} });
    const seen = await withTenant(b.ctx, (tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, "iso_1")));
    expect(seen).toHaveLength(0);
    expect((await listConnections(b.ctx)).connections).toHaveLength(0);
    const conns = await withTenant(b.ctx, (tx) => tx.select().from(integrationConnections));
    expect(conns).toHaveLength(0);
  });
});

describe("job worker", () => {
  it("retries a failing job with backoff, then fails it after max attempts", async () => {
    const { ctx } = await createOrgWithOwner("JobCo");
    let calls = 0;
    JOB_HANDLERS["test.flaky"] = async () => { calls++; throw new Error("boom"); };
    try {
      const id = await withScope({ orgId: ctx.orgId }, async (tx) => {
        await enqueue(tx, ctx.orgId, "test.flaky", {}, { maxAttempts: 2, idempotencyKey: "flaky-1" });
        await enqueue(tx, ctx.orgId, "test.flaky", {}, { maxAttempts: 2, idempotencyKey: "flaky-1" }); // deduped
        return (await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.organizationId, ctx.orgId), eq(jobs.type, "test.flaky"))))
      });
      expect(id).toHaveLength(1);
      await runDueWork({ orgId: ctx.orgId });
      let [j] = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(jobs).where(eq(jobs.id, id[0].id)));
      expect(j).toMatchObject({ status: "pending", attempts: 1, lastError: "boom" });
      expect(j.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
      await withScope({ orgId: ctx.orgId }, (tx) => tx.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, j.id)));
      await runDueWork({ orgId: ctx.orgId });
      [j] = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(jobs).where(eq(jobs.id, id[0].id)));
      expect(j).toMatchObject({ status: "failed", attempts: 2 });
      expect(calls).toBe(2);
    } finally {
      delete JOB_HANDLERS["test.flaky"];
    }
  });

  it("sends task reminders to the assignee when due", async () => {
    const { ctx } = await createOrgWithOwner("RemindCo");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    await createTask(ctx, { title: "Call Bisi back", assigneeMembershipId: rep.membershipId, dueAt: new Date(Date.now() + 86_400_000).toISOString(), reminderAt: new Date(Date.now() - 5_000).toISOString() });
    await runDueWork({ orgId: ctx.orgId });
    const notes = await listNotifications(rep);
    expect(notes.find((n) => n.type === "task.due")?.title).toContain("Call Bisi back");
    // Not sent twice.
    await runDueWork({ orgId: ctx.orgId });
    expect((await listNotifications(rep)).filter((n) => n.type === "task.due")).toHaveLength(1);
  });

  it("can't discover another workspace's jobs", async () => {
    const a = await createOrgWithOwner("JobA");
    const b = await createOrgWithOwner("JobB");
    await withScope({ orgId: a.ctx.orgId }, (tx) => enqueue(tx, a.ctx.orgId, "noop", {}));
    const fromB = await withScope({ orgId: b.ctx.orgId }, (tx) => tx.select().from(jobs).where(eq(jobs.organizationId, a.ctx.orgId)));
    expect(fromB).toHaveLength(0);
  });
});

/* ───────── Shopify ───────── */

const SHOP = "ada-styles.myshopify.com";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
function shopifyOrder(over: Partial<SOrder> = {}): SOrder {
  return {
    id: "gid://shopify/Order/1001", name: "#1001", createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:05:00Z", processedAt: "2026-11-01T10:00:00Z", cancelledAt: null,
    currencyCode: "USD", email: "bola@example.com", phone: null, note: null, test: false, sourceName: "web", displayFinancialStatus: "PAID", displayFulfillmentStatus: "UNFULFILLED",
    customer: { id: "gid://shopify/Customer/77" }, shippingAddress: { address1: "1 Marina", address2: null, city: "Lagos", province: null, zip: null, countryCodeV2: "NG" },
    totalShippingPriceSet: money("5.00"), totalTaxSet: money("3.00"), totalPriceSet: money("98.00"),
    lineItems: { nodes: [{ id: "gid://shopify/LineItem/1", title: "Kaftan", variantTitle: "Default Title", sku: "KAF-1", quantity: 2, originalUnitPriceSet: money("50.00"), variant: null }] },
    transactions: [{ id: "gid://shopify/OrderTransaction/9", kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-11-01T10:00:01Z", amountSet: money("98.00"), parentTransaction: null }],
    ...over,
  };
}
const shopifyCustomer = { id: "gid://shopify/Customer/77", firstName: "Bola", lastName: "Ade", displayName: "Bola Ade", note: null, tags: [], updatedAt: "2026-11-01T09:00:00Z", defaultEmailAddress: { emailAddress: "Bola@Example.com" }, defaultPhoneNumber: null, defaultAddress: null };

async function connectShopifyFor(ctx: Ctx) {
  const { url, cookie } = startShopifyConnect(ctx, { shop: "ada-styles" });
  const nonce = new URL(url).searchParams.get("state")!;
  const p = new URLSearchParams({ code: "auth-code", shop: SHOP, state: nonce, timestamp: String(Math.floor(Date.now() / 1000)) });
  const msg = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  p.set("hmac", createHmac("sha256", "app-secret").update(msg).digest("hex"));
  stubFetch({ "/admin/oauth/access_token": () => ({ access_token: "shpat_x", refresh_token: "shprt_x", expires_in: 3600, refresh_token_expires_in: 7_776_000, scope: "read_orders,read_products,read_customers" }) });
  return { p, cookie, url };
}

describe("shopify connect", () => {
  it("runs the OAuth handshake with state, HMAC and shop checks", async () => {
    const { ctx } = await createOrgWithOwner("ShopCo");
    expect(() => startShopifyConnect(ctx, { shop: "evil.com" })).toThrow(ValidationError);
    const { p, cookie, url } = await connectShopifyFor(ctx);
    expect(url).toContain(`https://${SHOP}/admin/oauth/authorize`);
    expect(new URL(url).searchParams.get("scope")).toBe("read_orders,read_products,read_customers");

    const forged = new URLSearchParams(p);
    forged.set("shop", "other.myshopify.com");
    await expect(completeShopifyConnect(ctx, forged, cookie)).rejects.toBeInstanceOf(ValidationError); // HMAC no longer matches
    await expect(completeShopifyConnect(ctx, p, undefined)).rejects.toThrow(/expired/);
    const otherOrg = await createOrgWithOwner("ShopOther");
    await expect(completeShopifyConnect(otherOrg.ctx, p, cookie)).rejects.toBeInstanceOf(ValidationError);
    const tampered = cookie.replace(/^./, (c) => (c === "a" ? "b" : "a"));
    await expect(completeShopifyConnect(ctx, p, tampered)).rejects.toThrow(/expired/);
    const expired = signState({ org: ctx.orgId, slug: ctx.orgSlug, user: ctx.userId, shop: SHOP, nonce: p.get("state")!, exp: Date.now() - 1 });
    await expect(completeShopifyConnect(ctx, p, expired)).rejects.toThrow(/expired/);

    const res = await completeShopifyConnect(ctx, p, cookie);
    expect(res.shop).toBe(SHOP);
    expect(await resolveRoute("shopify", { externalAccountId: SHOP })).toMatchObject({ organizationId: ctx.orgId, connectionId: res.id });
    const queued = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(jobs).where(and(eq(jobs.organizationId, ctx.orgId), eq(jobs.type, "shopify.setup"))));
    expect(queued).toHaveLength(1);
  });

  it("refuses a grant that lacks required scopes", async () => {
    const { ctx } = await createOrgWithOwner("ScopeCo");
    const { p, cookie } = await connectShopifyFor(ctx);
    stubFetch({ "/admin/oauth/access_token": () => ({ access_token: "shpat_x", scope: "read_orders" }) });
    await expect(completeShopifyConnect(ctx, p, cookie)).rejects.toThrow(/read_products/);
  });
});

describe("shopify import", () => {
  async function connected() {
    const { ctx } = await createOrgWithOwner("ImportCo");
    const { p, cookie } = await connectShopifyFor(ctx);
    const { id } = await completeShopifyConnect(ctx, p, cookie);
    const conn = await withScope({ orgId: ctx.orgId }, async (tx) => (await tx.select().from(integrationConnections).where(eq(integrationConnections.id, id)))[0]);
    return { ctx, conn: conn as typeof conn & { externalAccountId: string; settings: Record<string, unknown> } };
  }

  it("maps an order with reconciled totals, payment, refund and customer match — idempotently", async () => {
    const { ctx, conn } = await connected();
    const existing = await createCustomer(ctx, { firstName: "Bola", emails: [{ email: "bola@example.com" }] });
    stubFetch({ "/graphql.json": () => ({ data: { customer: shopifyCustomer } }) });

    // Webhook path: payload only identifies the order; current state comes from GraphQL.
    stubFetch({
      "/graphql.json": (_u, init) => {
        const q = JSON.parse(String(init.body)).query as string;
        return { data: q.includes("customer(id") ? { customer: shopifyCustomer } : { order: shopifyOrder() } };
      },
    });
    const out = await withScope({ orgId: ctx.orgId }, (tx) => applyShopifyWebhook(tx, ctx.orgId, conn.id, "orders/create", { admin_graphql_api_id: "gid://shopify/Order/1001" }));
    expect(out).toBe("processed");
    const list = await listOrders(ctx, { q: "#1001" });
    expect(list.rows).toHaveLength(1);
    const o = (await getOrder(ctx, list.rows[0].id))!;
    expect(o).toMatchObject({ source: "shopify", externalName: "#1001", customerId: existing.id, subtotalAmount: 10000, taxAmount: 300, shippingAmount: 500, totalAmount: 9800, discountAmount: 1000, paymentStatus: "paid" });
    expect(o.payments[0]).toMatchObject({ provider: "shopify", amount: 9800 });
    expect(o.items[0]).toMatchObject({ name: "Kaftan", variantName: null, quantity: 2 });

    // Re-delivery and a refund.
    const refunded = shopifyOrder({ updatedAt: "2026-11-02T10:00:00Z", transactions: [...shopifyOrder().transactions, { id: "gid://shopify/OrderTransaction/10", kind: "REFUND", status: "SUCCESS", gateway: "shopify_payments", processedAt: "2026-11-02T10:00:00Z", amountSet: money("20.00"), parentTransaction: { id: "gid://shopify/OrderTransaction/9" } }] });
    await withScope({ orgId: ctx.orgId }, (tx) => upsertShopifyOrder(tx, ctx.orgId, conn, refunded, { customerId: existing.id }));
    await withScope({ orgId: ctx.orgId }, (tx) => upsertShopifyOrder(tx, ctx.orgId, conn, refunded, { customerId: existing.id }));
    const after = (await getOrder(ctx, o.id))!;
    expect(after.payments).toHaveLength(1);
    expect(after.refunds).toHaveLength(1);
    expect(after.refundedAmount).toBe(2000);
    expect((await listOrders(ctx, { q: "#1001" })).total).toBe(1);
    const mine = await withTenant(ctx, (tx) => tx.select({ id: customers.id }).from(customers).where(eq(customers.organizationId, ctx.orgId)));
    expect(mine).toHaveLength(1); // matched by email, no duplicate customer
  });

  it("folds extra charges into shipping so totals still reconcile, and maps cancellation", async () => {
    const { ctx, conn } = await connected();
    const o = shopifyOrder({ id: "gid://shopify/Order/2002", name: "#2002", totalPriceSet: money("110.00"), cancelledAt: "2026-11-03T00:00:00Z", transactions: [], customer: null });
    const id = await withScope({ orgId: ctx.orgId }, (tx) => upsertShopifyOrder(tx, ctx.orgId, conn, o, { customerId: null }));
    const row = await withTenant(ctx, async (tx) => (await tx.select().from(orders).where(eq(orders.id, id)))[0]);
    expect(row).toMatchObject({ discountAmount: 0, shippingAmount: 700, totalAmount: 11000, orderStatus: "cancelled" });
    expect(row.subtotalAmount - row.discountAmount + row.taxAmount + row.shippingAmount).toBe(row.totalAmount);
  });

  it("honours customer redaction even after the store is disconnected, and ignores other topics", async () => {
    const { ctx, conn } = await connected();
    stubFetch({ "/graphql.json": () => ({ data: { customer: { ...shopifyCustomer, id: "gid://shopify/Customer/88", defaultEmailAddress: { emailAddress: "redact@example.com" } } } }) });
    await withScope({ orgId: ctx.orgId }, (tx) => applyShopifyWebhook(tx, ctx.orgId, conn.id, "customers/create", { id: 88 }));
    await withScope({ orgId: ctx.orgId }, (tx) => markDisconnected(tx, conn.id));
    expect(await resolveRoute("shopify", { externalAccountId: SHOP })).not.toBeNull(); // route kept for privacy webhooks
    expect(await withScope({ orgId: ctx.orgId }, (tx) => applyShopifyWebhook(tx, ctx.orgId, conn.id, "orders/create", { id: 1 }))).toBe("ignored");
    expect(await withScope({ orgId: ctx.orgId }, (tx) => applyShopifyWebhook(tx, ctx.orgId, conn.id, "customers/redact", { customer: { id: 88 } }))).toBe("processed");
    const rows = await withTenant(ctx, (tx) => tx.select().from(customers).where(eq(customers.organizationId, ctx.orgId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: "Redacted customer", firstName: null, status: "archived" });
    expect(JSON.stringify(await withTenant(ctx, (tx) => tx.execute(sql`select * from customer_emails`)))).not.toContain("redact@example.com");
    await withScope({ orgId: ctx.orgId }, (tx) => applyShopifyWebhook(tx, ctx.orgId, conn.id, "shop/redact", {}));
    expect(await resolveRoute("shopify", { externalAccountId: SHOP })).toBeNull();
  });

  it("backfills products, customers and orders page by page, then schedules a daily incremental", async () => {
    const { ctx, conn } = await connected();
    const product = { id: "gid://shopify/Product/5", title: "Agbada", description: "", vendor: "Ada", productType: "Menswear", status: "ACTIVE", tags: [], updatedAt: "2026-11-01T00:00:00Z", featuredMedia: null,
      variants: { nodes: [{ id: "gid://shopify/ProductVariant/51", title: "M", sku: "AGB-M", price: "120.00", inventoryQuantity: 4 }] } };
    const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({ pageInfo: { hasNextPage, endCursor }, nodes });
    const seen: string[] = [];
    stubFetch({
      "/graphql.json": (_u, init) => {
        const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { cursor: string | null; query: string | null } };
        if (query.includes("shop {")) return { data: { shop: { name: "Ada Styles", currencyCode: "USD", ianaTimezone: "Africa/Lagos", myshopifyDomain: SHOP } } };
        const root = query.match(/\{ (products|customers|orders)\(/)?.[1] ?? "?";
        seen.push(`${root}:${variables.cursor ?? "start"}`);
        if (root === "products") return { data: { products: variables.cursor ? page([product]) : page([], true, "c1") } };
        if (root === "customers") return { data: { customers: page([shopifyCustomer]) } };
        if (root === "orders") {
          expect(variables.query).toMatch(/^updated_at:>=/);
          const o = shopifyOrder({ id: "gid://shopify/Order/4004", name: "#4004", lineItems: { nodes: [{ id: "li", title: "Agbada", variantTitle: "M", sku: "AGB-M", quantity: 1, originalUnitPriceSet: money("120.00"), variant: { id: "gid://shopify/ProductVariant/51", product: { id: "gid://shopify/Product/5" } } }] }, totalPriceSet: money("128.00"), transactions: [] });
          return { data: { orders: page([o]) } };
        }
        return { data: {} };
      },
    });
    await runDueWork({ orgId: ctx.orgId }); // shopify.setup → shopify.sync (same run picks up newly due jobs or the next one)
    await runDueWork({ orgId: ctx.orgId });
    expect(seen).toEqual(["products:start", "products:c1", "customers:start", "orders:start"]);
    const [c] = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(integrationConnections).where(eq(integrationConnections.id, conn.id)));
    expect(c.lastSyncAt).not.toBeNull();
    expect(c.displayName).toBe("Ada Styles");
    const o = (await listOrders(ctx, { q: "#4004" })).rows[0];
    const full = (await getOrder(ctx, o.id))!;
    expect(full.items[0]).toMatchObject({ name: "Agbada", sku: "AGB-M" });
    expect(full.items[0].variantId).not.toBeNull(); // linked to the imported variant
    const next = await withScope({ orgId: ctx.orgId }, (tx) => tx.select().from(jobs).where(and(eq(jobs.organizationId, ctx.orgId), eq(jobs.type, "shopify.sync"), eq(jobs.status, "pending"))));
    expect(next).toHaveLength(1);
    expect(next[0].runAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it("imports stay inside the workspace", async () => {
    const { ctx, conn } = await connected();
    await withScope({ orgId: ctx.orgId }, (tx) => upsertShopifyOrder(tx, ctx.orgId, conn, shopifyOrder({ id: "gid://shopify/Order/3003", name: "#3003", customer: null }), { customerId: null }));
    const b = await createOrgWithOwner("Elsewhere");
    expect((await listOrders(b.ctx, { q: "#3003" })).total).toBe(0);
    const pays = await withTenant(b.ctx, (tx) => tx.select().from(payments));
    const refs = await withTenant(b.ctx, (tx) => tx.select().from(refunds));
    const routes = await withTenant(b.ctx, (tx) => tx.select().from(integrationRoutes).where(eq(integrationRoutes.organizationId, ctx.orgId)));
    expect(pays).toHaveLength(0);
    expect(refs).toHaveLength(0);
    // integration_routes holds no secrets; it only maps a shop to a workspace id.
    expect(Object.keys(routes[0]).sort()).toEqual(["connectionId", "externalAccountId", "organizationId", "provider"]);
  });
});
