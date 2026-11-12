import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getOrganization } from "@/domains/identity/service";
import { requireOrgContext } from "@/server/authz/request";
import { can, canAny } from "@/server/authz/guards";
import { GeneralForm } from "./general-form";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const org = await getOrganization(ctx);
  const readOnly = !can(ctx, "org.settings.manage");
  return (
    <>
      <PageHeader title="Settings" description={readOnly ? "You can view these settings. Owners and Admins can change them." : "Your organization profile and defaults."} />
      <SettingsTabs orgSlug={orgSlug} active="general" showAudit={can(ctx, "audit.read")} showSupport={canAny(ctx, "tickets.read", "support.configure")} />
      <Card className="mt-6">
        <CardContent className="pt-5">
          <GeneralForm orgSlug={orgSlug} org={org} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} readOnly={readOnly} />
        </CardContent>
      </Card>
    </>
  );
}
