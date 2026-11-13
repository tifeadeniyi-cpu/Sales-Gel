import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { canConfigureSupport, getSupportSettings } from "@/domains/support/config";
import { can } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { SettingsTabs } from "../settings-tabs";
import { SupportSubnav, type SupportSection } from "./support-subnav";

/** Loads support configuration for a settings sub-page (support configurators only). */
export async function loadSupportSettings(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  if (!canConfigureSupport(ctx)) forbidden();
  return { ctx, settings: await getSupportSettings(ctx) };
}

export function SupportSettingsHeader({ orgSlug, active, showAudit }: { orgSlug: string; active: SupportSection; showAudit: boolean }) {
  return (
    <>
      <PageHeader title="Settings" description="How your support desk works." />
      <SettingsTabs orgSlug={orgSlug} active="support" showAudit={showAudit} showSupport />
      <SupportSubnav orgSlug={orgSlug} active={active} canConfigure />
    </>
  );
}
export { can };
