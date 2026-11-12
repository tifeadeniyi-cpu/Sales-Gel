import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createCustomer, getCustomerTimeline } from "@/domains/customers/service";
import { mergeCustomers, unmergeCustomers } from "@/domains/customers/duplicates";
import { createLead } from "@/domains/sales/service";
import { createProduct, getProduct, listProducts, updateProduct } from "@/domains/commerce/products";
import {
  cancelOrder,
  completeOrder,
  createFulfillment,
  createOrder,
  getCommerceStats,
  getCustomerCommerce,
  getOrder,
  getOrderTimeline,
  issueRefund,
  listOrders,
  recordPayment,
  updateOrderItems,
  voidPayment,
} from "@/domains/commerce/orders";
import { orders, payments, refunds } from "@/domains/commerce/schema";
import { isPermissionDenied } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];

async function setup(name = "Shop") {
  const { ctx } = await createOrgWithOwner(name);
  const { id: productId } = await createProduct(ctx, {
    name: "Ankara Dress",
    category: "Dresses",
    variants: [
      { name: "Small", sku: "ANK-S", price: "45.00", inventoryQuantity: 3 },
      { name: "Large", sku: "ANK-L", price: "50.00" },
    ],
  });
  const product = (await getProduct(ctx, productId))!;
  const customer = await createCustomer(ctx, { firstName: "Ada", lastName: "Obi", emails: [{ email: "ada@example.com" }] });
  return { ctx, productId, product, small: product.variants.find((v) => v.name === "Small")!, large: product.variants.find((v) => v.name === "Large")!, customer };
}

async function rawOrder(ctx: Ctx, id: string) {
  return withTenant(ctx, async (tx) => (await tx.select().from(orders).where(eq(orders.id, id)))[0]);
}

