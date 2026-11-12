"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionResult } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import { updateOrganization } from "@/domains/identity/service";
import { setNotificationPreference } from "@/domains/platform/notifications";

export async function updateOrganizationAction(orgSlug: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    await updateOrganization(ctx, {
      name: str(fd, "name") ?? "",
      businessType: (str(fd, "businessType") as never) ?? null,
      timezone: str(fd, "timezone"),
      defaultCurrency: str(fd, "defaultCurrency") as never,
      address: str(fd, "address") ?? null,
    });
    return undefined;
  }, "Settings saved.");
  if (res.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}

export async function setNotificationPreferenceAction(orgSlug: string, event: string, value: { inApp: boolean; email: boolean }) {
  const ctx = await requireOrgContext(orgSlug);
  return runAction(() => setNotificationPreference(ctx, event, value));
}
