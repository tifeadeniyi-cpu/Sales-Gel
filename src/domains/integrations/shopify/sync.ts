import "server-only";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { fulfillments, orderItems, orders, productVariants, products, stores } from "@/domains/commerce/schema";
import { recordProviderPayment, recordProviderRefund } from "@/domains/commerce/orders";
import { customerAddresses, customerEmails, customerPhones, customers } from "@/domains/customers/schema";
import { deriveDisplayName, normalizeEmail, normalizePhone } from "@/domains/customers/normalize";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { parseMoney } from "@/lib/money";
import { audit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { withScope } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { newId } from "@/lib/ids";
import { credentialsOf, markConnectionError, markDisconnected, updateConnectionCredentials } from "../connections";
import { externalRecordMappings, integrationConnections, integrationRoutes } from "../schema";
import { refreshTokens, ShopifyApiError, ShopifyAuthError, shopifyGraphql, type ShopifyTokens } from "./client";

/* ───────── GraphQL (Admin API 2026-10; fields checked against the published schema) ───────── */

const MONEY = "shopMoney { amount currencyCode }";
const ADDRESS = "address1 address2 city province zip countryCodeV2";
export const CUSTOMER_FIELDS = `id firstName lastName displayName note tags updatedAt defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } defaultAddress { ${ADDRESS} }`;
export const PRODUCT_FIELDS = `id title description vendor productType status tags updatedAt featuredMedia { preview { image { url } } } variants(first: 100) { nodes { id title sku price inventoryQuantity } }`;
export const ORDER_FIELDS = `id name createdAt updatedAt processedAt cancelledAt currencyCode email phone note test sourceName displayFinancialStatus displayFulfillmentStatus
  customer { id }
  shippingAddress { ${ADDRESS} }
  totalShippingPriceSet { ${MONEY} } totalTaxSet { ${MONEY} } totalPriceSet { ${MONEY} }
  lineItems(first: 100) { nodes { id title variantTitle sku quantity originalUnitPriceSet { ${MONEY} } variant { id product { id } } } }
  transactions(first: 100) { id kind status gateway processedAt amountSet { ${MONEY} } parentTransaction { id } }`;

const LIST = (root: string, fields: string, first: number) =>
  `query Sync($cursor: String, $query: String) { ${root}(first: ${first}, after: $cursor, query: $query${root === "orders" ? ", sortKey: UPDATED_AT" : ""}) { pageInfo { hasNextPage endCursor } nodes { ${fields} } } }`;

type Money = { shopMoney: { amount: string; currencyCode: string } } | null;
type Address = { address1: string | null; address2: string | null; city: string | null; province: string | null; zip: string | null; countryCodeV2: string | null } | null;
export interface SCustomer { id: string; firstName: string | null; lastName: string | null; displayName: string; note: string | null; tags: string[]; updatedAt: string; defaultEmailAddress: { emailAddress: string } | null; defaultPhoneNumber: { phoneNumber: string } | null; defaultAddress: Address }
export interface SProduct { id: string; title: string; description: string; vendor: string; productType: string; status: "ACTIVE" | "DRAFT" | "ARCHIVED" | string; tags: string[]; updatedAt: string; featuredMedia: { preview: { image: { url: string } | null } | null } | null; variants: { nodes: { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null }[] } }
export interface SOrder {
  id: string; name: string; createdAt: string; updatedAt: string; processedAt: string; cancelledAt: string | null; currencyCode: string; email: string | null; phone: string | null; note: string | null; test: boolean; sourceName: string | null;
  displayFinancialStatus: string | null; displayFulfillmentStatus: string; customer: { id: string } | null; shippingAddress: Address;
  totalShippingPriceSet: Money; totalTaxSet: Money; totalPriceSet: Money;
  lineItems: { nodes: { id: string; title: string; variantTitle: string | null; sku: string | null; quantity: number; originalUnitPriceSet: Money; variant: { id: string; product: { id: string } | null } | null }[] };
  transactions: { id: string; kind: string; status: string; gateway: string | null; processedAt: string | null; amountSet: Money; parentTransaction: { id: string } | null }[];
}

/* ───────── tokens ───────── */

interface Conn { id: string; organizationId: string; externalAccountId: string; credentials: string; settings: Record<string, unknown> }

/** Returns a valid access token, refreshing the expiring offline token when it's within 5 minutes of expiry. */
export async function accessTokenFor(conn: Conn): Promise<string> {
  const t = credentialsOf<ShopifyTokens>(conn);
  if (!t.expiresAt || new Date(t.expiresAt).getTime() - Date.now() > 5 * 60_000 || !t.refreshToken) return t.accessToken;
  try {
    const next = await refreshTokens(conn.externalAccountId, t.refreshToken);
    await withScope({ orgId: conn.organizationId }, (tx) => updateConnectionCredentials(tx, conn.id, next));
    return next.accessToken;
  } catch (err) {
    if (err instanceof ShopifyAuthError && err.kind === "reauthorize") await markConnectionError(conn.organizationId, conn.id, "Shopify access expired. Reconnect your store.");
    throw err;
  }
}

async function loadConn(orgId: string, connectionId: string) {
  return withScope({ orgId }, async (tx) => {
    const [c] = await tx.select().from(integrationConnections).where(and(eq(integrationConnections.organizationId, orgId), eq(integrationConnections.id, connectionId)));
    return c && c.status !== "disconnected" ? (c as typeof c & Conn) : null;
  });
}

async function gql<T>(conn: Conn, query: string, variables: Record<string, unknown> = {}) {
  return shopifyGraphql<T>(conn.externalAccountId, await accessTokenFor(conn), query, variables);
}

/* ───────── mapping helpers ───────── */

async function mapping(tx: Tx, connectionId: string, type: string, externalId: string) {
  const [m] = await tx.select().from(externalRecordMappings).where(and(eq(externalRecordMappings.connectionId, connectionId), eq(externalRecordMappings.externalType, type), eq(externalRecordMappings.externalId, externalId)));
  return m ?? null;
}
async function setMapping(tx: Tx, orgId: string, connectionId: string, type: string, externalId: string, entityType: string, entityId: string, updatedAt?: string) {
  await tx
    .insert(externalRecordMappings)
    .values({ organizationId: orgId, connectionId, externalType: type, externalId, entityType, entityId, externalUpdatedAt: updatedAt ? new Date(updatedAt) : null })
    .onConflictDoUpdate({ target: [externalRecordMappings.connectionId, externalRecordMappings.externalType, externalRecordMappings.externalId], set: { entityId, externalUpdatedAt: updatedAt ? new Date(updatedAt) : null, updatedAt: new Date() } });
}

const minor = (m: Money | string | null | undefined, currency: string) => {
  const v = typeof m === "string" ? m : m?.shopMoney.amount;
  return v ? (parseMoney(v, currency) ?? 0) : 0;
};

/** The Shopify store as a SalesGel store, so imported products/orders are labelled by source. */
async function ensureStore(tx: Tx, orgId: string, shop: string, currency: string) {
  const [s] = await tx.select({ id: stores.id }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.provider, "shopify"), eq(stores.externalAccountId, shop)));
  if (s) return s.id;
  const id = newId();
  await tx.insert(stores).values({ id, organizationId: orgId, name: shop.replace(".myshopify.com", ""), provider: "shopify", currency, externalAccountId: shop });
  return id;
}

