"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as svc from "@/domains/customers/service";
import * as dup from "@/domains/customers/duplicates";
import * as io from "@/domains/customers/import-export";
import type { CustomerInput } from "@/domains/customers/validation";

const refresh = (slug: string) => revalidatePath(`/o/${slug}/customers`, "layout");

export async function saveCustomerAction(orgSlug: string, id: string | null, input: CustomerInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => (id ? svc.updateCustomer(ctx, id, input) : svc.createCustomer(ctx, input)));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function updateCustomerFieldAction(orgSlug: string, id: string, field: string, value: unknown) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.updateCustomerField(ctx, id, field, value));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function setArchivedAction(orgSlug: string, id: string, archived: boolean) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.setCustomerArchived(ctx, id, archived));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function bulkAction(orgSlug: string, ids: string[], op: Parameters<typeof svc.bulkUpdateCustomers>[2]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.bulkUpdateCustomers(ctx, ids, op));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function setTagsAction(orgSlug: string, id: string, tagNames: string[]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.setCustomerTagNames(ctx, id, tagNames));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function addNoteAction(orgSlug: string, customerId: string, body: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.addNote(ctx, customerId, { body }));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function updateNoteAction(orgSlug: string, noteId: string, patch: { body?: string; pinned?: boolean }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.updateNote(ctx, noteId, patch));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function deleteNoteAction(orgSlug: string, noteId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.deleteNote(ctx, noteId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function recordConsentAction(orgSlug: string, customerId: string, input: { channel: string; status: string; source: string; note?: string }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => svc.recordConsent(ctx, customerId, input), "Consent recorded.");
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function checkMatchesAction(orgSlug: string, input: { emails: string[]; phones: string[]; identities: { provider: string; handle: string }[]; excludeId?: string }) {
  const ctx = await requireOrgContext(orgSlug);
  return runAction(() => dup.findMatchesForIdentifiers(ctx, input));
}

export async function mergeAction(orgSlug: string, survivorId: string, mergedId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => dup.mergeCustomers(ctx, survivorId, mergedId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function unmergeAction(orgSlug: string, mergeId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => dup.unmergeCustomers(ctx, mergeId));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function dismissDuplicateAction(orgSlug: string, a: string, b: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => dup.dismissDuplicate(ctx, a, b));
  if (res.ok) refresh(orgSlug);
  return res;
}

export async function previewImportAction(orgSlug: string, csvText: string) {
  const ctx = await requireOrgContext(orgSlug);
  return runAction(async () => {
    if (!ctx.permissions.has("customers.import")) throw new (await import("@/server/errors")).ForbiddenError(undefined, "customers.import");
    const { headers, rows } = io.parseCsv(csvText);
    const { listCustomFields } = await import("@/domains/customers/custom-fields");
    const defs = await listCustomFields(ctx);
    return {
      headers,
      sample: rows.slice(0, 5),
      rowCount: rows.length,
      mapping: io.suggestMapping(headers, defs),
      customFields: defs.map((d) => ({ key: d.key, label: d.label })),
    };
  });
}

export async function runImportAction(orgSlug: string, csvText: string, mapping: io.ImportField[], mode: "skip" | "update" | "create") {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => io.importCustomers(ctx, csvText, mapping, mode));
  if (res.ok) refresh(orgSlug);
  return res;
}

