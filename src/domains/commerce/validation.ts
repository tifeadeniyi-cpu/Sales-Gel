import { z } from "zod";

const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const money = z.union([z.string(), z.number()]);

export const PRODUCT_STATUSES = ["active", "draft", "archived"] as const;
export const PAYMENT_METHODS = ["cash", "bank_transfer", "card", "mobile_money", "payment_link", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card (in person / terminal)",
  mobile_money: "Mobile money",
  payment_link: "Payment link (confirmed)",
  other: "Other",
};
export const DELIVERY_METHODS = ["shipping", "local_delivery", "pickup", "digital"] as const;
export const ORDER_SOURCES = ["manual", "website", "instagram", "facebook", "whatsapp", "tiktok", "marketplace", "phone", "in_person"] as const;

export const variantInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name the variant").max(120).default("Default"),
  sku: optText(64),
  price: money,
  inventoryQuantity: z.coerce.number().int().min(0).nullish(),
});

export const productInputSchema = z.object({
  name: z.string().trim().min(2, "Enter a product name").max(200),
  description: optText(5000),
  category: optText(80),
  brand: optText(80),
  imageUrl: z.url("Enter a valid image URL").max(1000).nullish().or(z.literal("").transform(() => null)),
  status: z.enum(PRODUCT_STATUSES).default("active"),
  currency: currency.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  variants: z.array(variantInput).min(1, "Add at least one variant").max(100),
});
export type ProductInput = z.input<typeof productInputSchema>;

export const addressSchema = z
  .object({
    name: optText(120),
    line1: optText(200),
    line2: optText(200),
    city: optText(100),
    region: optText(100),
    postalCode: optText(20),
    country: optText(60),
    phone: optText(40),
  })
  .nullish();

export const orderLineInput = z
  .object({
    variantId: z.uuid().nullish(),
    name: optText(200),
    unitPrice: money.nullish(),
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(100_000),
    discount: money.nullish(),
  })
  .refine((l) => l.variantId || l.name, { message: "Choose a product or enter a custom item name", path: ["name"] });

export const orderInputSchema = z.object({
  customerId: z.uuid().nullish(),
  leadId: z.uuid().nullish(),
  currency: currency.optional(),
  source: z.enum(ORDER_SOURCES).default("manual"),
  lines: z.array(orderLineInput).min(1, "Add at least one item").max(200),
  orderDiscount: money.nullish(),
  shipping: money.nullish(),
  taxRate: z.union([z.string(), z.number()]).nullish(),
  deliveryMethod: z.enum(DELIVERY_METHODS).nullish(),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  contactEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")).nullish().or(z.literal("").transform(() => null)),
  contactPhone: optText(40),
  notes: optText(5000),
  assignedMembershipId: z.uuid().nullish(),
});
export type OrderInput = z.input<typeof orderInputSchema>;

export const paymentInputSchema = z.object({
  amount: money,
  method: z.enum(PAYMENT_METHODS),
  reference: optText(120),
  note: optText(1000),
  receivedAt: z.coerce.date().optional(),
});

export const refundInputSchema = z.object({
  amount: money,
  reason: z.string().trim().min(2, "Give a reason for the refund").max(500),
  method: z.enum(PAYMENT_METHODS),
  paymentId: z.uuid().nullish(),
});

export const fulfillmentInputSchema = z.object({
  items: z.array(z.object({ orderItemId: z.uuid(), quantity: z.coerce.number().int().min(1) })).min(1, "Choose at least one item"),
  status: z.enum(["shipped", "delivered", "picked_up"]).default("shipped"),
  carrier: optText(80),
  trackingNumber: optText(120),
  trackingUrl: z.url("Enter a valid URL").nullish().or(z.literal("").transform(() => null)),
  note: optText(1000),
});

export const ORDER_VIEWS = ["all", "manual", "pending_payment", "processing", "fulfillment", "completed", "cancelled", "refunded"] as const;
export const orderFiltersSchema = z.object({
  view: z.enum(ORDER_VIEWS).default("all"),
  q: z.string().trim().max(120).optional(),
  customer: z.uuid().optional(),
  /** Placed-at window (ISO timestamps) — dashboard drill-downs. */
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Orders with a payment or refund recorded in this window (revenue drill-down). */
  moneyFrom: z.iso.datetime({ offset: true }).optional(),
  moneyTo: z.iso.datetime({ offset: true }).optional(),
  assignee: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n)).default(25),
});
export type OrderFilters = z.input<typeof orderFiltersSchema>;
