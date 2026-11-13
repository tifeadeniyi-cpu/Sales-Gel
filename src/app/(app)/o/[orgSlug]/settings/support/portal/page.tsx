import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { appUrl } from "@/server/app-url";
import { can, loadSupportSettings, SupportSettingsHeader } from "../shell";
import { PortalSettings } from "./portal-client";

export default async function PortalPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, settings } = await loadSupportSettings(orgSlug);
  const published = settings.forms.filter((f) => f.currentVersionId && f.portalVisible).length;
  return (
    <>
      <SupportSettingsHeader orgSlug={orgSlug} active="portal" showAudit={can(ctx, "audit.read")} />
      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle>Customer portal</CardTitle>
          <CardDescription>A public page where customers send requests and follow their tickets. Requests become tickets with routing and SLAs applied.</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalSettings orgSlug={orgSlug} baseUrl={appUrl()} portal={settings.portal} defaultSlug={settings.orgSlug} defaultTitle={`${settings.orgName} Support`} publishedForms={published} />
        </CardContent>
      </Card>
    </>
  );
}