/* ───────── customers ───────── */

export async function upsertShopifyCustomer(tx: Tx, orgId: string, connectionId: string, c: SCustomer): Promise<string> {
  const existing = await mapping(tx, connectionId, "customer", c.id);
  const email = c.defaultEmailAddress?.emailAddress ? normalizeEmail(c.defaultEmailAddress.emailAddress) : null;
  const phone = c.defaultPhoneNumber?.phoneNumber ? normalizePhone(c.defaultPhoneNumber.phoneNumber) : null;
  let customerId = existing?.entityId ?? null;
  if (customerId) {
    const [cur] = await tx.select({ status: customers.status, mergedIntoId: customers.mergedIntoId }).from(customers).where(eq(customers.id, customerId));
    if (cur?.status === "merged" && cur.mergedIntoId) customerId = cur.mergedIntoId; // follow merges
  }
  if (!customerId && email) {
    const [m] = await tx.select({ id: customers.id }).from(customerEmails).innerJoin(customers, eq(customers.id, customerEmails.customerId)).where(and(eq(customerEmails.organizationId, orgId), eq(customerEmails.normalizedEmail, email), ne(customers.status, "merged"))).limit(1);
    customerId = m?.id ?? null;
  }
  if (!customerId && phone) {
    const [m] = await tx.select({ id: customers.id }).from(customerPhones).innerJoin(customers, eq(customers.id, customerPhones.customerId)).where(and(eq(customerPhones.organizationId, orgId), eq(customerPhones.e164, phone), ne(customers.status, "merged"))).limit(1);
    customerId = m?.id ?? null;
  }
  if (!customerId) {
    customerId = newId();
    const number = await nextNumber(tx, orgId, "customer");
    await tx.insert(customers).values({
      id: customerId, organizationId: orgId, number, type: "person", firstName: c.firstName, lastName: c.lastName, source: "shopify", notes: c.note ?? null,
      displayName: deriveDisplayName({ firstName: c.firstName, lastName: c.lastName, email: c.defaultEmailAddress?.emailAddress ?? null, phone: c.defaultPhoneNumber?.phoneNumber ?? null }),
    } as typeof customers.$inferInsert);
    await audit(tx, { orgId, userId: null }, { action: "customer.imported", entityType: "customer", entityId: customerId, metadata: { provider: "shopify", externalId: c.id } });
  } else if (existing) {
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (c.firstName) patch.firstName = c.firstName;
    if (c.lastName) patch.lastName = c.lastName;
    if (Object.keys(patch).length) await tx.update(customers).set({ ...patch, updatedAt: new Date() }).where(and(eq(customers.id, customerId), isNull(customers.mergedIntoId)));
  }
  if (email) {
    const [has] = await tx.select({ id: customerEmails.id }).from(customerEmails).where(and(eq(customerEmails.customerId, customerId), eq(customerEmails.normalizedEmail, email)));
    if (!has) {
      const [any] = await tx.select({ id: customerEmails.id }).from(customerEmails).where(eq(customerEmails.customerId, customerId)).limit(1);
      await tx.insert(customerEmails).values({ organizationId: orgId, customerId, email: c.defaultEmailAddress!.emailAddress, normalizedEmail: email, isPrimary: !any }).onConflictDoNothing();
    }
  }
  if (phone) {
    const [has] = await tx.select({ id: customerPhones.id }).from(customerPhones).where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.e164, phone)));
    if (!has) {
      const [any] = await tx.select({ id: customerPhones.id }).from(customerPhones).where(eq(customerPhones.customerId, customerId)).limit(1);
      await tx.insert(customerPhones).values({ organizationId: orgId, customerId, phone: c.defaultPhoneNumber!.phoneNumber, e164: phone, isPrimary: !any }).onConflictDoNothing();
    }
  }
  const a = c.defaultAddress;
  if (a?.address1) {
    const [has] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.line1, a.address1)));
    if (!has) await tx.insert(customerAddresses).values({ organizationId: orgId, customerId, kind: "shipping", line1: a.address1, line2: a.address2, city: a.city, region: a.province, postalCode: a.zip, country: a.countryCodeV2, isDefault: false });
  }
  await setMapping(tx, orgId, connectionId, "customer", c.id, "customer", customerId, c.updatedAt);
  return customerId;
}

