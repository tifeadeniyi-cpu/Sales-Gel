import { Info } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { getNotificationPreferences } from "@/domains/platform/notifications";
import { requireOrgContext } from "@/server/authz/request";
import { can, canAny } from "@/server/authz/guards";
import { SettingsTabs } from "../settings-tabs";
import { PreferenceRow } from "./prefs";

export default async function NotificationSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const prefs = await getNotificationPreferences(ctx);
  const emailConnected = Boolean(process.env.EMAIL_PROVIDER && process.env.EMAIL_API_KEY);
  return (
    <>
      <PageHeader title="Settings" description="Choose how you're notified in this organization. These are your personal preferences." />
      <SettingsTabs orgSlug={orgSlug} active="notifications" showAudit={can(ctx, "audit.read")} showSupport={canAny(ctx, "tickets.read", "support.configure")} />
      {!emailConnected && (
        <p className="mt-6 flex gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info">
          <Info className="mt-0.5 size-4 shrink-0" /> Email notifications become available once an email provider is connected. In-app notifications work now.
        </p>
      )}
      <Card className="mt-6 overflow-hidden">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase text-muted-foreground">Event</th>
              <th className="w-28 px-4 py-2 text-center text-xs font-medium uppercase text-muted-foreground">In-app</th>
              <th className="w-28 px-4 py-2 text-center text-xs font-medium uppercase text-muted-foreground">Email</th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => <PreferenceRow key={p.event} orgSlug={orgSlug} {...p} emailConnected={emailConnected} />)}
          </tbody>
        </table>
      </Card>
    </>
  );
}
