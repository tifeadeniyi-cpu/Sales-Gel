import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, ne, or, sql, sum, type SQL } from "drizzle-orm";
import { customers } from "@/domains/customers/schema";
import { memberships } from "@/domains/identity/schema";
import { auditLogs } from "@/domains/platform/schema";
import { leads } from "@/domains/sales/schema";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { formatMoney, parseMoney } from "@/lib/money";
import { computeTotals, deriveFulfillmentStatus, derivePaymentStatus, percentToBps } from "./math";
import { ensureManualStore } from "./products";
import { localDate, zonedMidnight } from "@/domains/reporting/period";
import { fulfillmentItems, fulfillments, orderItems, orders, payments, productVariants, products, refunds } from "./schema";
import {
  fulfillmentInputSchema,
  orderFiltersSchema,
  orderInputSchema,
  paymentInputSchema,
  refundInputSchema,
  type OrderFilters,
  type OrderInput,
} from "./validation";

type Perm = "orders.read" | "orders.write" | "orders.financials" | "payments.record" | "refunds.issue";
function need(ctx: OrgContext, ...ps: Perm[]) {
  for (const p of ps) if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
}
const canSeeMoney = (ctx: OrgContext) => ctx.permissions.has("orders.financials");

function money(input: unknown, currency: string, field: string, opts: { allowZero?: boolean } = {}) {
  if (input === null || input === undefined || input === "") return 0;
  const v = parseMoney(input as string, currency);
  if (v === null || v < 0 || (!opts.allowZero && v === 0 && field === "amount")) throw new ValidationError("Enter a valid amount.", { [field]: ["Enter a valid amount, e.g. 25.00"] });
  return v;
}

async function loadOrderForWrite(tx: Tx, ctx: OrgContext, id: string) {
  const [o] = await tx.select().from(orders).where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, id))).for("update");
  if (!o) throw new NotFoundError("Order not found.");
  return o;
}

async function assertCustomer(tx: Tx, ctx: OrgContext, customerId: string | null | undefined) {
  if (!customerId) return null;
  const [c] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, customerId)));
  const visible = c && (ctx.permissions.has("customers.read") || (ctx.permissions.has("customers.read_assigned") && c.ownerMembershipId === ctx.membershipId));
  if (!c || !visible) throw new ValidationError("Choose a customer you have access to.", { customerId: ["Choose a customer you have access to."] });
  if (c.status === "merged") throw new ValidationError("That customer was merged into another record.", { customerId: ["Choose the surviving customer."] });
  return c;
}

async function assertMember(tx: Tx, ctx: OrgContext, id: string | null | undefined) {
  if (!id) return;
  const [m] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, id)));
  if (!m || m.status !== "active") throw new ValidationError("Choose an active team member.", { assignedMembershipId: ["Choose an active team member."] });
}

type ParsedOrder = ReturnType<typeof orderInputSchema.parse>;

/** Resolves catalog variants and snapshots name/SKU/price onto each line. */
async function buildLines(tx: Tx, ctx: OrgContext, lines: ParsedOrder["lines"], currency: string) {
  const variantIds = lines.map((l) => l.variantId).filter((v): v is string => !!v);
  const vs = variantIds.length
    ? await tx
        .select({ v: productVariants, productName: products.name, productStatus: products.status })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(productVariants.organizationId, ctx.orgId), inArray(productVariants.id, variantIds)))
    : [];
  return lines.map((l, i) => {
    if (l.variantId) {
      const found = vs.find((x) => x.v.id === l.variantId);
      if (!found || found.v.status !== "active" || found.productStatus === "archived") throw new ValidationError("A product is no longer available.", { [`lines.${i}.variantId`]: ["This product is no longer available."] });
      if (found.v.currency !== currency) throw new ValidationError(`“${found.productName}” is priced in ${found.v.currency}, but this order is in ${currency}.`, { [`lines.${i}.variantId`]: [`Priced in ${found.v.currency}`] });
      const unitPrice = l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === "" ? found.v.priceAmount : money(l.unitPrice, currency, `lines.${i}.unitPrice`, { allowZero: true });
      return { productId: found.v.productId, variantId: found.v.id, name: found.productName, variantName: found.v.name === "Default" ? null : found.v.name, sku: found.v.sku, unitPrice, quantity: l.quantity, discount: money(l.discount, currency, `lines.${i}.discount`, { allowZero: true }) };
    }
    if (l.unitPrice === null || l.unitPrice === undefined || l.unitPrice === "") throw new ValidationError("Enter a price for the custom item.", { [`lines.${i}.unitPrice`]: ["Enter a price"] });
    return { productId: null, variantId: null, name: l.name!, variantName: null, sku: null, unitPrice: money(l.unitPrice, currency, `lines.${i}.unitPrice`, { allowZero: true }), quantity: l.quantity, discount: money(l.discount, currency, `lines.${i}.discount`, { allowZero: true }) };
  });
}

