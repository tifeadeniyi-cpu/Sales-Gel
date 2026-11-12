"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import { markNotificationsRead } from "@/domains/platform/notifications";

export async function markReadAction(orgSlug: string, id?: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => markNotificationsRead(ctx, id));
  if (res.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}