/* ───────── products ───────── */

export async function upsertShopifyProduct(tx: Tx, orgId: string, conn: Conn, p: SProduct, currency: string) {
  const storeId = await ensureStore(tx, orgId, conn.externalAccountId, currency);
  const status = p.status === "ACTIVE" ? "active" : p.status === "ARCHIVED" ? "archived" : "draft";
  const [existing] = await tx.select({ id: products.id }).from(products).where(and(eq(products.organizationId, orgId), eq(products.storeId, storeId), eq(products.externalId, p.id)));
  const values = { name: p.title.slice(0, 200), description: p.description || null, brand: p.vendor || null, category: p.productType || null, status, tags: p.tags.slice(0, 20), imageUrl: p.featuredMedia?.preview?.image?.url ?? null };
  let productId: string;
  if (existing) {
    productId = existing.id;
    await tx.update(products).set({ ...values, updatedAt: new Date() }).where(eq(products.id, productId));
  } else {
    productId = newId();
    await tx.insert(products).values({ id: productId, organizationId: orgId, storeId, externalId: p.id, ...values });
  }
  const seen: string[] = [];
  for (const [i, v] of p.variants.nodes.entries()) {
    const [ev] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.organizationId, orgId), eq(productVariants.productId, productId), eq(productVariants.externalId, v.id)));
    // SKUs are unique per workspace; a Shopify SKU that collides with a different SalesGel product is left blank.
    let sku = v.sku?.trim() || null;
    if (sku) {
      const [clash] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.organizationId, orgId), sql`lower(${productVariants.sku}) = lower(${sku})`, ne(productVariants.status, "archived"), ev ? ne(productVariants.id, ev.id) : undefined));
      if (clash) sku = null;
    }
    const vals = { name: v.title === "Default Title" ? "Default" : v.title.slice(0, 120), sku, priceAmount: minor(v.price, currency), currency, inventoryQuantity: v.inventoryQuantity, status: status === "archived" ? "archived" : "active", position: i };
    if (ev) {
      await tx.update(productVariants).set({ ...vals, updatedAt: new Date() }).where(eq(productVariants.id, ev.id));
      seen.push(ev.id);
    } else {
      const id = newId();
      await tx.insert(productVariants).values({ id, organizationId: orgId, productId, externalId: v.id, ...vals } as typeof productVariants.$inferInsert);
      seen.push(id);
      await setMapping(tx, orgId, conn.id, "variant", v.id, "product_variant", id);
    }
  }
  // Variants removed in Shopify are archived here (order history keeps its snapshots).
  if (seen.length) await tx.update(productVariants).set({ status: "archived" }).where(and(eq(productVariants.productId, productId), sql`${productVariants.externalId} is not null`, sql`${productVariants.id} not in (${sql.join(seen.map((s) => sql`${s}`), sql`, `)})`));
  await setMapping(tx, orgId, conn.id, "product", p.id, "product", productId, p.updatedAt);
  return productId;
}