function totalsFor(data: ParsedOrder, built: Awaited<ReturnType<typeof buildLines>>, currency: string) {
  const bps = percentToBps(data.taxRate);
  if (bps === null) throw new ValidationError("Enter a valid tax rate.", { taxRate: ["Use a percentage like 8.25"] });
  for (const [i, l] of built.entries()) {
    if (l.discount > l.unitPrice * l.quantity) throw new ValidationError("Discount can't exceed the line amount.", { [`lines.${i}.discount`]: ["Discount can't exceed the line amount"] });
  }
  const totals = computeTotals({
    lines: built.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity, discount: l.discount })),
    orderDiscount: money(data.orderDiscount, currency, "orderDiscount", { allowZero: true }),
    shipping: money(data.shipping, currency, "shipping", { allowZero: true }),
    taxRateBps: bps,
  });
  return { totals, bps };
}

async function insertItems(tx: Tx, orgId: string, orderId: string, built: Awaited<ReturnType<typeof buildLines>>, lineTotals: number[]) {
  await tx.insert(orderItems).values(
    built.map((l, i) => ({
      organizationId: orgId,
      orderId,
      productId: l.productId,
      variantId: l.variantId,
      name: l.name,
      variantName: l.variantName,
      sku: l.sku,
      unitPriceAmount: l.unitPrice,
      quantity: l.quantity,
      discountAmount: l.discount,
      lineTotalAmount: lineTotals[i],
      position: i,
    })),
  );
}

export async function createOrder(ctx: OrgContext, input: OrderInput) {
  need(ctx, "orders.write");
  const data = parseInput(orderInputSchema, input);
  return withTenant(ctx, async (tx) => {
    let lead = null;
    if (data.leadId) {
      const [l] = await tx.select().from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, data.leadId)));
      const visible = l && (ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && l.ownerMembershipId === ctx.membershipId));
      if (!visible) throw new ValidationError("Choose a lead you have access to.", { leadId: ["Choose a lead you have access to."] });
      lead = l;
    }
    const customer = await assertCustomer(tx, ctx, data.customerId ?? lead?.customerId ?? null);
    if (lead?.customerId && customer && lead.customerId !== customer.id) throw new ValidationError("The order's customer must match the lead's customer.", { customerId: ["Must match the lead's customer"] });
    await assertMember(tx, ctx, data.assignedMembershipId);
    const currency = data.currency ?? customer?.preferredCurrency ?? lead?.currency ?? ctx.defaultCurrency;
    const built = await buildLines(tx, ctx, data.lines, currency);
    const { totals, bps } = totalsFor(data, built, currency);
    const storeId = await ensureManualStore(tx, ctx);
    const id = newId();
    const number = await nextNumber(tx, ctx.orgId, "order");
    await tx.insert(orders).values({
      id,
      organizationId: ctx.orgId,
      number,
      storeId,
      customerId: customer?.id ?? null,
      leadId: lead?.id ?? null,
      source: data.source,
      currency,
      subtotalAmount: totals.subtotal,
      discountAmount: totals.discountTotal,
      taxRateBps: bps,
      taxAmount: totals.taxTotal,
      shippingAmount: totals.shippingTotal,
      totalAmount: totals.total,
      paymentStatus: derivePaymentStatus(totals.total, 0, 0),
      deliveryMethod: data.deliveryMethod ?? null,
      shippingAddress: data.shippingAddress ?? null,
      billingAddress: data.billingAddress ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone,
      notes: data.notes,
      assignedMembershipId: data.assignedMembershipId ?? null,
      createdByUserId: ctx.userId,
    });
    await insertItems(tx, ctx.orgId, id, built, totals.lineTotals);
    const label = `ORD-${number}`;
    await audit(tx, ctx, { action: "order.created", entityType: "order", entityId: id, metadata: { number, total: totals.total, currency } });
    if (customer) {
      await audit(tx, ctx, { action: "customer.order_created", entityType: "customer", entityId: customer.id, metadata: { orderId: id, preview: `${label} · ${formatMoney(totals.total, currency)}` } });
      await tx.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customer.id));
    }
    if (lead) await audit(tx, ctx, { action: "lead.order_linked", entityType: "lead", entityId: lead.id, metadata: { orderId: id, number } });
    await emit(tx, ctx.orgId, "order.created", { orderId: id });
    return { id, number };
  });
}

/** Items and amounts can change only while nothing has been paid or fulfilled. */
export async function updateOrderItems(ctx: OrgContext, id: string, input: Pick<OrderInput, "lines" | "orderDiscount" | "shipping" | "taxRate">) {
  need(ctx, "orders.write");
  const data = parseInput(orderInputSchema.pick({ lines: true, orderDiscount: true, shipping: true, taxRate: true }), input) as ParsedOrder;
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, id);
    if (o.orderStatus !== "open") throw new ConflictError("Only open orders can be edited.");
    if (o.paidAmount > 0) throw new ConflictError("This order has payments. Items and prices are locked so financial records stay consistent; refund or create a new order instead.");
    if (o.fulfillmentStatus !== "unfulfilled") throw new ConflictError("Items are locked once fulfillment has started.");
    const built = await buildLines(tx, ctx, data.lines, o.currency);
    const { totals, bps } = totalsFor(data, built, o.currency);
    await tx.delete(orderItems).where(eq(orderItems.orderId, id));
    await insertItems(tx, ctx.orgId, id, built, totals.lineTotals);
    const patch = { subtotalAmount: totals.subtotal, discountAmount: totals.discountTotal, taxRateBps: bps, taxAmount: totals.taxTotal, shippingAmount: totals.shippingTotal, totalAmount: totals.total, paymentStatus: derivePaymentStatus(totals.total, 0, 0) };
    await tx.update(orders).set(patch).where(eq(orders.id, id));
    await audit(tx, ctx, { action: "order.items_updated", entityType: "order", entityId: id, changes: diff(o, patch) });
  });
}

