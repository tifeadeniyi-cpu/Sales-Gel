import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listTicketConfig } from "@/domains/support/service";
import { can, canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { SettingsTabs } from "../settings-tabs";
import { StatusManager, TypeManager } from "./support-config-client";
import { SupportSubnav } from "./support-subnav";

export default async function SupportSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "tickets.read", "support.configure")) forbidden();
  const config = await listTicketConfig(ctx);
  const canManage = can(ctx, "support.configure");
  return (
    <>
      <PageHeader title="Settings" description="How your support desk works." />
      <SettingsTabs orgSlug={orgSlug} active="support" showAudit={can(ctx, "audit.read")} showSupport />
      <SupportSubnav orgSlug={orgSlug} active="statuses" canConfigure={canManage} />
      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader><CardTitle>Ticket statuses</CardTitle><CardDescription>Name statuses the way your team talks. Each one behaves like a standard stage, which drives queues and reporting.</CardDescription></CardHeader>
          <CardContent><StatusManager orgSlug={orgSlug} statuses={config.statuses} canManage={canManage} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ticket types</CardTitle><CardDescription>What the ticket is about, used for filtering and reports.</CardDescription></CardHeader>
          <CardContent><TypeManager orgSlug={orgSlug} types={config.types} canManage={canManage} /></CardContent>
        </Card>
      </div>
    </>
  );
}
