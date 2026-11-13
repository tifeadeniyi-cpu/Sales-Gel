import Link from "next/link";
import { forbidden } from "next/navigation";
import { Ticket } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { getSupportStats, getTicket, listTickets } from "@/domains/support/service";
import { PRIORITY_LABELS, TICKET_VIEWS, VIEW_LABELS, type TicketFilters } from "@/domains/support/validation";
import { cn } from "@/lib/utils";
import { canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { ticketNo } from "./_components/labels";
import { loadTicketLookups } from "./_components/load";
import { NewTicketButton } from "./_components/new-ticket-dialog";
import { TicketTable } from "./_components/ticket-table";
import { TicketBadges, TicketWorkspace } from "./_components/ticket-view";

type SP = Record<string, string | undefined>;

export default async function TicketsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "tickets.read", "tickets.read_assigned")) forbidden();
  const sp = await searchParams;
  const readAll = ctx.permissions.has("tickets.read");
  const defaultView = readAll ? "open" : "mine";
  const filters: TicketFilters = { view: (sp.view as TicketFilters["view"]) ?? defaultView, q: sp.q, priority: sp.priority as never, assignee: sp.assignee, type: sp.type, customer: sp.customer, order: sp.order, sort: sp.sort as never, page: sp.page, pageSize: sp.pageSize };
  const [data, lookups, stats] = await Promise.all([listTickets(ctx, filters), loadTicketLookups(ctx), getSupportStats(ctx)]);
  const base = `/o/${orgSlug}/support/tickets`;
  const keep = { q: data.filters.q, priority: data.filters.priority, assignee: data.filters.assignee, type: data.filters.type, sort: data.filters.sort !== "activity" ? data.filters.sort : undefined };
  const qs = (patch: SP) => {
    const u = new URLSearchParams(Object.entries({ view: data.filters.view, ...keep, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${u}`;
  };
  const views = readAll ? TICKET_VIEWS : (["mine", "waiting", "resolved", "closed", "all"] as const);

  let drawer = null;
  const openId = sp.open && /^[0-9a-f-]{36}$/i.test(sp.open) ? sp.open : null;
  if (openId) {
    const t = await getTicket(ctx, openId);
    if (t) {
      const ids = data.rows.map((r) => r.id);
      const i = ids.indexOf(t.id);
      drawer = (
        <RecordDrawer title={`${ticketNo(t.number)} · ${t.subject}`} subtitle={<TicketBadges t={t} />} fullHref={`${base}/${t.id}`} prevId={i > 0 ? ids[i - 1] : null} nextId={i >= 0 && i < ids.length - 1 ? ids[i + 1] : null} wide>
          <div className="p-5"><TicketWorkspace ctx={ctx} orgSlug={orgSlug} t={t} lookups={lookups} /></div>
        </RecordDrawer>
      );
    }
  }

  return (
    <>
      <PageHeader title="Tickets" description="Every customer issue, tracked from first message to resolution."
        actions={ctx.permissions.has("tickets.write") && <NewTicketButton key={sp.new === "1" ? "new" : "btn"} orgSlug={orgSlug} lookups={lookups.lookups} defaultOpen={sp.new === "1"} />} />
      {stats && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {[
            ["Open", stats.open, qs({ view: "open", page: undefined })],
            [readAll ? "Unassigned" : "Assigned to me", readAll ? stats.unassigned : stats.mine, qs({ view: readAll ? "unassigned" : "mine" })],
            ["Urgent & high", stats.urgent, qs({ view: "open", priority: undefined, sort: "priority" })],
            ["Resolved (30 days)", stats.resolved, qs({ view: "resolved" })],
          ].map(([l, v, href]) => (
            <Link key={l as string} href={href as string}><Card className="transition hover:border-primary/40"><CardContent className="p-4"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{v}</div></CardContent></Card></Link>
          ))}
        </div>
      )}
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b" aria-label="Ticket views">
        {views.map((v) => (
          <Link key={v} href={qs({ view: v, page: undefined })} aria-current={data.filters.view === v ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", data.filters.view === v ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-ink")}>
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
      <form className="mb-4 flex flex-wrap gap-2" action={base}>
        <input type="hidden" name="view" value={data.filters.view} />
        <Input name="q" defaultValue={data.filters.q} placeholder="Search subject, TCK-number or customer…" className="max-w-xs" aria-label="Search tickets" />
        <NativeSelect name="priority" defaultValue={data.filters.priority ?? ""} className="w-36" aria-label="Priority">
          <option value="">Any priority</option>
          {Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
        {readAll && (
          <NativeSelect name="assignee" defaultValue={data.filters.assignee ?? ""} className="w-44" aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {lookups.lookups.members.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
          </NativeSelect>
        )}
        <NativeSelect name="type" defaultValue={data.filters.type ?? ""} className="w-40" aria-label="Type">
          <option value="">Any type</option>
          {lookups.lookups.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={data.filters.sort} className="w-40" aria-label="Sort">
          <option value="activity">Recent activity</option>
          <option value="priority">Priority</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="due">Next SLA due</option>
        </NativeSelect>
        <button type="submit" className="rounded-md border px-3 text-sm hover:bg-muted">Apply</button>
        {(keep.q || keep.priority || keep.assignee || keep.type) && <Link href={qs({ q: undefined, priority: undefined, assignee: undefined, type: undefined })} className="self-center text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {data.total === 0 && data.filters.view === defaultView && !keep.q && !keep.priority && !keep.assignee && !keep.type ? (
        <EmptyState icon={<Ticket className="size-8" />} title={readAll ? "No open tickets" : "No tickets assigned to you"}
          description="Create a ticket when a customer reports a problem by phone, message or in person. Customers can also send requests through your support portal (Settings → Support → Customer portal)."
          action={ctx.permissions.has("tickets.write") && <NewTicketButton orgSlug={orgSlug} lookups={lookups.lookups} />} />
      ) : (
        <Card className="overflow-hidden">{data.rows.length ? <TicketTable rows={data.rows} /> : <p className="p-6 text-sm text-muted-foreground">No tickets match.</p>}</Card>
      )}
      {data.pageCount > 1 && <div className="mt-4"><Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} hrefFor={(p) => qs({ page: String(p) })} /></div>}
      {drawer}
    </>
  );
}