const detailsSchema = orderInputSchema.pick({ deliveryMethod: true, shippingAddress: true, billingAddress: true, contactEmail: true, contactPhone: true, notes: true, assignedMembershipId: true, customerId: true }).partial();

export async function updateOrderDetails(ctx: OrgContext, id: string, input: Record<string, unknown>) {
  need(ctx, "orders.write");
  const parsed = parseInput(detailsSchema, input);
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in input)) as Partial<typeof orders.$inferInsert>;
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, id);
    if (o.orderStatus === "cancelled") throw new ConflictError("Cancelled orders can't be edited.");
    if ("assignedMembershipId" in patch) await assertMember(tx, ctx, patch.assignedMembershipId);
    if ("customerId" in patch) {
      if (o.paidAmount > 0 && o.customerId) throw new ConflictError("This order has payments; its customer can't be changed. Merge customers instead if they're the same person.");
      await assertCustomer(tx, ctx, patch.customerId);
    }
    await tx.update(orders).set(patch).where(eq(orders.id, id));
    await audit(tx, ctx, { action: "order.updated", entityType: "order", entityId: id, changes: diff(o, patch) });
  });
}

/** Recomputes cached money totals and payment status from the payment/refund ledger. */
async function recompute(tx: Tx, orderId: string) {
  const [{ paid }] = await tx.select({ paid: sql<string>`coalesce(sum(${payments.amount}),0)` }).from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "succeeded"), isNull(payments.voidedAt)));
  const [{ refunded }] = await tx.select({ refunded: sql<string>`coalesce(sum(${refunds.amount}),0)` }).from(refunds).where(eq(refunds.orderId, orderId));
  const [o] = await tx.select({ total: orders.totalAmount }).from(orders).where(eq(orders.id, orderId));
  const p = Number(paid);
  const r = Number(refunded);
  const status = derivePaymentStatus(o.total, p, r);
  await tx.update(orders).set({ paidAmount: p, refundedAmount: r, paymentStatus: status }).where(eq(orders.id, orderId));
  return { paid: p, refunded: r, status };
}

/**
 * A date-only payment date ("2026-11-12") means that day in the workspace's timezone: now if it's
 * today, otherwise midday local time — never midnight UTC, which would land on the wrong day.
 */
function localPaymentDate(v: string | Date | undefined, tz: string): string | Date | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const [y, m, d] = v.split("-").map(Number);
  const today = localDate(new Date(), tz);
  if (today.y === y && today.m === m && today.d === d) return new Date();
  return new Date(zonedMidnight(y, m, d, tz).getTime() + 12 * 3_600_000);
}

/**
 * Records money received outside a connected provider (cash, bank transfer…). Clearly labelled as
 * staff-recorded. Provider payments (Stripe, Paystack…) are created only from verified webhooks in Phase 6;
 * clicking a payment link is never treated as payment.
 */
export async function recordPayment(ctx: OrgContext, orderId: string, input: { amount: string | number; method: string; reference?: string | null; note?: string | null; receivedAt?: string | Date }) {
  need(ctx, "payments.record", "orders.financials");
  const data = parseInput(paymentInputSchema, { ...input, receivedAt: localPaymentDate(input.receivedAt, ctx.timezone) });
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, orderId);
    if (o.orderStatus === "cancelled") throw new ConflictError("Payments can't be recorded on a cancelled order.");
    const amount = money(data.amount, o.currency, "amount");
    const due = o.totalAmount - (o.paidAmount - o.refundedAmount);
    if (amount > due) throw new ValidationError(`That's more than the ${formatMoney(due, o.currency)} still due.`, { amount: [`At most ${formatMoney(due, o.currency)}`] });
    if (data.receivedAt && data.receivedAt.getTime() > Date.now() + 60_000) throw new ValidationError("The payment date can't be in the future.", { receivedAt: ["Can't be in the future"] });
    const id = newId();
    await tx.insert(payments).values({ id, organizationId: ctx.orgId, orderId, provider: "manual", method: data.method, amount, currency: o.currency, status: "succeeded", reference: data.reference, note: data.note, receivedAt: data.receivedAt ?? new Date(), recordedByUserId: ctx.userId });
    const r = await recompute(tx, orderId);
    await audit(tx, ctx, { action: "payment.recorded", entityType: "order", entityId: orderId, metadata: { paymentId: id, amount, currency: o.currency, method: data.method, reference: data.reference } });
    if (o.customerId) await audit(tx, ctx, { action: "customer.payment_recorded", entityType: "customer", entityId: o.customerId, metadata: { orderId, preview: `ORD-${o.number} · ${formatMoney(amount, o.currency)}` } });
    await emit(tx, ctx.orgId, "payment.recorded", { orderId, paymentId: id, amount, currency: o.currency, paymentStatus: r.status });
    return { id, ...r };
  });
}