/* ───────── orders ───────── */

function paymentMethod(gateway: string | null): "card" | "cash" | "bank_transfer" | "other" {
  const g = (gateway ?? "").toLowerCase();
  if (g.includes("cash")) return "cash";
  if (g.includes("bank") || g.includes("transfer")) return "bank_transfer";
  if (g.includes("manual")) return "other";
  return "card";
}

export async function upsertShopifyOrder(tx: Tx, orgId: string, conn: Conn, o: SOrder, opts: { customerId: string | null }) {
  const currency = o.totalPriceSet?.shopMoney.currencyCode ?? o.currencyCode;
  const storeId = await ensureStore(tx, orgId, conn.externalAccountId, currency);
  const lines = o.lineItems.nodes.map((l) => ({ ...l, unit: minor(l.originalUnitPriceSet, currency) }));
  const subtotal = lines.reduce((n, l) => n + l.unit * l.quantity, 0);
  let shipping = minor(o.totalShippingPriceSet, currency);
  const tax = minor(o.totalTaxSet, currency);
  const total = minor(o.totalPriceSet, currency);
  let discount = subtotal + tax + shipping - total;
  if (discount < 0) { shipping += -discount; discount = 0; } // extra charges (tips, duties) folded into shipping so totals reconcile
  const addr = o.shippingAddress ? { line1: o.shippingAddress.address1 ?? "", line2: o.shippingAddress.address2 ?? "", city: o.shippingAddress.city ?? "", region: o.shippingAddress.province ?? "", postalCode: o.shippingAddress.zip ?? "", country: o.shippingAddress.countryCodeV2 ?? "" } : null;

  const [existing] = await tx.select().from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.storeId, storeId), eq(orders.externalId, o.id))).for("update");
  let orderId: string;
  const header = {
    externalName: o.name, customerId: opts.customerId, currency, subtotalAmount: subtotal, discountAmount: discount, taxRateBps: 0, taxAmount: tax, shippingAmount: shipping, totalAmount: total,
    shippingAddress: addr, contactEmail: o.email, contactPhone: o.phone, notes: o.test ? `${o.note ?? ""}${o.note ? "\n" : ""}(Shopify test order)` : o.note,
  };
  if (!existing) {
    orderId = newId();
    const number = await nextNumber(tx, orgId, "order");
    await tx.insert(orders).values({ id: orderId, organizationId: orgId, number, storeId, externalId: o.id, source: "shopify", placedAt: new Date(o.processedAt ?? o.createdAt), deliveryMethod: addr ? "shipping" : null, ...header } as typeof orders.$inferInsert);
    await audit(tx, { orgId, userId: null }, { action: "order.created", entityType: "order", entityId: orderId, metadata: { number, provider: "shopify", externalName: o.name, total, currency } });
    if (opts.customerId) await audit(tx, { orgId, userId: null }, { action: "customer.order_created", entityType: "customer", entityId: opts.customerId, metadata: { orderId, preview: `Shopify ${o.name}` } });
  } else {
    orderId = existing.id;
    // Keep paid/refunded totals coherent: amounts can only change in a way the ledger still satisfies.
    await tx.update(orders).set({ ...header, updatedAt: new Date() }).where(eq(orders.id, orderId));
  }
  const [localShipments] = await tx.select({ n: sql<number>`count(*)::int` }).from(fulfillments).where(eq(fulfillments.orderId, orderId));
  if (!existing || localShipments.n === 0) {
    await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
    if (lines.length) {
      const variantIds = lines.map((l) => l.variant?.id).filter((x): x is string => !!x);
      const maps = variantIds.length ? await tx.select({ externalId: externalRecordMappings.externalId, entityId: externalRecordMappings.entityId }).from(externalRecordMappings).where(and(eq(externalRecordMappings.connectionId, conn.id), eq(externalRecordMappings.externalType, "variant"), inArray(externalRecordMappings.externalId, variantIds))) : [];
      const vrows = maps.length ? await tx.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.id, maps.map((m) => m.entityId))) : [];
      const fulfilled = o.displayFulfillmentStatus === "FULFILLED" || o.displayFulfillmentStatus === "FULFILLMENT_NOT_REQUIRED";
      await tx.insert(orderItems).values(
        lines.map((l, i) => {
          const vId = maps.find((m) => m.externalId === l.variant?.id)?.entityId ?? null;
          return {
            organizationId: orgId, orderId, productId: vrows.find((v) => v.id === vId)?.productId ?? null, variantId: vId, name: l.title.slice(0, 200), variantName: l.variantTitle && l.variantTitle !== "Default Title" ? l.variantTitle : null,
            sku: l.sku, unitPriceAmount: l.unit, quantity: l.quantity, discountAmount: 0, lineTotalAmount: l.unit * l.quantity, position: i, fulfilledQuantity: fulfilled ? l.quantity : 0,
          };
        }),
      );
    }
    const fStatus = o.displayFulfillmentStatus === "FULFILLED" || o.displayFulfillmentStatus === "FULFILLMENT_NOT_REQUIRED" ? "fulfilled" : o.displayFulfillmentStatus === "PARTIALLY_FULFILLED" ? "partially_fulfilled" : "unfulfilled";
    await tx.update(orders).set({ fulfillmentStatus: fStatus }).where(eq(orders.id, orderId));
  }
  // Money: successful sales/captures become provider payments, successful refunds provider refunds (idempotent).
  for (const t of o.transactions) {
    if (t.status !== "SUCCESS") continue;
    const amount = minor(t.amountSet, currency);
    if (amount <= 0) continue;
    if (t.kind === "SALE" || t.kind === "CAPTURE") {
      await recordProviderPayment(tx, orgId, { orderId, provider: "shopify", providerPaymentId: t.id, amount, currency, method: paymentMethod(t.gateway), reference: t.gateway, receivedAt: t.processedAt ? new Date(t.processedAt) : undefined });
    }
  }
  for (const t of o.transactions) {
    if (t.status !== "SUCCESS" || t.kind !== "REFUND" || !t.parentTransaction) continue;
    await recordProviderRefund(tx, orgId, { provider: "shopify", providerRefundId: t.id, providerPaymentId: t.parentTransaction.id, amount: minor(t.amountSet, currency), currency, reason: "Refunded in Shopify" });
  }
  if (o.cancelledAt) await tx.update(orders).set({ orderStatus: "cancelled", cancelledAt: new Date(o.cancelledAt), cancelReason: "Cancelled in Shopify" }).where(and(eq(orders.id, orderId), ne(orders.orderStatus, "cancelled")));
  await setMapping(tx, orgId, conn.id, "order", o.id, "order", orderId, o.updatedAt);
  return orderId;
}

