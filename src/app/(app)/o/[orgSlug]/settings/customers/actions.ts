"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import { createCustomField, setCustomFieldArchived, updateCustomField } from "@/domains/customers/custom-fields";
import { createTag, deleteTag } from "@/domains/customers/service";

const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

export async function createFieldAction(orgSlug: string, input: { label: string; key: string; type: string; options?: string[]; required?: boolean }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => createCustomField(ctx, input), "Field created.");
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function updateFieldAction(orgSlug: string, id: string, input: { label?: string; options?: string[]; required?: boolean }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => updateCustomField(ctx, id, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function archiveFieldAction(orgSlug: string, id: string, archived: boolean) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => setCustomFieldArchived(ctx, id, archived));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function createTagAction(orgSlug: string, input: { name: string; color: string }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => createTag(ctx, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function deleteTagAction(orgSlug: string, id: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => deleteTag(ctx, id));
  if (res.ok) refresh(orgSlug);
  return res;
}
