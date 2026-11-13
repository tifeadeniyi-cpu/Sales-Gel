import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, loadSupportSettings, SupportSettingsHeader } from "../shell";
import { BusinessHoursEditor, HolidayManager } from "./hours-client";

export default async function BusinessHoursPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { ctx, settings } = await loadSupportSettings(orgSlug);
  return (
    <>
      <SupportSettingsHeader orgSlug={orgSlug} active="hours" showAudit={can(ctx, "audit.read")} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Business hours</CardTitle>
            <CardDescription>SLA clocks only run during these hours (unless a policy is set to 24/7). Changes re-calculate due times on open tickets.</CardDescription>
          </CardHeader>
          <CardContent><BusinessHoursEditor orgSlug={orgSlug} timezone={settings.hours.timezone} schedule={settings.hours.schedule} configured={settings.hours.configured} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Holidays</CardTitle><CardDescription>Days with no working hours.</CardDescription></CardHeader>
          <CardContent><HolidayManager orgSlug={orgSlug} holidays={settings.holidays} /></CardContent>
        </Card>
      </div>
    </>
  );
}