export async function voidPayment(ctx: OrgContext, paymentId: string, reason: string) {
  need(ctx, "payments.record", "orders.financials");
  const why = parseInput(refundInputSchema.shape.reason, reason);
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.organizationId, ctx.orgId), eq(payments.id, paymentId)));
    if (!p) throw new NotFoundError("Payment not found.");
    if (p.provider !== "manual") throw new ConflictError("Provider payments can only be reversed with a refund.");
    if (p.voidedAt) throw new ConflictError("This payment is already voided.");
    const o = await loadOrderForWrite(tx, ctx, p.orderId);
    if (o.paidAmount - p.amount < o.refundedAmount) throw new ConflictError("Refunds already depend on this payment, so it can't be voided.");
    await tx.update(payments).set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: why }).where(eq(payments.id, paymentId));
    const r = await recompute(tx, p.orderId);
    await audit(tx, ctx, { action: "payment.voided", entityType: "order", entityId: p.orderId, metadata: { paymentId, amount: p.amount, reason: why } });
    return r;
  });
}

/** Refunds require their own permission; support agents can't issue them by default. */
export async function issueRefund(ctx: OrgContext, orderId: string, input: { amount: string | number; reason: string; method: string; paymentId?: string | null }) {
  need(ctx, "refunds.issue", "orders.financials");
  const data = parseInput(refundInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, orderId);
    const amount = money(data.amount, o.currency, "amount");
    const refundable = o.paidAmount - o.refundedAmount;
    if (refundable <= 0) throw new ConflictError("Nothing has been paid on this order, so there's nothing to refund.");
    if (amount > refundable) throw new ValidationError(`You can refund at most ${formatMoney(refundable, o.currency)}.`, { amount: [`At most ${formatMoney(refundable, o.currency)}`] });
    if (data.paymentId) {
      const [p] = await tx.select().from(payments).where(and(eq(payments.organizationId, ctx.orgId), eq(payments.id, data.paymentId), eq(payments.orderId, orderId)));
      if (!p || p.voidedAt || p.status !== "succeeded") throw new ValidationError("Choose a valid payment.", { paymentId: ["Choose a valid payment"] });
      const [{ already }] = await tx.select({ already: sql<string>`coalesce(sum(${refunds.amount}),0)` }).from(refunds).where(eq(refunds.paymentId, p.id));
      if (amount > p.amount - Number(already)) throw new ValidationError("That's more than remains refundable on this payment.", { amount: ["Exceeds the payment's refundable balance"] });
    }
    const id = newId();
    await tx.insert(refunds).values({ id, organizationId: ctx.orgId, orderId, paymentId: data.paymentId ?? null, amount, currency: o.currency, reason: data.reason, method: data.method, createdByUserId: ctx.userId });
    const r = await recompute(tx, orderId);
    await audit(tx, ctx, { action: "refund.issued", entityType: "order", entityId: orderId, metadata: { refundId: id, amount, currency: o.currency, reason: data.reason } });
    if (o.customerId) await audit(tx, ctx, { action: "customer.refund_issued", entityType: "customer", entityId: o.customerId, metadata: { orderId, preview: `ORD-${o.number} · ${formatMoney(amount, o.currency)}` } });
    await emit(tx, ctx.orgId, "refund.issued", { orderId, refundId: id, amount, currency: o.currency });
    return { id, ...r };
  });
}

export async function createFulfillment(ctx: OrgContext, orderId: string, input: unknown) {
  need(ctx, "orders.write");
  const data = parseInput(fulfillmentInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, orderId);
    if (o.orderStatus === "cancelled") throw new ConflictError("Cancelled orders can't be fulfilled.");
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).for("update");
    const merged = new Map<string, number>();
    for (const i of data.items) merged.set(i.orderItemId, (merged.get(i.orderItemId) ?? 0) + i.quantity);
    for (const [itemId, qty] of merged) {
      const it = items.find((x) => x.id === itemId);
      if (!it) throw new ValidationError("An item doesn't belong to this order.");
      if (it.fulfilledQuantity + qty > it.quantity) throw new ValidationError(`Only ${it.quantity - it.fulfilledQuantity} of “${it.name}” left to fulfill.`);
    }
    const id = newId();
    await tx.insert(fulfillments).values({ id, organizationId: ctx.orgId, orderId, status: data.status, carrier: data.carrier, trackingNumber: data.trackingNumber, trackingUrl: data.trackingUrl ?? null, note: data.note, deliveredAt: data.status === "delivered" || data.status === "picked_up" ? new Date() : null, createdByUserId: ctx.userId });
    await tx.insert(fulfillmentItems).values([...merged].map(([orderItemId, quantity]) => ({ organizationId: ctx.orgId, fulfillmentId: id, orderItemId, quantity })));
    for (const [itemId, qty] of merged) await tx.update(orderItems).set({ fulfilledQuantity: sql`${orderItems.fulfilledQuantity} + ${qty}` }).where(eq(orderItems.id, itemId));
    const after = await tx.select({ quantity: orderItems.quantity, fulfilledQuantity: orderItems.fulfilledQuantity }).from(orderItems).where(eq(orderItems.orderId, orderId));
    const status = deriveFulfillmentStatus(after);
    await tx.update(orders).set({ fulfillmentStatus: status }).where(eq(orders.id, orderId));
    await audit(tx, ctx, { action: "order.fulfillment_created", entityType: "order", entityId: orderId, metadata: { fulfillmentId: id, items: Object.fromEntries(merged), carrier: data.carrier, trackingNumber: data.trackingNumber, status } });
    if (status === "fulfilled") await emit(tx, ctx.orgId, "order.fulfilled", { orderId });
    return { id, fulfillmentStatus: status };
  });
}

