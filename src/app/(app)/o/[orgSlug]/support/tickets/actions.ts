"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as svc from "@/domains/support/service";
import type { TicketInput } from "@/domains/support/validation";

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;
async function act<T>(orgSlug: string, fn: (ctx: Ctx) => Promise<T>) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => fn(ctx));
  if (res.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}

async function readFiles(form: FormData): Promise<svc.UploadFile[]> {
  const out: svc.UploadFile[] = [];
  for (const v of form.getAll("files")) {
    if (typeof v === "string" || v.size === 0) continue;
    out.push({ filename: v.name, mimeType: v.type || "application/octet-stream", data: Buffer.from(await v.arrayBuffer()) });
  }
  return out;
}

export async function createTicketAction(orgSlug: string, form: FormData) {
  const input = JSON.parse(String(form.get("input") ?? "{}")) as TicketInput;
  const files = await readFiles(form);
  return act(orgSlug, (ctx) => svc.createTicket(ctx, input, files));
}
export async function addTicketMessageAction(orgSlug: string, ticketId: string, form: FormData) {
  const input = { kind: form.get("kind"), body: form.get("body"), channel: form.get("channel") || null };
  const files = await readFiles(form);
  return act(orgSlug, (ctx) => svc.addTicketMessage(ctx, ticketId, input, files));
}
export async function updateTicketAction(orgSlug: string, id: string, input: Record<string, unknown>) {
  return act(orgSlug, (ctx) => svc.updateTicket(ctx, id, input));
}
export async function assignTicketAction(orgSlug: string, id: string, membershipId: string | null) {
  return act(orgSlug, (ctx) => svc.assignTicket(ctx, id, membershipId));
}
export async function changeTicketStatusAction(orgSlug: string, id: string, input: { statusId: string; resolutionCategory?: string | null; resolutionNote?: string | null }) {
  return act(orgSlug, (ctx) => svc.changeTicketStatus(ctx, id, input));
}
export async function linkTicketRecordAction(orgSlug: string, id: string, target: { orderId?: string; leadId?: string }) {
  return act(orgSlug, (ctx) => svc.linkTicketRecord(ctx, id, target));
}
export async function unlinkTicketRecordAction(orgSlug: string, id: string, linkId: string) {
  return act(orgSlug, (ctx) => svc.unlinkTicketRecord(ctx, id, linkId));
}
export async function createTicketStatusAction(orgSlug: string, input: unknown) {
  return act(orgSlug, (ctx) => svc.createTicketStatus(ctx, input));
}
export async function updateTicketStatusDefAction(orgSlug: string, id: string, input: { name?: string; color?: string; isDefault?: boolean }) {
  return act(orgSlug, (ctx) => svc.updateTicketStatusDef(ctx, id, input));
}
export async function archiveTicketStatusAction(orgSlug: string, id: string) {
  return act(orgSlug, (ctx) => svc.archiveTicketStatus(ctx, id));
}
export async function createTicketTypeAction(orgSlug: string, input: unknown) {
  return act(orgSlug, (ctx) => svc.createTicketType(ctx, input));
}
export async function archiveTicketTypeAction(orgSlug: string, id: string) {
  return act(orgSlug, (ctx) => svc.archiveTicketType(ctx, id));
}
export async function searchOrdersForTicketAction(orgSlug: string, q: string) {
  const ctx = await requireOrgContext(orgSlug);
  const { listOrders } = await import("@/domains/commerce/orders");
  return runAction(async () => (await listOrders(ctx, { q, pageSize: 25 })).rows.slice(0, 10).map((o) => ({ id: o.id, label: `ORD-${o.number}`, sub: o.customerName ?? undefined })));
}
