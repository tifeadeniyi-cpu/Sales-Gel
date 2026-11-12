import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupportStats } from "@/domains/support/service";
import { canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { CATEGORY_TONE, PRIORITY } from "./tickets/_components/labels";
import { loadTicketLookups } from "./tickets/_components/load";
import { NewTicketButton } from "./tickets/_components/new-ticket-dialog";

function minutes(m: number | null) {
  if (m === null) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

export default async function SupportDashboard({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "tickets.read", "tickets.read_assigned")) forbidden();
  const [s, lookups] = await Promise.all([getSupportStats(ctx), loadTicketLookups(ctx)]);
  const base = `/o/${orgSlug}/support/tickets`;
  const readAll = ctx.permissions.has("tickets.read");
  return (
    <>
      <PageHeader title="Support Dashboard" description={readAll ? "Current workload and the last 30 days." : "Your tickets: current workload and the last 30 days."}
        actions={ctx.permissions.has("tickets.write") && <NewTicketButton orgSlug={orgSlug} lookups={lookups.lookups} />} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Open", s!.open, `${base}?view=open`, "Now"],
          ["Unassigned", s!.unassigned, `${base}?view=unassigned`, "Now"],
          ["Urgent & high", s!.urgent, `${base}?view=open&sort=priority`, "Now"],
          ["Awaiting our reply", s!.awaitingReply, `${base}?view=open`, "Now"],
          ["Created", s!.created, `${base}?view=all&sort=newest`, "Last 30 days"],
          ["Resolved", s!.resolved, `${base}?view=resolved`, "Last 30 days"],
        ].map(([l, v, href, hint]) => (
          <Link key={l as string} href={href as string}>
            <Card className="h-full transition hover:border-primary/40"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{v}</div><div className="text-[11px] text-muted-foreground">{hint}</div></CardContent></Card>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Priority queue</CardTitle><Link href={`${base}?view=open&sort=priority`} className="text-sm text-primary hover:underline">View all</Link></CardHeader>
          <CardContent>
            {s!.priorityTickets.length === 0 ? <p className="text-sm text-muted-foreground">Nothing open. Nice work.</p> : (
              <ul className="divide-y text-sm">
                {s!.priorityTickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <Link href={`${base}/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline"><span className="text-muted-foreground">TCK-{t.number}</span> {t.subject}</Link>
                    <span className="text-muted-foreground">{t.customerName ?? "No customer"}</span>
                    <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                    <Badge tone={CATEGORY_TONE[t.statusCategory]}>{t.statusName}</Badge>
                    <span className="w-28 truncate text-right text-xs">{t.assigneeName ?? <span className="text-warning">Unassigned</span>}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Response</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Median first reply (30 days)</div><div className="text-xl font-semibold">{minutes(s!.medianFirstResponseMin)}</div></div>
            <p className="text-xs text-muted-foreground">Measured from ticket creation to the first saved reply. SLA targets and business hours arrive in Phase 7, so no SLA compliance is shown yet.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