export async function markFulfillmentDelivered(ctx: OrgContext, fulfillmentId: string) {
  need(ctx, "orders.write");
  return withTenant(ctx, async (tx) => {
    const [f] = await tx.select().from(fulfillments).where(and(eq(fulfillments.organizationId, ctx.orgId), eq(fulfillments.id, fulfillmentId)));
    if (!f) throw new NotFoundError("Shipment not found.");
    if (f.deliveredAt) return;
    await tx.update(fulfillments).set({ status: "delivered", deliveredAt: new Date() }).where(eq(fulfillments.id, fulfillmentId));
    await audit(tx, ctx, { action: "order.delivered", entityType: "order", entityId: f.orderId, metadata: { fulfillmentId } });
  });
}

export async function completeOrder(ctx: OrgContext, id: string) {
  need(ctx, "orders.write");
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, id);
    if (o.orderStatus !== "open") throw new ConflictError(`This order is already ${o.orderStatus}.`);
    await tx.update(orders).set({ orderStatus: "completed", completedAt: new Date() }).where(eq(orders.id, id));
    await audit(tx, ctx, { action: "order.completed", entityType: "order", entityId: id, metadata: { paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus } });
    await emit(tx, ctx.orgId, "order.completed", { orderId: id });
  });
}

export async function reopenOrder(ctx: OrgContext, id: string) {
  need(ctx, "orders.write");
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, id);
    if (o.orderStatus !== "completed") throw new ConflictError("Only completed orders can be reopened.");
    await tx.update(orders).set({ orderStatus: "open", completedAt: null }).where(eq(orders.id, id));
    await audit(tx, ctx, { action: "order.reopened", entityType: "order", entityId: id });
  });
}

/** Cancellation requires no net money held and nothing shipped — refund first, so books stay balanced. */
export async function cancelOrder(ctx: OrgContext, id: string, reason: string) {
  need(ctx, "orders.write");
  const why = parseInput(refundInputSchema.shape.reason, reason);
  return withTenant(ctx, async (tx) => {
    const o = await loadOrderForWrite(tx, ctx, id);
    if (o.orderStatus === "cancelled") return;
    if (o.paidAmount - o.refundedAmount > 0) throw new ConflictError(`${formatMoney(o.paidAmount - o.refundedAmount, o.currency)} has been paid. Refund it before cancelling.`);
    if (o.fulfillmentStatus !== "unfulfilled") throw new ConflictError("Items have already been fulfilled, so this order can't be cancelled.");
    await tx.update(orders).set({ orderStatus: "cancelled", cancelledAt: new Date(), cancelReason: why }).where(eq(orders.id, id));
    await audit(tx, ctx, { action: "order.cancelled", entityType: "order", entityId: id, metadata: { reason: why } });
    await emit(tx, ctx.orgId, "order.cancelled", { orderId: id });
  });
}

/* ───────────────────────── Reads ───────────────────────── */

function viewWhere(view: string): SQL | undefined {
  switch (view) {
    case "manual": return eq(orders.source, "manual");
    case "pending_payment": return and(eq(orders.orderStatus, "open"), inArray(orders.paymentStatus, ["unpaid", "partially_paid"]));
    case "processing": return and(eq(orders.orderStatus, "open"), eq(orders.paymentStatus, "paid"), eq(orders.fulfillmentStatus, "unfulfilled"));
    case "fulfillment": return and(eq(orders.orderStatus, "open"), inArray(orders.fulfillmentStatus, ["partially_fulfilled", "fulfilled"]));
    case "completed": return eq(orders.orderStatus, "completed");
    case "cancelled": return eq(orders.orderStatus, "cancelled");
    case "refunded": return inArray(orders.paymentStatus, ["partially_refunded", "refunded"]);
    default: return undefined;
  }
}

/** Hides amounts from users without orders.financials, and customer names they can't see. */
async function mask<T extends { customerId: string | null; customerName: string | null } & Record<string, unknown>>(tx: Tx, ctx: OrgContext, rows: T[], moneyKeys: (keyof T)[]) {
  const ids = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
  let visible: Set<string> | null = null;
  if (!ctx.permissions.has("customers.read")) {
    visible = new Set();
    if (ids.length && ctx.permissions.has("customers.read_assigned")) {
      for (const r of await tx.select({ id: customers.id }).from(customers).where(and(inArray(customers.id, ids), eq(customers.ownerMembershipId, ctx.membershipId)))) visible.add(r.id);
    }
  }
  const seeMoney = canSeeMoney(ctx);
  return rows.map((r) => {
    const out = { ...r, customerVisible: !r.customerId || visible === null || visible.has(r.customerId) };
    if (!out.customerVisible) out.customerName = "Restricted customer";
    if (!seeMoney) for (const k of moneyKeys) (out as Record<string, unknown>)[k as string] = null;
    return out;
  });
}

