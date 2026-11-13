type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "inactive" | "highlight";

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: "Unpaid", tone: "warning" },
  partially_paid: { label: "Partially paid", tone: "highlight" },
  paid: { label: "Paid", tone: "success" },
  partially_refunded: { label: "Partially refunded", tone: "info" },
  refunded: { label: "Refunded", tone: "inactive" },
};
export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "brand" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
};
export const FULFILLMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  unfulfilled: { label: "Unfulfilled", tone: "neutral" },
  partially_fulfilled: { label: "Partially fulfilled", tone: "highlight" },
  fulfilled: { label: "Fulfilled", tone: "success" },
};
export const VIEW_LABELS: Record<string, string> = {
  all: "All orders",
  manual: "Manual",
  pending_payment: "Pending payment",
  processing: "Ready to fulfill",
  fulfillment: "In fulfillment",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};
export const DELIVERY_LABELS: Record<string, string> = { shipping: "Shipping", local_delivery: "Local delivery", pickup: "Pickup", digital: "Digital" };
export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual", website: "Website", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", tiktok: "TikTok", marketplace: "Marketplace", phone: "Phone", in_person: "In person", shopify: "Shopify",
};
export const orderNo = (n: number) => `ORD-${n}`;
