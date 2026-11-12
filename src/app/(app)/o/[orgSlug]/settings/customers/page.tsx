import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listCustomFields } from "@/domains/customers/custom-fields";
import { listTags } from "@/domains/customers/service";
import { requireOrgContext } from "@/server/authz/request";
import { can, canAny } from "@/server/authz/guards";
import { forbidden } from "next/navigation";
import { SettingsTabs } from "../settings-tabs";
import { FieldsManager, TagsManager } from "./fields-client";

export default async function CustomerSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "customers.read", "customers.read_assigned")) forbidden();
  const [fields, tags] = await Promise.all([listCustomFields(ctx, { includeArchived: true }), listTags(ctx)]);
  return (
    <>
      <PageHeader title="Settings" description="Customer fields and tags." />
      <SettingsTabs orgSlug={orgSlug} active="customers" showAudit={can(ctx, "audit.read")} />
      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader><CardTitle>Custom customer fields</CardTitle><CardDescription>Extra information you want to track on every customer, like birthday or loyalty tier.</CardDescription></CardHeader>
          <CardContent><FieldsManager orgSlug={orgSlug} fields={fields} canManage={can(ctx, "org.settings.manage")} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tags</CardTitle><CardDescription>Labels for grouping and filtering customers. The number shows how many customers use each tag.</CardDescription></CardHeader>
          <CardContent><TagsManager orgSlug={orgSlug} tags={tags} canManage={can(ctx, "customers.write") && can(ctx, "customers.read")} /></CardContent>
        </Card>
      </div>
    </>
  );
}