const listSelect = {
  id: orders.id,
  number: orders.number,
  externalId: orders.externalId,
  externalName: orders.externalName,
  source: orders.source,
  currency: orders.currency,
  totalAmount: orders.totalAmount,
  paidAmount: orders.paidAmount,
  refundedAmount: orders.refundedAmount,
  paymentStatus: orders.paymentStatus,
  orderStatus: orders.orderStatus,
  fulfillmentStatus: orders.fulfillmentStatus,
  placedAt: orders.placedAt,
  customerId: orders.customerId,
  customerName: customers.displayName,
  leadId: orders.leadId,
  assignedName: user.name,
  itemCount: sql<number>`(select coalesce(sum(quantity),0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
};

export async function listOrders(ctx: OrgContext, filters: OrderFilters & { lead?: string } = {}) {
  need(ctx, "orders.read");
  const f = parseInput(orderFiltersSchema, filters);
  return withTenant(ctx, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(orders.organizationId, ctx.orgId), viewWhere(f.view)];
    if (f.customer) conds.push(eq(orders.customerId, f.customer));
    if (filters.lead) conds.push(eq(orders.leadId, filters.lead));
    if (f.from) conds.push(gte(orders.placedAt, new Date(f.from)));
    if (f.to) conds.push(sql`${orders.placedAt} < ${f.to}::timestamptz`);
    if (f.assignee) conds.push(eq(orders.assignedMembershipId, f.assignee));
    if (f.moneyFrom && f.moneyTo) {
      conds.push(sql`(exists (select 1 from ${payments} where ${payments.orderId} = ${orders.id} and ${payments.status} = 'succeeded' and ${payments.voidedAt} is null and ${payments.receivedAt} >= ${f.moneyFrom}::timestamptz and ${payments.receivedAt} < ${f.moneyTo}::timestamptz)
        or exists (select 1 from ${refunds} where ${refunds.orderId} = ${orders.id} and ${refunds.refundedAt} >= ${f.moneyFrom}::timestamptz and ${refunds.refundedAt} < ${f.moneyTo}::timestamptz))`);
    }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const num = f.q.match(/^(?:ord-)?(\d+)$/i);
      conds.push(or(ilike(customers.displayName, like), ilike(orders.externalId, like), ilike(orders.externalName, like), num ? eq(orders.number, Number(num[1])) : undefined));
    }
    const where = and(...conds);
    const base = tx
      .select(listSelect)
      .from(orders)
      .leftJoin(customers, and(eq(customers.organizationId, orders.organizationId), eq(customers.id, orders.customerId)))
      .leftJoin(memberships, and(eq(memberships.organizationId, orders.organizationId), eq(memberships.id, orders.assignedMembershipId)))
      .leftJoin(user, eq(user.id, memberships.userId));
    const [{ total }] = await tx.select({ total: count() }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(where);
    const rows = await base.where(where).orderBy(desc(orders.placedAt), desc(orders.number)).limit(f.pageSize).offset((f.page - 1) * f.pageSize);
    return { rows: await mask(tx, ctx, rows, ["totalAmount", "paidAmount", "refundedAmount"]), total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)), filters: f };
  });
}
export type OrderRow = Awaited<ReturnType<typeof listOrders>>["rows"][number];

export async function getOrder(ctx: OrgContext, id: string) {
  need(ctx, "orders.read");
  return withTenant(ctx, async (tx) => {
    const [o] = await tx
      .select({ order: orders, customerName: customers.displayName, assignedName: user.name, leadTitle: leads.title, leadOwner: leads.ownerMembershipId })
      .from(orders)
      .leftJoin(customers, and(eq(customers.organizationId, orders.organizationId), eq(customers.id, orders.customerId)))
      .leftJoin(memberships, and(eq(memberships.organizationId, orders.organizationId), eq(memberships.id, orders.assignedMembershipId)))
      .leftJoin(user, eq(user.id, memberships.userId))
      .leftJoin(leads, and(eq(leads.organizationId, orders.organizationId), eq(leads.id, orders.leadId)))
      .where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, id)));
    if (!o) return null;
    const seeMoney = canSeeMoney(ctx);
    const [items, pays, refs, ships] = await Promise.all([
      tx.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.position)),
      seeMoney ? tx.select({ p: payments, by: user.name }).from(payments).leftJoin(user, eq(user.id, payments.recordedByUserId)).where(eq(payments.orderId, id)).orderBy(asc(payments.receivedAt)) : Promise.resolve([]),
      seeMoney ? tx.select({ r: refunds, by: user.name }).from(refunds).leftJoin(user, eq(user.id, refunds.createdByUserId)).where(eq(refunds.orderId, id)).orderBy(asc(refunds.refundedAt)) : Promise.resolve([]),
      tx.select().from(fulfillments).where(eq(fulfillments.orderId, id)).orderBy(asc(fulfillments.shippedAt)),
    ]);
    const shipItems = ships.length ? await tx.select().from(fulfillmentItems).where(inArray(fulfillmentItems.fulfillmentId, ships.map((s) => s.id))) : [];
    const [masked] = await mask(tx, ctx, [{ ...o.order, customerName: o.customerName }], ["subtotalAmount", "discountAmount", "taxAmount", "shippingAmount", "totalAmount", "paidAmount", "refundedAmount"]);
    const leadVisible = !!o.order.leadId && (ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && o.leadOwner === ctx.membershipId));
    return {
      ...masked,
      assignedName: o.assignedName,
      lead: o.order.leadId ? { id: o.order.leadId, title: leadVisible ? o.leadTitle : "Restricted lead", visible: leadVisible } : null,
      financialsVisible: seeMoney,
      items: items.map((i) => (seeMoney ? i : { ...i, unitPriceAmount: null, discountAmount: null, lineTotalAmount: null })),
      payments: pays.map((x) => ({ ...x.p, recordedBy: x.by })),
      refunds: refs.map((x) => ({ ...x.r, createdBy: x.by })),
      fulfillments: ships.map((s) => ({ ...s, items: shipItems.filter((i) => i.fulfillmentId === s.id).map((i) => ({ ...i, name: items.find((x) => x.id === i.orderItemId)?.name ?? "Item" })) })),
    };
  });
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

export async function getOrderTimeline(ctx: OrgContext, id: string) {
  need(ctx, "orders.read");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, metadata: auditLogs.metadata, changes: auditLogs.changes, createdAt: auditLogs.createdAt, actorName: user.name })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "order"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  );
}

/** Lifetime value per currency for one customer. Net = captured payments minus refunds. */
export async function getCustomerCommerce(ctx: OrgContext, customerId: string) {
  if (!ctx.permissions.has("orders.read")) return null;
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        currency: orders.currency,
        orders: count(),
        booked: sum(orders.totalAmount),
        net: sql<string>`coalesce(sum(${orders.paidAmount} - ${orders.refundedAmount}),0)`,
        lastPurchase: sql<Date | null>`max(${orders.placedAt})`,
      })
      .from(orders)
      .where(and(eq(orders.organizationId, ctx.orgId), eq(orders.customerId, customerId), ne(orders.orderStatus, "cancelled")))
      .groupBy(orders.currency);
    const seeMoney = canSeeMoney(ctx);
    const totalOrders = rows.reduce((a, r) => a + r.orders, 0);
    const last = rows.map((r) => (r.lastPurchase ? new Date(r.lastPurchase) : null)).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      totalOrders,
      lastPurchase: last,
      byCurrency: rows.map((r) => ({
        currency: r.currency,
        orders: r.orders,
        lifetimeNet: seeMoney ? Number(r.net) : null,
        averageOrder: seeMoney && r.orders ? Math.round(Number(r.booked) / r.orders) : null,
      })),
    };
  });
}

/**
 * Commerce headline numbers for a period. Booked orders, captured payments and refunds are reported
 * separately and per currency; nothing is summed across currencies.
 */
export async function getCommerceStats(ctx: OrgContext, days = 30) {
  if (!ctx.permissions.has("orders.read")) return null;
  return withTenant(ctx, async (tx) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const seeMoney = canSeeMoney(ctx);
    const booked = await tx.select({ currency: orders.currency, n: count(), amount: sum(orders.totalAmount) }).from(orders).where(and(eq(orders.organizationId, ctx.orgId), ne(orders.orderStatus, "cancelled"), gte(orders.placedAt, since))).groupBy(orders.currency);
    const captured = await tx.select({ currency: payments.currency, amount: sum(payments.amount) }).from(payments).where(and(eq(payments.organizationId, ctx.orgId), eq(payments.status, "succeeded"), isNull(payments.voidedAt), gte(payments.receivedAt, since))).groupBy(payments.currency);
    const refunded = await tx.select({ currency: refunds.currency, amount: sum(refunds.amount) }).from(refunds).where(and(eq(refunds.organizationId, ctx.orgId), gte(refunds.refundedAt, since))).groupBy(refunds.currency);
    const [counts] = await tx
      .select({
        pending: sql<number>`count(*) filter (where ${orders.orderStatus} = 'open' and ${orders.fulfillmentStatus} <> 'fulfilled')::int`,
        unpaid: sql<number>`count(*) filter (where ${orders.orderStatus} = 'open' and ${orders.paymentStatus} in ('unpaid','partially_paid'))::int`,
      })
      .from(orders)
      .where(eq(orders.organizationId, ctx.orgId));
    const topProducts = await tx
      .select({ productId: orderItems.productId, name: orderItems.name, units: sql<number>`sum(${orderItems.quantity})::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.organizationId, ctx.orgId), ne(orders.orderStatus, "cancelled"), gte(orders.placedAt, since)))
      .groupBy(orderItems.productId, orderItems.name)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(5);
    const toMap = (rows: { currency: string; amount: string | null }[]) => (seeMoney ? Object.fromEntries(rows.map((r) => [r.currency, Number(r.amount ?? 0)])) : null);
    const cap = toMap(captured) ?? {};
    const ref = toMap(refunded) ?? {};
    const net = seeMoney ? Object.fromEntries([...new Set([...Object.keys(cap), ...Object.keys(ref)])].map((c) => [c, (cap[c] ?? 0) - (ref[c] ?? 0)])) : null;
    return {
      days,
      ordersBooked: booked.reduce((a, r) => a + r.n, 0),
      booked: toMap(booked),
      captured: seeMoney ? cap : null,
      refunded: seeMoney ? ref : null,
      netRevenue: net,
      pendingOrders: counts.pending,
      unpaidOrders: counts.unpaid,
      topProducts,
    };
  });
}

