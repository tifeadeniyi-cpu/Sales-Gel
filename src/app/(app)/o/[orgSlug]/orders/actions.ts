"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as svc from "@/domains/commerce/orders";
import { searchVariants } from "@/domains/commerce/products";
import type { OrderInput } from "@/domains/commerce/validation";

const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

async function act<T>(orgSlug: string, fn: (ctx: Awaited<ReturnType<typeof requireOrgContext>>) => Promise<T>) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => fn(ctx));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function createOrderAction(orgSlug: string, input: OrderInput) {
  return act(orgSlug, (ctx) => svc.createOrder(ctx, input));
}
export async function updateOrderItemsAction(orgSlug: string, id: string, input: Pick<OrderInput, "lines" | "orderDiscount" | "shipping" | "taxRate">) {
  return act(orgSlug, (ctx) => svc.updateOrderItems(ctx, id, input));
}
export async function updateOrderDetailsAction(orgSlug: string, id: string, input: Record<string, unknown>) {
  return act(orgSlug, (ctx) => svc.updateOrderDetails(ctx, id, input));
}
export async function recordPaymentAction(orgSlug: string, id: string, input: Parameters<typeof svc.recordPayment>[2]) {
  return act(orgSlug, (ctx) => svc.recordPayment(ctx, id, input));
}
export async function voidPaymentAction(orgSlug: string, paymentId: string, reason: string) {
  return act(orgSlug, (ctx) => svc.voidPayment(ctx, paymentId, reason));
}
export async function issueRefundAction(orgSlug: string, id: string, input: Parameters<typeof svc.issueRefund>[2]) {
  return act(orgSlug, (ctx) => svc.issueRefund(ctx, id, input));
}
export async function createFulfillmentAction(orgSlug: string, id: string, input: unknown) {
  return act(orgSlug, (ctx) => svc.createFulfillment(ctx, id, input));
}
export async function markDeliveredAction(orgSlug: string, fulfillmentId: string) {
  return act(orgSlug, (ctx) => svc.markFulfillmentDelivered(ctx, fulfillmentId));
}
export async function completeOrderAction(orgSlug: string, id: string) {
  return act(orgSlug, (ctx) => svc.completeOrder(ctx, id));
}
export async function reopenOrderAction(orgSlug: string, id: string) {
  return act(orgSlug, (ctx) => svc.reopenOrder(ctx, id));
}
export async function cancelOrderAction(orgSlug: string, id: string, reason: string) {
  return act(orgSlug, (ctx) => svc.cancelOrder(ctx, id, reason));
}
export async function searchVariantsAction(orgSlug: string, q: string) {
  const ctx = await requireOrgContext(orgSlug);
  return runAction(() => searchVariants(ctx, q));
}

export async function createPaymentLinkAction(orgSlug: string, orderId: string) {
  const { createPaymentLink } = await import("@/domains/integrations/stripe");
  return act(orgSlug, (ctx) => createPaymentLink(ctx, orderId));
}
