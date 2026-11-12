import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { customers } from "@/domains/customers/schema";
import { leads } from "@/domains/sales/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

/** A sales channel source. Every org has a "Manual" store; integrations add Shopify etc. in Phase 6. */
export const stores = pgTable(
  "stores",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("manual"),
    currency: text("currency").notNull(),
    externalAccountId: text("external_account_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("stores_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("stores_manual_uq").on(t.organizationId).where(sql`${t.provider} = 'manual'`),
    orgFk("stores_org_fk", t),
    check("stores_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    organizationId: organizationId(),
    storeId: uuid("store_id").notNull(),
    externalId: text("external_id"),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    brand: text("brand"),
    imageUrl: text("image_url"),
    status: text("status").notNull().default("active"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("products_org_id_uq").on(t.organizationId, t.id),
    index("products_org_name_idx").on(t.organizationId, t.name),
    index("products_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    uniqueIndex("products_external_uq").on(t.organizationId, t.storeId, t.externalId).where(sql`${t.externalId} is not null`),
    foreignKey({ name: "products_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    check("products_status_chk", sql`${t.status} in ('active','draft','archived')`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    organizationId: organizationId(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull().default("Default"),
    sku: text("sku"),
    priceAmount: bigint("price_amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** Quantity reported by the source system (null = not tracked). Not a warehouse ledger. */
    inventoryQuantity: integer("inventory_quantity"),
    inventorySyncedAt: tsz("inventory_synced_at"),
    externalId: text("external_id"),
    position: integer("position").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("product_variants_org_id_uq").on(t.organizationId, t.id),
    unique("product_variants_product_id_uq").on(t.organizationId, t.productId, t.id),
    uniqueIndex("product_variants_sku_uq").on(t.organizationId, sql`lower(${t.sku})`).where(sql`${t.sku} is not null and ${t.status} <> 'archived'`),
    foreignKey({ name: "product_variants_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }).onDelete("cascade"),
    check("product_variants_price_chk", sql`${t.priceAmount} >= 0`),
    check("product_variants_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("product_variants_status_chk", sql`${t.status} in ('active','archived')`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    organizationId: organizationId(),
    number: bigint("number", { mode: "number" }).notNull(),
    externalId: text("external_id"),
    storeId: uuid("store_id").notNull(),
    customerId: uuid("customer_id"),
    leadId: uuid("lead_id"),
    source: text("source").notNull().default("manual"),
    currency: text("currency").notNull(),
    subtotalAmount: bigint("subtotal_amount", { mode: "number" }).notNull(),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    taxAmount: bigint("tax_amount", { mode: "number" }).notNull().default(0),
    shippingAmount: bigint("shipping_amount", { mode: "number" }).notNull().default(0),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    /** Cached sums of payments/refunds, recomputed in the same transaction as every money movement. */
    paidAmount: bigint("paid_amount", { mode: "number" }).notNull().default(0),
    refundedAmount: bigint("refunded_amount", { mode: "number" }).notNull().default(0),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    orderStatus: text("order_status").notNull().default("open"),
    fulfillmentStatus: text("fulfillment_status").notNull().default("unfulfilled"),
    assignedMembershipId: uuid("assigned_membership_id"),
    deliveryMethod: text("delivery_method"),
    shippingAddress: jsonb("shipping_address").$type<Record<string, string | null>>(),
    billingAddress: jsonb("billing_address").$type<Record<string, string | null>>(),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    placedAt: tsz("placed_at").notNull().defaultNow(),
    completedAt: tsz("completed_at"),
    cancelledAt: tsz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("orders_org_id_uq").on(t.organizationId, t.id),
    unique("orders_org_number_uq").on(t.organizationId, t.number),
    uniqueIndex("orders_external_uq").on(t.organizationId, t.storeId, t.externalId).where(sql`${t.externalId} is not null`),
    index("orders_org_placed_idx").on(t.organizationId, t.placedAt.desc()),
    index("orders_customer_idx").on(t.organizationId, t.customerId),
    index("orders_status_idx").on(t.organizationId, t.orderStatus, t.paymentStatus, t.fulfillmentStatus),
    foreignKey({ name: "orders_store_fk", columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
    foreignKey({ name: "orders_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "orders_lead_fk", columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }),
    check("orders_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("orders_amounts_chk", sql`${t.subtotalAmount} >= 0 and ${t.discountAmount} >= 0 and ${t.taxAmount} >= 0 and ${t.shippingAmount} >= 0 and ${t.totalAmount} >= 0 and ${t.paidAmount} >= 0 and ${t.refundedAmount} >= 0`),
    check("orders_total_chk", sql`${t.totalAmount} = ${t.subtotalAmount} - ${t.discountAmount} + ${t.taxAmount} + ${t.shippingAmount}`),
    check("orders_refund_chk", sql`${t.refundedAmount} <= ${t.paidAmount}`),
    check("orders_payment_status_chk", sql`${t.paymentStatus} in ('unpaid','partially_paid','paid','partially_refunded','refunded')`),
    check("orders_order_status_chk", sql`${t.orderStatus} in ('open','completed','cancelled')`),
    check("orders_fulfillment_status_chk", sql`${t.fulfillmentStatus} in ('unfulfilled','partially_fulfilled','fulfilled')`),
  ],
);

/** Immutable snapshot of what was sold: name, SKU and price are copied at order time. */
export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    organizationId: organizationId(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    name: text("name").notNull(),
    variantName: text("variant_name"),
    sku: text("sku"),
    unitPriceAmount: bigint("unit_price_amount", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    discountAmount: bigint("discount_amount", { mode: "number" }).notNull().default(0),
    lineTotalAmount: bigint("line_total_amount", { mode: "number" }).notNull(),
    fulfilledQuantity: integer("fulfilled_quantity").notNull().default(0),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("order_items_org_id_uq").on(t.organizationId, t.id),
    unique("order_items_order_id_uq").on(t.organizationId, t.orderId, t.id),
    index("order_items_order_idx").on(t.organizationId, t.orderId),
    index("order_items_product_idx").on(t.organizationId, t.productId),
    foreignKey({ name: "order_items_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }).onDelete("cascade"),
    foreignKey({ name: "order_items_variant_fk", columns: [t.organizationId, t.variantId], foreignColumns: [productVariants.organizationId, productVariants.id] }),
    foreignKey({ name: "order_items_product_fk", columns: [t.organizationId, t.productId], foreignColumns: [products.organizationId, products.id] }),
    check("order_items_qty_chk", sql`${t.quantity} > 0 and ${t.fulfilledQuantity} between 0 and ${t.quantity}`),
    check("order_items_amount_chk", sql`${t.unitPriceAmount} >= 0 and ${t.discountAmount} >= 0 and ${t.lineTotalAmount} = ${t.unitPriceAmount} * ${t.quantity} - ${t.discountAmount}`),
  ],
);

/**
 * Money received. Append-only (the app role may only set the void columns).
 * provider='manual' rows are staff-recorded; provider rows are created only from verified events (Phase 6).
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    organizationId: organizationId(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").notNull().default("manual"),
    providerPaymentId: text("provider_payment_id"),
    method: text("method").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("succeeded"),
    reference: text("reference"),
    note: text("note"),
    receivedAt: tsz("received_at").notNull().defaultNow(),
    recordedByUserId: text("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    voidedAt: tsz("voided_at"),
    voidedByUserId: text("voided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("payments_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("payments_provider_uq").on(t.organizationId, t.provider, t.providerPaymentId).where(sql`${t.providerPaymentId} is not null`),
    index("payments_order_idx").on(t.organizationId, t.orderId),
    index("payments_received_idx").on(t.organizationId, t.receivedAt),
    foreignKey({ name: "payments_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }),
    check("payments_amount_chk", sql`${t.amount} > 0`),
    check("payments_status_chk", sql`${t.status} in ('succeeded','pending','failed')`),
    check("payments_method_chk", sql`${t.method} in ('cash','bank_transfer','card','mobile_money','payment_link','other')`),
  ],
);

/** Money returned. Append-only. A refund never happens automatically (e.g. on ticket resolution). */
export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    organizationId: organizationId(),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id"),
    provider: text("provider").notNull().default("manual"),
    providerRefundId: text("provider_refund_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    method: text("method").notNull(),
    refundedAt: tsz("refunded_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("refunds_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("refunds_provider_uq").on(t.organizationId, t.provider, t.providerRefundId).where(sql`${t.providerRefundId} is not null`),
    index("refunds_order_idx").on(t.organizationId, t.orderId),
    foreignKey({ name: "refunds_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }),
    foreignKey({ name: "refunds_payment_fk", columns: [t.organizationId, t.paymentId], foreignColumns: [payments.organizationId, payments.id] }),
    check("refunds_amount_chk", sql`${t.amount} > 0`),
  ],
);

export const fulfillments = pgTable(
  "fulfillments",
  {
    id: id(),
    organizationId: organizationId(),
    orderId: uuid("order_id").notNull(),
    status: text("status").notNull().default("shipped"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    trackingUrl: text("tracking_url"),
    note: text("note"),
    shippedAt: tsz("shipped_at").notNull().defaultNow(),
    deliveredAt: tsz("delivered_at"),
    cancelledAt: tsz("cancelled_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("fulfillments_org_id_uq").on(t.organizationId, t.id),
    index("fulfillments_order_idx").on(t.organizationId, t.orderId),
    foreignKey({ name: "fulfillments_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }).onDelete("cascade"),
    check("fulfillments_status_chk", sql`${t.status} in ('shipped','delivered','picked_up','cancelled')`),
  ],
);

export const fulfillmentItems = pgTable(
  "fulfillment_items",
  {
    id: id(),
    organizationId: organizationId(),
    fulfillmentId: uuid("fulfillment_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    index("fulfillment_items_f_idx").on(t.organizationId, t.fulfillmentId),
    foreignKey({ name: "fulfillment_items_f_fk", columns: [t.organizationId, t.fulfillmentId], foreignColumns: [fulfillments.organizationId, fulfillments.id] }).onDelete("cascade"),
    foreignKey({ name: "fulfillment_items_item_fk", columns: [t.organizationId, t.orderItemId], foreignColumns: [orderItems.organizationId, orderItems.id] }).onDelete("cascade"),
    check("fulfillment_items_qty_chk", sql`${t.quantity} > 0`),
  ],
);