/* ───────────── Provider-confirmed money (webhooks only) ───────────── */

/**
 * Records a payment confirmed by a provider webhook (never by a client redirect).
 * Idempotent on (provider, providerPaymentId). Real money is recorded even if it
 * overpays the balance; the audit entry flags it.
 */
export async function recordProviderPayment(
  tx: Tx,
  orgId: string,
  p: { orderId: string; provider: string; providerPaymentId: string; amount: number; currency: string; method: "card" | "payment_link" | "other" | "bank_transfer" | "mobile_money" | "cash"; reference?: string | null; receivedAt?: Date },
) {
  const [dup] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.organizationId, orgId), eq(payments.provider, p.provider), eq(payments.providerPaymentId, p.providerPaymentId)));
  if (dup) return { id: dup.id, duplicate: true as const };
  const [o] = await tx.select().from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.id, p.orderId))).for("update");
  if (!o) throw new NotFoundError("Order not found for provider payment.");
  if (o.currency !== p.currency.toUpperCase()) throw new ValidationError(`Provider payment currency ${p.currency} doesn't match order currency ${o.currency}.`);
  const id = newId();
  await tx.insert(payments).values({ id, organizationId: orgId, orderId: o.id, provider: p.provider, providerPaymentId: p.providerPaymentId, method: p.method, amount: p.amount, currency: o.currency, status: "succeeded", reference: p.reference ?? null, receivedAt: p.receivedAt ?? new Date(), recordedByUserId: null });
  const r = await recompute(tx, o.id);
  const due = o.totalAmount - (o.paidAmount - o.refundedAmount);
  const actor = { orgId, userId: null };
  await audit(tx, actor, { action: "payment.recorded", entityType: "order", entityId: o.id, metadata: { paymentId: id, amount: p.amount, currency: o.currency, provider: p.provider, providerPaymentId: p.providerPaymentId, overpaid: p.amount > due ? p.amount - due : undefined } });
  if (o.customerId) await audit(tx, actor, { action: "customer.payment_recorded", entityType: "customer", entityId: o.customerId, metadata: { orderId: o.id, preview: `ORD-${o.number} · ${formatMoney(p.amount, o.currency)} via ${p.provider}` } });
  await emit(tx, orgId, "payment.recorded", { orderId: o.id, paymentId: id, amount: p.amount, currency: o.currency, provider: p.provider, paymentStatus: r.status });
  return { id, duplicate: false as const, order: o, ...r };
}