async function fetchCustomer(conn: Conn, id: string) {
  const d = await gql<{ customer: SCustomer | null }>(conn, `query C($id: ID!) { customer(id: $id) { ${CUSTOMER_FIELDS} } }`, { id });
  return d.customer;
}
async function fetchOrder(conn: Conn, id: string) {
  const d = await gql<{ order: SOrder | null }>(conn, `query O($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id });
  return d.order;
}
async function fetchProduct(conn: Conn, id: string) {
  const d = await gql<{ product: SProduct | null }>(conn, `query P($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`, { id });
  return d.product;
}

async function orderCustomer(tx: Tx, orgId: string, conn: Conn, o: SOrder) {
  if (!o.customer) return null;
  const m = await mapping(tx, conn.id, "customer", o.customer.id);
  if (m) return m.entityId;
  const c = await fetchCustomer(conn, o.customer.id);
  return c ? upsertShopifyCustomer(tx, orgId, conn.id, c) : null;
}

/* ───────── webhooks ───────── */

const gid = (type: string, payload: Record<string, unknown>, key = "id") =>
  (payload.admin_graphql_api_id as string | undefined) ?? (payload[key] !== undefined ? `gid://shopify/${type}/${payload[key]}` : null);

/**
 * Applies a verified webhook. The payload only identifies the record; current state is re-read through
 * the GraphQL Admin API, so late or out-of-order deliveries can't overwrite newer data.
 */
export async function applyShopifyWebhook(tx: Tx, orgId: string, connectionId: string, topic: string, payload: Record<string, unknown>): Promise<"processed" | "ignored"> {
  const [conn] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
  if (!conn) return "ignored";
  const c = conn as typeof conn & Conn;
  if (c.status === "disconnected" && !["customers/data_request", "customers/redact", "shop/redact"].includes(topic)) return "ignored";
  const currency = (c.settings.currency as string | undefined) ?? "USD";
  switch (topic) {
    case "orders/create":
    case "orders/updated":
    case "orders/cancelled":
    case "orders/paid":
    case "refunds/create": {
      const id = topic === "refunds/create" ? (payload.order_id ? `gid://shopify/Order/${payload.order_id}` : null) : gid("Order", payload);
      if (!id) return "ignored";
      const o = await fetchOrder(c, id);
      if (!o) return "ignored";
      await upsertShopifyOrder(tx, orgId, c, o, { customerId: await orderCustomer(tx, orgId, c, o) });
      return "processed";
    }
    case "customers/create":
    case "customers/update": {
      const id = gid("Customer", payload);
      const cust = id ? await fetchCustomer(c, id) : null;
      if (!cust) return "ignored";
      await upsertShopifyCustomer(tx, orgId, c.id, cust);
      return "processed";
    }
    case "products/create":
    case "products/update": {
      const id = gid("Product", payload);
      const p = id ? await fetchProduct(c, id) : null;
      if (!p) return "ignored";
      await upsertShopifyProduct(tx, orgId, c, p, currency);
      return "processed";
    }
    case "products/delete": {
      const id = gid("Product", payload);
      const m = id ? await mapping(tx, c.id, "product", id) : null;
      if (!m) return "ignored";
      await tx.update(products).set({ status: "archived", updatedAt: new Date() }).where(eq(products.id, m.entityId));
      return "processed";
    }
    case "app/uninstalled":
    case "shop/redact": {
      await markDisconnected(tx, c.id);
      if (topic === "shop/redact") {
        await tx.delete(externalRecordMappings).where(eq(externalRecordMappings.connectionId, c.id));
        await tx.delete(integrationRoutes).where(eq(integrationRoutes.connectionId, c.id)); // nothing more will arrive for this shop
      }
      await audit(tx, { orgId, userId: null }, { action: "integration.disconnected", entityType: "integration", entityId: c.id, metadata: { provider: "shopify", reason: topic } });
      await notifyAdmins(tx, orgId, topic === "app/uninstalled" ? "SalesGel was uninstalled from your Shopify store" : "Shopify asked SalesGel to remove store data", c.id);
      return "processed";
    }
    case "customers/redact": {
      const id = (payload.customer as { id?: number } | undefined)?.id;
      const m = id ? await mapping(tx, c.id, "customer", `gid://shopify/Customer/${id}`) : null;
      if (!m) return "ignored";
      await redactCustomer(tx, orgId, m.entityId);
      await tx.delete(externalRecordMappings).where(eq(externalRecordMappings.id, m.id));
      return "processed";
    }
    case "customers/data_request": {
      const id = (payload.customer as { id?: number } | undefined)?.id;
      const m = id ? await mapping(tx, c.id, "customer", `gid://shopify/Customer/${id}`) : null;
      await notifyAdmins(tx, orgId, m ? "A Shopify customer requested their data — export their SalesGel profile and send it to them" : "A Shopify customer requested their data (no matching SalesGel record)", m?.entityId ?? c.id, m ? "customer" : "integration");
      return "processed";
    }
    default:
      return "ignored";
  }
}

/** GDPR redaction requested through Shopify: removes the person's contact details, keeps anonymous order history. */
async function redactCustomer(tx: Tx, orgId: string, customerId: string) {
  await tx.delete(customerEmails).where(eq(customerEmails.customerId, customerId));
  await tx.delete(customerPhones).where(eq(customerPhones.customerId, customerId));
  await tx.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
  await tx.update(customers).set({ firstName: null, lastName: null, displayName: "Redacted customer", notes: null, status: "archived", updatedAt: new Date() } as Partial<typeof customers.$inferInsert>).where(eq(customers.id, customerId));
  await tx.update(orders).set({ contactEmail: null, contactPhone: null, shippingAddress: null, billingAddress: null }).where(eq(orders.customerId, customerId));
  await audit(tx, { orgId, userId: null }, { action: "customer.redacted", entityType: "customer", entityId: customerId, metadata: { provider: "shopify" } });
}

async function notifyAdmins(tx: Tx, orgId: string, title: string, entityId: string, entityType = "integration") {
  const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  const admins = await tx.execute<{ user_id: string }>(sql`
    select m.user_id from ${memberships} m join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = ${orgId} and m.status = 'active' and rp.permission_key = 'integrations.manage'`);
  for (const a of admins) {
    await notify(tx, { orgId, recipientUserId: a.user_id, type: "integration.error", title, link: entityType === "customer" ? `/o/${org.slug}/customers/${entityId}` : `/o/${org.slug}/integrations`, entityType, entityId });
  }
}

/* ───────── backfill / incremental sync ───────── */

type Phase = "products" | "customers" | "orders";
const PHASES: Phase[] = ["products", "customers", "orders"];

/**
 * Imports products, customers and recent orders page by page. Long syncs continue in a follow-up job
 * (same cursor), so each run stays well inside serverless time limits.
 */
export async function runShopifySync(job: JobContext) {
  const p = job.payload as { connectionId: string; phase?: Phase; cursor?: string | null; since?: string; mode?: "backfill" | "incremental" };
  const conn = await loadConn(job.orgId, p.connectionId);
  if (!conn) return;
  const currency = (conn.settings.currency as string | undefined) ?? "USD";
  const since = p.since ?? new Date(Date.now() - 90 * 86_400_000).toISOString();
  let phase: Phase = p.phase ?? "products";
  let cursor = p.cursor ?? null;
  const deadline = Date.now() + 40_000;
  const counts = { products: 0, customers: 0, orders: 0 };
  try {
    while (Date.now() < deadline) {
      const query = phase === "orders" || p.mode === "incremental" ? `updated_at:>='${since}'` : null;
      const fields = phase === "products" ? PRODUCT_FIELDS : phase === "customers" ? CUSTOMER_FIELDS : ORDER_FIELDS;
      const data = await gql<Record<string, { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] }>>(conn, LIST(phase, fields, phase === "orders" ? 25 : 50), { cursor, query });
      const page = data[phase];
      for (const node of page.nodes) {
        await withScope({ orgId: job.orgId }, async (tx) => {
          if (phase === "products") await upsertShopifyProduct(tx, job.orgId, conn, node as SProduct, currency);
          else if (phase === "customers") await upsertShopifyCustomer(tx, job.orgId, conn.id, node as SCustomer);
          else {
            const o = node as SOrder;
            await upsertShopifyOrder(tx, job.orgId, conn, o, { customerId: await orderCustomer(tx, job.orgId, conn, o) });
          }
        });
        counts[phase]++;
      }
      if (page.pageInfo.hasNextPage) { cursor = page.pageInfo.endCursor; continue; }
      const next = PHASES[PHASES.indexOf(phase) + 1];
      if (!next) {
        await withScope({ orgId: job.orgId }, async (tx) => {
          await tx.update(integrationConnections).set({ lastSyncAt: new Date(), lastError: null, status: "active" }).where(eq(integrationConnections.id, conn.id));
          // Webhooks keep data current; a daily incremental sync catches anything a delivery missed.
          await enqueue(tx, job.orgId, "shopify.sync", { connectionId: conn.id, mode: "incremental", since: new Date(Date.now() - 2 * 86_400_000).toISOString() }, { runAt: new Date(Date.now() + 24 * 3_600_000), idempotencyKey: `shopify-sync:${conn.id}:${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}` });
        });
        return;
      }
      phase = next;
      cursor = null;
    }
    // Out of time: continue where we stopped.
    await withScope({ orgId: job.orgId }, (tx) => enqueue(tx, job.orgId, "shopify.sync", { ...p, phase, cursor, since }, { idempotencyKey: `shopify-sync:${conn.id}:${phase}:${cursor ?? "start"}:${job.jobId}` }));
  } catch (err) {
    if (err instanceof ShopifyApiError && err.throttled) {
      await withScope({ orgId: job.orgId }, (tx) => enqueue(tx, job.orgId, "shopify.sync", { ...p, phase, cursor, since }, { runAt: new Date(Date.now() + 60_000), idempotencyKey: `shopify-sync:${conn.id}:${phase}:${cursor ?? "start"}:retry:${job.jobId}` }));
      return;
    }
    if (!(err instanceof ShopifyAuthError)) await markConnectionError(job.orgId, conn.id, `Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
