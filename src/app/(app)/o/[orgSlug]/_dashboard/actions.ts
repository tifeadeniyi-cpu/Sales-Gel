"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import { resetDashboardLayout, saveDashboardLayout } from "@/domains/reporting/layout";
import type { WidgetPref } from "@/domains/reporting/widgets";

export async function saveLayoutAction(orgSlug: string, widgets: WidgetPref[], scope: "personal" | "workspace") {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => saveDashboardLayout(ctx, widgets, scope));
  if (res.ok) revalidatePath(`/o/${orgSlug}`);
  return res;
}
export async function resetLayoutAction(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => resetDashboardLayout(ctx));
  if (res.ok) revalidatePath(`/o/${orgSlug}`);
  return res;
}