describe("products", () => {
  it("creates products with variants and rejects duplicate SKUs (case-insensitive)", async () => {
    const { ctx } = await setup();
    const list = await listProducts(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ankara Dress", minPrice: 4500, maxPrice: 5000 });
    await expect(createProduct(ctx, { name: "Copy", variants: [{ sku: "ank-s", price: "1" }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("price changes never touch existing order snapshots", async () => {
    const { ctx, productId, product, small, customer } = await setup();
    const { id } = await createOrder(ctx, { customerId: customer.id, lines: [{ variantId: small.id, quantity: 1 }] });
    await updateProduct(ctx, productId, {
      name: "Ankara Dress v2",
      variants: product.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: v.id === small.id ? "99.00" : "50.00" })),
    });
    const o = (await getOrder(ctx, id))!;
    expect(o.items[0]).toMatchObject({ name: "Ankara Dress", variantName: "Small", sku: "ANK-S", unitPriceAmount: 4500 });
  });
});

describe("orders: creation and totals", () => {
  it("computes totals with line discount, order discount, tax and shipping", async () => {
    const { ctx, small, large, customer } = await setup();
    const { id, number } = await createOrder(ctx, {
      customerId: customer.id,
      lines: [
        { variantId: small.id, quantity: 2, discount: "10.00" }, // 90 - 10 = 80
        { variantId: large.id, quantity: 1 }, // 50
        { name: "Gift wrap", unitPrice: "5.00", quantity: 1 }, // 5
      ],
      orderDiscount: "15.00", // 135 - 15 = 120
      taxRate: "7.5", // 9.00
      shipping: "12.00",
    });
    expect(number).toBe(1001);
    const o = await rawOrder(ctx, id);
    expect(o).toMatchObject({ subtotalAmount: 13500, discountAmount: 1500, taxRateBps: 750, taxAmount: 900, shippingAmount: 1200, totalAmount: 14100, paymentStatus: "unpaid", orderStatus: "open", fulfillmentStatus: "unfulfilled", currency: "USD" });
    const second = await createOrder(ctx, { lines: [{ name: "Custom", unitPrice: "1", quantity: 1 }] });
    expect(second.number).toBe(1002);
  });

  it("validates lines, currency and discounts", async () => {
    const { ctx, small, customer } = await setup();
    await expect(createOrder(ctx, { customerId: customer.id, lines: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(ctx, { lines: [{ name: "Custom", quantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(ctx, { lines: [{ variantId: small.id, quantity: 1, discount: "100.00" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(ctx, { currency: "EUR", lines: [{ variantId: small.id, quantity: 1 }] })).rejects.toThrow(/priced in USD/);
    await expect(createOrder(ctx, { lines: [{ name: "X", unitPrice: "1", quantity: 1 }], taxRate: "abc" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("links to a lead, inherits its customer and logs on both timelines", async () => {
    const { ctx, small, customer } = await setup();
    const lead = await createLead(ctx, { title: "Wedding order", customerId: customer.id });
    const { id } = await createOrder(ctx, { leadId: lead.id, lines: [{ variantId: small.id, quantity: 1 }] });
    const o = (await getOrder(ctx, id))!;
    expect(o.customerId).toBe(customer.id);
    expect(o.lead).toMatchObject({ id: lead.id, title: "Wedding order", visible: true });
    const tl = await getCustomerTimeline(ctx, customer.id);
    expect(tl.some((e) => e.action === "customer.order_created")).toBe(true);
    const other = await createCustomer(ctx, { firstName: "Other" });
    await expect(createOrder(ctx, { leadId: lead.id, customerId: other.id, lines: [{ variantId: small.id, quantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses archived variants", async () => {
    const { ctx, productId, product, small } = await setup();
    await updateProduct(ctx, productId, { name: product.name, variants: product.variants.filter((v) => v.id !== small.id).map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: "50.00" })) });
    await expect(createOrder(ctx, { lines: [{ variantId: small.id, quantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("payments and refunds", () => {
  it("tracks partial → paid → partially refunded → refunded", async () => {
    const { ctx, large, customer } = await setup();
    const { id } = await createOrder(ctx, { customerId: customer.id, lines: [{ variantId: large.id, quantity: 2 }] }); // 100.00
    let r = await recordPayment(ctx, id, { amount: "40.00", method: "bank_transfer", reference: "TRX-1" });
    expect(r.status).toBe("partially_paid");
    await expect(recordPayment(ctx, id, { amount: "60.01", method: "cash" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordPayment(ctx, id, { amount: "0", method: "cash" })).rejects.toBeInstanceOf(ValidationError);
    r = await recordPayment(ctx, id, { amount: "60.00", method: "cash" });
    expect(r).toMatchObject({ status: "paid", paid: 10000 });
    await expect(recordPayment(ctx, id, { amount: "1.00", method: "cash" })).rejects.toBeInstanceOf(ValidationError);

    r = await issueRefund(ctx, id, { amount: "25.00", reason: "Damaged hem", method: "cash" });
    expect(r).toMatchObject({ status: "partially_refunded", refunded: 2500 });
    await expect(issueRefund(ctx, id, { amount: "75.01", reason: "Too much", method: "cash" })).rejects.toBeInstanceOf(ValidationError);
    r = await issueRefund(ctx, id, { amount: "75.00", reason: "Returned", method: "cash" });
    expect(r.status).toBe("refunded");
    const o = (await getOrder(ctx, id))!;
    expect(o.payments).toHaveLength(2);
    expect(o.refunds).toHaveLength(2);
    expect((await getOrderTimeline(ctx, id)).map((e) => e.action)).toEqual(expect.arrayContaining(["order.created", "payment.recorded", "refund.issued"]));
  });

  it("limits a refund to what remains on the chosen payment", async () => {
    const { ctx, large } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 2 }] });
    const p1 = await recordPayment(ctx, id, { amount: "30.00", method: "cash" });
    await recordPayment(ctx, id, { amount: "70.00", method: "card" });
    await expect(issueRefund(ctx, id, { amount: "30.01", reason: "x refund", method: "cash", paymentId: p1.id })).rejects.toBeInstanceOf(ValidationError);
    await issueRefund(ctx, id, { amount: "30.00", reason: "full first payment", method: "cash", paymentId: p1.id });
  });

  it("voids manual payments but not ones refunds depend on", async () => {
    const { ctx, large } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 1 }] });
    const p = await recordPayment(ctx, id, { amount: "50.00", method: "cash" });
    expect((await voidPayment(ctx, p.id, "Entered twice")).status).toBe("unpaid");
    await expect(voidPayment(ctx, p.id, "again")).rejects.toBeInstanceOf(ConflictError);
    const p2 = await recordPayment(ctx, id, { amount: "50.00", method: "cash" });
    await issueRefund(ctx, id, { amount: "10.00", reason: "Discount after", method: "cash" });
    await expect(voidPayment(ctx, p2.id, "oops")).rejects.toBeInstanceOf(ConflictError);
  });

  it("payments and refunds are append-only at the database level", async () => {
    const { ctx, large } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 1 }] });
    await recordPayment(ctx, id, { amount: "50.00", method: "cash" });
    await issueRefund(ctx, id, { amount: "5.00", reason: "Goodwill", method: "cash" });
    const tryIt = (fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<unknown>) => withTenant(ctx, fn).then(() => null, (e) => e);
    expect(isPermissionDenied(await tryIt((tx) => tx.update(payments).set({ amount: 1 }).where(eq(payments.orderId, id))))).toBe(true);
    expect(isPermissionDenied(await tryIt((tx) => tx.delete(payments).where(eq(payments.orderId, id))))).toBe(true);
    expect(isPermissionDenied(await tryIt((tx) => tx.update(refunds).set({ amount: 1 }).where(eq(refunds.orderId, id))))).toBe(true);
    expect(isPermissionDenied(await tryIt((tx) => tx.delete(refunds).where(eq(refunds.orderId, id))))).toBe(true);
  });

  it("enforces refunded ≤ paid with a database check", async () => {
    const { ctx, large } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 1 }] });
    const err = await withTenant(ctx, (tx) => tx.update(orders).set({ refundedAmount: 100 }).where(eq(orders.id, id))).then(() => null, (e) => e);
    expect(err).toBeTruthy();
  });

  it("permissions: reps can't record payments, support agents can't refund or see money", async () => {
    const { ctx, large, customer } = await setup();
    const { id } = await createOrder(ctx, { customerId: customer.id, lines: [{ variantId: large.id, quantity: 1 }] });
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    const { ctx: mgr } = await addMember(ctx, "sales_manager");
    await expect(recordPayment(rep, id, { amount: "1", method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await recordPayment(mgr, id, { amount: "50", method: "cash" });
    await expect(issueRefund(mgr, id, { amount: "1", reason: "nope", method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(issueRefund(agent, id, { amount: "1", reason: "nope", method: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createOrder(agent, { lines: [{ name: "x", unitPrice: "1", quantity: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);

    const seen = (await getOrder(agent, id))!;
    expect(seen.totalAmount).toBeNull();
    expect(seen.payments).toEqual([]);
    expect(seen.items[0].unitPriceAmount).toBeNull();
    expect((await listOrders(agent)).rows[0].totalAmount).toBeNull();
    expect((await getCommerceStats(agent))!.netRevenue).toBeNull();
    expect((await getCustomerCommerce(agent, customer.id))!.byCurrency[0].lifetimeNet).toBeNull();
  });
});

describe("fulfillment and order status", () => {
  it("partial then full fulfillment; can't over-fulfill", async () => {
    const { ctx, small } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: small.id, quantity: 3 }] });
    const item = (await getOrder(ctx, id))!.items[0];
    expect((await createFulfillment(ctx, id, { items: [{ orderItemId: item.id, quantity: 1 }], carrier: "DHL", trackingNumber: "123" })).fulfillmentStatus).toBe("partially_fulfilled");
    await expect(createFulfillment(ctx, id, { items: [{ orderItemId: item.id, quantity: 3 }] })).rejects.toBeInstanceOf(ValidationError);
    expect((await createFulfillment(ctx, id, { items: [{ orderItemId: item.id, quantity: 2 }], status: "picked_up" })).fulfillmentStatus).toBe("fulfilled");
    const o = (await getOrder(ctx, id))!;
    expect(o.fulfillments).toHaveLength(2);
    expect(o.items[0].fulfilledQuantity).toBe(3);
  });

  it("locks items after payment; cancel requires refund and no fulfillment", async () => {
    const { ctx, large, small } = await setup();
    const { id } = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 1 }] });
    await updateOrderItems(ctx, id, { lines: [{ variantId: small.id, quantity: 2 }] });
    expect((await rawOrder(ctx, id)).totalAmount).toBe(9000);
    await recordPayment(ctx, id, { amount: "20", method: "cash" });
    await expect(updateOrderItems(ctx, id, { lines: [{ variantId: small.id, quantity: 1 }] })).rejects.toBeInstanceOf(ConflictError);
    await expect(cancelOrder(ctx, id, "Customer changed mind")).rejects.toBeInstanceOf(ConflictError);
    await issueRefund(ctx, id, { amount: "20", reason: "Cancelling", method: "cash" });
    await cancelOrder(ctx, id, "Customer changed mind");
    expect((await rawOrder(ctx, id)).orderStatus).toBe("cancelled");
    await expect(recordPayment(ctx, id, { amount: "1", method: "cash" })).rejects.toBeInstanceOf(ConflictError);

    const b = await createOrder(ctx, { lines: [{ variantId: small.id, quantity: 1 }] });
    const it = (await getOrder(ctx, b.id))!.items[0];
    await createFulfillment(ctx, b.id, { items: [{ orderItemId: it.id, quantity: 1 }] });
    await expect(cancelOrder(ctx, b.id, "late")).rejects.toBeInstanceOf(ConflictError);
    await completeOrder(ctx, b.id);
    await expect(completeOrder(ctx, b.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("lists, metrics, merge, isolation", () => {
  it("views filter correctly and search matches number and customer", async () => {
    const { ctx, large, customer } = await setup();
    const a = await createOrder(ctx, { customerId: customer.id, lines: [{ variantId: large.id, quantity: 1 }] });
    const b = await createOrder(ctx, { lines: [{ variantId: large.id, quantity: 1 }] });
    await recordPayment(ctx, b.id, { amount: "50", method: "cash" });
    expect((await listOrders(ctx, { view: "pending_payment" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await listOrders(ctx, { view: "processing" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await listOrders(ctx, { q: "ada" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await listOrders(ctx, { q: `ORD-${b.number}` })).rows.map((r) => r.id)).toEqual([b.id]);
  });

  it("customer and org metrics are per currency and net of refunds", async () => {
    const { ctx, large, customer } = await setup();
    const a = await createOrder(ctx, { customerId: customer.id, lines: [{ variantId: large.id, quantity: 2 }] });
    await recordPayment(ctx, a.id, { amount: "100", method: "cash" });
    await issueRefund(ctx, a.id, { amount: "20", reason: "Partial return", method: "cash" });
    await createOrder(ctx, { customerId: customer.id, currency: "EUR", lines: [{ name: "Custom", unitPrice: "30", quantity: 1 }] });
    const cc = (await getCustomerCommerce(ctx, customer.id))!;
    expect(cc.totalOrders).toBe(2);
    expect(cc.byCurrency.find((c) => c.currency === "USD")).toMatchObject({ orders: 1, lifetimeNet: 8000, averageOrder: 10000 });
    expect(cc.byCurrency.find((c) => c.currency === "EUR")).toMatchObject({ orders: 1, lifetimeNet: 0 });
    const s = (await getCommerceStats(ctx))!;
    expect(s.netRevenue).toEqual({ USD: 8000 });
    expect(s.booked).toEqual({ USD: 10000, EUR: 3000 });
    expect(s).toMatchObject({ ordersBooked: 2, unpaidOrders: 1 });
    expect(s.topProducts[0]).toMatchObject({ name: "Ankara Dress", units: 2 });
  });

  it("customer merge moves orders and unmerge restores them", async () => {
    const { ctx, large, customer } = await setup();
    const dup = await createCustomer(ctx, { firstName: "Ada", lastName: "O." });
    const { id } = await createOrder(ctx, { customerId: dup.id, lines: [{ variantId: large.id, quantity: 1 }] });
    const merge = await mergeCustomers(ctx, customer.id, dup.id);
    expect((await rawOrder(ctx, id)).customerId).toBe(customer.id);
    await unmergeCustomers(ctx, merge.mergeId);
    expect((await rawOrder(ctx, id)).customerId).toBe(dup.id);
  });

  it("tenants can't see or touch each other's orders", async () => {
    const a = await setup("TenantA");
    const b = await setup("TenantB");
    const { id } = await createOrder(a.ctx, { customerId: a.customer.id, lines: [{ variantId: a.small.id, quantity: 1 }] });
    expect(await getOrder(b.ctx, id)).toBeNull();
    await expect(recordPayment(b.ctx, id, { amount: "1", method: "cash" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createOrder(b.ctx, { lines: [{ variantId: a.small.id, quantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(b.ctx, { customerId: a.customer.id, lines: [{ name: "x", unitPrice: "1", quantity: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    const leaked = await withTenant(b.ctx, (tx) => tx.execute(sql`select count(*)::int as n from orders where id = ${id}`));
    expect((leaked as unknown as { n: number }[])[0].n).toBe(0);
    expect((await listOrders(b.ctx)).total).toBe(0);
  });
});
