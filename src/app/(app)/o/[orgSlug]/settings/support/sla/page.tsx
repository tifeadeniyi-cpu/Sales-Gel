import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, loadSupportSettings, SupportSettingsHeader } from "../shell";
import { SlaPolicies } from "./sla-client";

export default async function SlaPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, settings } = await loadSupportSettings(orgSlug);
  return (
    <>
      <SupportSettingsHeader orgSlug={orgSlug} active="sla" showAudit={can(ctx, "audit.read")} />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>SLA policies</CardTitle>
          <CardDescription>
            Response and resolution targets. Each new ticket gets the first active policy (top to bottom) that matches it. The resolution clock pauses while a ticket is waiting on the customer.
            When a target is missed, the assignee (or whoever triages) is notified and, if you choose, the ticket is escalated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlaPolicies orgSlug={orgSlug} policies={settings.policies} types={settings.types} hoursConfigured={settings.hours.configured} />
        </CardContent>
      </Card>
    </>
  );
}