/** Records a refund confirmed by the provider, matched to the original provider payment. */
export async function recordProviderRefund(
  tx: Tx,
  orgId: string,
  p: { provider: string; providerRefundId: string; providerPaymentId: string; amount: number; currency: string; reason?: string | null },
) {
  const [dup] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.organizationId, orgId), eq(refunds.provider, p.provider), eq(refunds.providerRefundId, p.providerRefundId)));
  if (dup) return { id: dup.id, duplicate: true as const };
  const [pay] = await tx.select().from(payments).where(and(eq(payments.organizationId, orgId), eq(payments.provider, p.provider), eq(payments.providerPaymentId, p.providerPaymentId)));
  if (!pay) return { id: null, duplicate: false as const, skipped: "no matching payment" };
  const [o] = await tx.select().from(orders).where(eq(orders.id, pay.orderId)).for("update");
  const room = o.paidAmount - o.refundedAmount;
  if (p.amount > room) throw new ValidationError(`Provider refund ${p.amount} exceeds the refundable ${room} on ORD-${o.number}.`);
  const id = newId();
  await tx.insert(refunds).values({ id, organizationId: orgId, orderId: o.id, paymentId: pay.id, provider: p.provider, providerRefundId: p.providerRefundId, amount: p.amount, currency: o.currency, reason: p.reason || `Refunded in ${p.provider}`, method: pay.method, createdByUserId: null });
  const r = await recompute(tx, o.id);
  await audit(tx, { orgId, userId: null }, { action: "refund.issued", entityType: "order", entityId: o.id, metadata: { refundId: id, amount: p.amount, currency: o.currency, provider: p.provider, reason: p.reason ?? undefined } });
  await emit(tx, orgId, "refund.issued", { orderId: o.id, refundId: id, amount: p.amount, currency: o.currency, provider: p.provider });
  return { id, duplicate: false as const, ...r };
}
