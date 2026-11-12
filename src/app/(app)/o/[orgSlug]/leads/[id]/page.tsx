import { listOrders } from "@/domains/commerce/orders";
import { formatMoney } from "@/lib/money";
import { can } from "@/server/authz/guards";
import { Button } from "@/components/ui/button";
import { PAYMENT_STATUS } from "../../orders/_components/labels";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { ArchiveLeadButton } from "../_components/archive-lead";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLead, getLeadTimeline } from "@/domains/sales/service";
import { listTasks } from "@/domains/tasks/service";
import { describeAudit } from "@/lib/audit-labels";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { requireOrgContext } from "@/server/authz/request";
import { canAny } from "@/server/authz/guards";
import { RelatedTasks } from "../../tasks/_components/related-tasks";
import { LeadPanel } from "../_components/lead-panel";
import { LEAD_STATUS } from "../_components/labels";
import { leadPerms, loadLeadLookups } from "../_components/load";

export default async function LeadPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "leads.read", "leads.read_assigned")) notFound();
  const lead = /^[0-9a-f-]{36}$/i.test(id) ? await getLead(ctx, id) : null;
  if (!lead) notFound();
  const perms = leadPerms(ctx);
  const [lookups, timeline, tasks] = await Promise.all([
    loadLeadLookups(ctx),
    getLeadTimeline(ctx, id),
    perms.tasks ? listTasks(ctx, { scope: "all", status: "all", entityType: "lead", entityId: id }) : Promise.resolve([]),
  ]);
  const leadOrders = can(ctx, "orders.read") ? await listOrders(ctx, { lead: lead.id }) : null;
  return (
    <>
      <Link href={`/o/${orgSlug}/leads`} className="text-sm text-primary hover:underline">← Leads</Link>
      <div className="mb-6 mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            LEAD-{lead.number} <Badge tone={LEAD_STATUS[lead.status].tone}>{LEAD_STATUS[lead.status].label}</Badge>
            {lead.archivedAt && <Badge tone="inactive">Archived</Badge>}
            <span>· Created {formatRelative(lead.createdAt)}</span>
          </div>
        </div>
        {perms.write && (
          <ArchiveLeadButton orgSlug={orgSlug} id={lead.id} archived={!!lead.archivedAt} icon={lead.archivedAt ? <ArchiveRestore /> : <Archive />} />
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardContent className="pt-5"><LeadPanel orgSlug={orgSlug} lead={lead} members={lookups.members} canWrite={perms.write} canAssign={perms.assign} /></CardContent></Card>
        <div className="space-y-6">
          {leadOrders && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Orders</CardTitle>
                {can(ctx, "orders.write") && !lead.archivedAt && <Button asChild size="sm" variant={lead.status === "won" ? "default" : "outline"}><Link href={`/o/${orgSlug}/orders/new?lead=${lead.id}`}>Create order</Link></Button>}
              </CardHeader>
              <CardContent>
                {leadOrders.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{lead.status === "won" ? "Won — create the order when you're ready. Orders are never created automatically." : "No orders linked yet."}</p>
                ) : (
                  <ul className="divide-y text-sm">
                    {leadOrders.rows.map((o) => (
                      <li key={o.id} className="flex items-center gap-2 py-2">
                        <Link href={`/o/${orgSlug}/orders/${o.id}`} className="flex-1 font-medium hover:underline">ORD-{o.number}</Link>
                        <Badge tone={PAYMENT_STATUS[o.paymentStatus].tone}>{PAYMENT_STATUS[o.paymentStatus].label}</Badge>
                        {o.totalAmount !== null && <span className="font-medium">{formatMoney(o.totalAmount, o.currency)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          {perms.tasks && (
            <Card>
              <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
              <CardContent><RelatedTasks orgSlug={orgSlug} tasks={tasks} members={lookups.members} currentMembershipId={ctx.membershipId} relation={{ type: "lead", id: lead.id, label: lead.title }} canWrite={perms.tasksWrite} canSearchLeads canSearchCustomers={perms.customers} /></CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {lead.history.map((h) => (
                  <li key={h.id}>
                    {h.fromName ? <>{h.fromName} → <strong>{h.toName}</strong></> : <>Created in <strong>{h.toName}</strong></>}
                    <div className="text-xs text-muted-foreground">{h.by ?? "System"} · {formatDateTime(h.createdAt, ctx.timezone)}</div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {timeline.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium">{t.actorName ?? "System"}</span> {describeAudit(t.action)}
                    {t.changes && <div className="text-xs text-muted-foreground">{Object.entries(t.changes).map(([k, v]) => <div key={k}>{k}: {String(v.from ?? "—")} → {String(v.to ?? "—")}</div>)}</div>}
                    <div className="text-xs text-muted-foreground">{formatRelative(t.createdAt)}</div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
