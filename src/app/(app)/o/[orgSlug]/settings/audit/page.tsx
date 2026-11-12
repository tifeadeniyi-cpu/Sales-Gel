import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { listAuditLogs } from "@/domains/platform/audit-queries";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { describeAudit } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/utils";
import { SettingsTabs } from "../settings-tabs";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ before?: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "audit.read")) forbidden();
  const beforeRaw = (await searchParams).before;
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : undefined;
  const { rows, hasMore } = await listAuditLogs(ctx, { before, limit: 50 });

  return (
    <>
      <PageHeader title="Settings" description="Every security-relevant change in this organization. Entries can't be edited or deleted." />
      <SettingsTabs orgSlug={orgSlug} active="audit" showAudit />
      <Card className="mt-6">
        <Table>
          <THead><TR><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Details</TH></TR></THead>
          <TBody>
            {rows.length === 0 && (
              <TR><TD colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No entries.</TD></TR>
            )}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(r.createdAt, ctx.timezone)}</TD>
                <TD className="text-sm">
                  <div>{r.actorName ?? "System"}</div>
                  {r.actorEmail && <div className="text-xs text-muted-foreground">{r.actorEmail}</div>}
                </TD>
                <TD className="text-sm">{describeAudit(r.action)}<div className="text-xs text-muted-foreground"><code>{r.action}</code></div></TD>
                <TD className="max-w-md text-xs text-muted-foreground">
                  {r.changes &&
                    Object.entries(r.changes).map(([k, v]) => (
                      <div key={k}><span className="font-medium text-ink">{k}</span>: {String(v.from ?? "—")} → {String(v.to ?? "—")}</div>
                    ))}
                  {r.metadata && !r.changes && <code className="break-all">{JSON.stringify(r.metadata)}</code>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        {before && <Button asChild variant="outline" size="sm"><Link href={`/o/${orgSlug}/settings/audit`}>Newest</Link></Button>}
        {hasMore && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/o/${orgSlug}/settings/audit?before=${encodeURIComponent(rows[rows.length - 1].createdAt.toISOString())}`}>Older</Link>
          </Button>
        )}
      </div>
    </>
  );
}
