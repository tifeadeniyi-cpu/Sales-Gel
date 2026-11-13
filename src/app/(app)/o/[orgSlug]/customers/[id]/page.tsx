import { softphoneConfig } from "@/domains/phone/account";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { LinkTabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCustomer, getCustomerTimeline, listNotes } from "@/domains/customers/service";
import { formatCustomerNumber } from "@/domains/customers/normalize";
import { requireOrgContext } from "@/server/authz/request";
import { can, canAny } from "@/server/authz/guards";
import { listLeads, listPipelines } from "@/domains/sales/service";
import { listTasks } from "@/domains/tasks/service";
import { formatMoney } from "@/lib/money";
import { getCustomerCommerce, listOrders } from "@/domains/commerce/orders";
import { getCustomerTicketCounts, listCustomerFiles, listTickets } from "@/domains/support/service";
import { TicketTable } from "../../support/tickets/_components/ticket-table";
import { NewTicketButton } from "../../support/tickets/_components/new-ticket-dialog";
import { loadTicketLookups } from "../../support/tickets/_components/load";
import { OrderTable } from "../../orders/_components/order-table";
import { Button } from "@/components/ui/button";
import { RelatedTasks } from "../../tasks/_components/related-tasks";
import { NewLeadDialog } from "../../leads/_components/new-lead-dialog";
import { describeAudit } from "@/lib/audit-labels";
import { formatDateTime, formatRelative, initials } from "@/lib/utils";
import { ConsentPanel } from "../_components/consent-panel";
import { CustomerHeaderActions } from "../_components/customer-header-actions";
import { CustomerProfile } from "../_components/customer-profile";
import { MergeHistory } from "../_components/merge-history";
import { NotesPanel } from "../_components/notes-panel";
import { STATUS, sourceLabel } from "../_components/labels";
import { customerPerms, loadCustomerLookups } from "../_components/load";

const LATER_TABS: Record<string, { label: string; phase: number; what: string }> = {
  conversations: { label: "Conversations", phase: 8, what: "Messages from email, WhatsApp, Instagram and Messenger" },
};

export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ orgSlug: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { orgSlug, id } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "customers.read", "customers.read_assigned")) notFound();
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await getCustomer(ctx, id) : null;
  if (!c) notFound();
  const tab = (await searchParams).tab ?? "overview";
  const perms = customerPerms(ctx);
  const canCall = !!(await softphoneConfig(ctx));
  const base = `/o/${orgSlug}/customers`;
  const [lookups, notes, timeline] = await Promise.all([
    loadCustomerLookups(ctx),
    tab === "notes" || tab === "overview" ? listNotes(ctx, c.id) : Promise.resolve([]),
    tab === "timeline" ? getCustomerTimeline(ctx, c.id) : Promise.resolve([]),
  ]);
  if (!["overview", "timeline", "notes", "leads", "tasks", "orders", "tickets", "files", ...Object.keys(LATER_TABS)].includes(tab)) redirect(`${base}/${c.id}`);
  const canLeads = canAny(ctx, "leads.read", "leads.read_assigned");
  const canTasks = can(ctx, "tasks.read");
  const [customerLeads, customerTasks, pipelines] = await Promise.all([
    canLeads && (tab === "leads" || tab === "overview") ? listLeads(ctx, { customer: c.id, status: "all" }) : Promise.resolve([]),
    canTasks && (tab === "tasks" || tab === "overview") ? listTasks(ctx, { scope: "all", status: "all", entityType: "customer", entityId: c.id }) : Promise.resolve([]),
    canLeads && tab === "leads" ? listPipelines(ctx) : Promise.resolve([]),
  ]);
  const canOrders = can(ctx, "orders.read");
  const [commerce, customerOrders] = await Promise.all([
    canOrders ? getCustomerCommerce(ctx, c.id) : Promise.resolve(null),
    canOrders && (tab === "orders" || tab === "overview") ? listOrders(ctx, { customer: c.id, pageSize: tab === "orders" ? 100 : 25 }) : Promise.resolve(null),
  ]);
  const canTickets = canAny(ctx, "tickets.read", "tickets.read_assigned");
  const customerFiles = canTickets && tab === "files" ? await listCustomerFiles(ctx, c.id) : null;
  const [ticketCounts, customerTickets, ticketLookups] = await Promise.all([
    canTickets ? getCustomerTicketCounts(ctx, c.id) : Promise.resolve(null),
    canTickets && tab === "tickets" ? listTickets(ctx, { view: "all", customer: c.id, pageSize: 100 }) : Promise.resolve(null),
    canTickets && tab === "tickets" && can(ctx, "tickets.write") ? loadTicketLookups(ctx) : Promise.resolve(null),
  ]);
  const lifetime = commerce?.byCurrency.filter((b) => b.lifetimeNet !== null) ?? [];
  const memberOpts = lookups.members.map((m) => ({ membershipId: m.membershipId, name: m.name }));

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "timeline", label: "Timeline" },
    { key: "notes", label: `Notes${notes.length ? ` (${notes.length})` : ""}` },
    ...(canLeads ? [{ key: "leads", label: "Leads" }] : []),
    ...(canTasks ? [{ key: "tasks", label: "Tasks" }] : []),
    ...(canOrders ? [{ key: "orders", label: `Orders${commerce?.totalOrders ? ` (${commerce.totalOrders})` : ""}` }] : []),
    ...(canTickets ? [{ key: "tickets", label: `Tickets${ticketCounts?.total ? ` (${ticketCounts.total})` : ""}` }, { key: "files", label: "Files" }] : []),
    ...Object.entries(LATER_TABS).map(([key, t]) => ({ key, label: t.label })),
  ].map((t) => ({ ...t, href: t.key === "overview" ? `${base}/${c.id}` : `${base}/${c.id}?tab=${t.key}` }));
  const editable = perms.write && c.status !== "merged";

  return (
    <>
      <Link href={base} className="text-sm text-primary hover:underline">← Customers</Link>
      <div className="mb-4 mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{initials(c.displayName)}</span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{formatCustomerNumber(c.number)}</span>
              <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label}</Badge>
              {c.type === "business" && <Badge tone="neutral">Business</Badge>}
              <span>· {sourceLabel(c.source)}</span>
              <span>· Customer since {formatDateTime(c.createdAt, ctx.timezone).split(",").slice(0, 2).join(",")}</span>
            </div>
          </div>
        </div>
        <CustomerHeaderActions orgSlug={orgSlug} id={c.id} name={c.displayName} status={c.status} canWrite={perms.write} canArchive={perms.archive} canMerge={perms.merge} />
      </div>

      {c.status === "merged" && (
        <p className="mb-4 rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info">
          This customer was merged into another record and is read-only. <Link className="font-medium underline" href={`${base}/${c.mergedIntoId}`}>Open the surviving customer</Link>.
        </p>
      )}

      <LinkTabs tabs={tabs} active={tab} />

      <div className="mt-6">
        {tab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {canOrders && commerce ? (
                  <>
                    <Metric label="Lifetime spending" value={lifetime.length ? lifetime.map((b) => formatMoney(b.lifetimeNet, b.currency)).join(" · ") : commerce.byCurrency.length && !lifetime.length ? "Hidden" : formatMoney(0, c.preferredCurrency ?? ctx.defaultCurrency)} hint="Paid minus refunds" />
                    <Metric label="Total orders" value={String(commerce.totalOrders)} />
                    <Metric label="Average order" value={lifetime.length ? lifetime.map((b) => formatMoney(b.averageOrder, b.currency)).join(" · ") : "—"} />
                    <Metric label="Last purchase" value={commerce.lastPurchase ? formatRelative(commerce.lastPurchase) : "—"} />
                  </>
                ) : null}
                {ticketCounts && <Metric label="Open tickets" value={String(ticketCounts.open)} hint={`${ticketCounts.total} total`} />}
              </div>
              {canOrders && customerOrders && customerOrders.rows.length > 0 && (
                <Card>
                  <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent orders</CardTitle><Link href={`${base}/${c.id}?tab=orders`} className="text-sm text-primary hover:underline">All orders</Link></CardHeader>
                  <CardContent className="px-0"><OrderTable rows={customerOrders.rows.slice(0, 5)} linkBase={`/o/${orgSlug}/orders`} /></CardContent>
                </Card>
              )}
              {canLeads && (
                <Card>
                  <CardHeader><CardTitle>Open leads</CardTitle></CardHeader>
                  <CardContent>
                    {customerLeads.filter((l) => l.status === "open").length === 0 ? <p className="text-sm text-muted-foreground">No open leads.</p> : (
                      <ul className="divide-y text-sm">
                        {customerLeads.filter((l) => l.status === "open").map((l) => (
                          <li key={l.id} className="flex items-center gap-2 py-2"><Link href={`/o/${orgSlug}/leads/${l.id}`} className="flex-1 font-medium hover:underline">{l.title}</Link><span className="text-xs text-muted-foreground">{l.stage?.name}</span><span className="font-medium">{formatMoney(l.valueAmount, l.currency)}</span></li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
              {canTasks && (
                <Card>
                  <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
                  <CardContent><RelatedTasks orgSlug={orgSlug} tasks={customerTasks} members={memberOpts} currentMembershipId={ctx.membershipId} relation={{ type: "customer", id: c.id, label: c.displayName }} canWrite={can(ctx, "tasks.write") && c.status !== "merged"} canSearchLeads={canLeads} canSearchCustomers /></CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
                <CardContent>
                  <NotesPanel orgSlug={orgSlug} customerId={c.id} notes={notes.slice(0, 5)} currentUserId={ctx.userId} canWrite={editable} canDeleteAny={perms.archive} />
                  {notes.length > 5 && <Link href={`${base}/${c.id}?tab=notes`} className="mt-3 inline-block text-sm text-primary hover:underline">See all {notes.length} notes</Link>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Marketing consent</CardTitle></CardHeader>
                <CardContent><ConsentPanel orgSlug={orgSlug} customerId={c.id} consents={c.consents} canWrite={editable} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Merge history</CardTitle></CardHeader>
                <CardContent><MergeHistory orgSlug={orgSlug} merges={c.merges} canMerge={perms.merge} /></CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="pt-5">
                <CustomerProfile orgSlug={orgSlug} customer={c} members={lookups.members} allTags={lookups.tags} customFields={lookups.customFields} perms={{ write: perms.write, assign: perms.assign, call: canCall }} />
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "leads" && canLeads && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Leads</CardTitle>
              {can(ctx, "leads.write") && c.status !== "merged" && (
                <NewLeadDialog
                  orgSlug={orgSlug}
                  pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name, category: s.category })) }))}
                  members={memberOpts}
                  defaultCurrency={c.preferredCurrency ?? ctx.defaultCurrency}
                  canAssign={can(ctx, "leads.read")}
                  presetCustomer={{ id: c.id, label: c.displayName, sub: `CUS-${c.number}` }}
                />
              )}
            </CardHeader>
            <CardContent>
              {customerLeads.length === 0 ? <p className="text-sm text-muted-foreground">No leads for this customer yet.</p> : (
                <ul className="divide-y text-sm">
                  {customerLeads.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <Link href={`/o/${orgSlug}/leads/${l.id}`} className="flex-1 font-medium hover:underline">{l.title}</Link>
                      <span className="text-xs text-muted-foreground">{l.stage?.name}</span>
                      <Badge tone={l.status === "won" ? "success" : l.status === "lost" ? "danger" : "info"}>{l.status}</Badge>
                      <span className="w-28 text-right font-medium">{formatMoney(l.valueAmount, l.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "tasks" && canTasks && (
          <Card><CardContent className="pt-5"><RelatedTasks orgSlug={orgSlug} tasks={customerTasks} members={memberOpts} currentMembershipId={ctx.membershipId} relation={{ type: "customer", id: c.id, label: c.displayName }} canWrite={can(ctx, "tasks.write") && c.status !== "merged"} canSearchLeads={canLeads} canSearchCustomers /></CardContent></Card>
        )}

        {tab === "orders" && canOrders && customerOrders && (
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Orders & payments</CardTitle>
              {can(ctx, "orders.write") && c.status !== "merged" && <Button asChild size="sm"><Link href={`/o/${orgSlug}/orders/new?customer=${c.id}`}>New order</Link></Button>}
            </CardHeader>
            <CardContent className="px-0">
              {customerOrders.rows.length === 0 ? <p className="px-6 text-sm text-muted-foreground">No orders for this customer yet.</p> : <OrderTable rows={customerOrders.rows} linkBase={`/o/${orgSlug}/orders`} />}
            </CardContent>
          </Card>
        )}

        {tab === "tickets" && canTickets && customerTickets && (
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Support tickets</CardTitle>
              {ticketLookups && c.status !== "merged" && <NewTicketButton size="sm" orgSlug={orgSlug} lookups={ticketLookups.lookups} presetCustomer={{ id: c.id, label: c.displayName }} />}
            </CardHeader>
            <CardContent className="px-0">
              {customerTickets.rows.length === 0 ? <p className="px-6 text-sm text-muted-foreground">No tickets for this customer.</p> : <TicketTable rows={customerTickets.rows} linkBase={`/o/${orgSlug}/support/tickets`} />}
            </CardContent>
          </Card>
        )}

        {tab === "files" && customerFiles && (
          <Card>
            <CardHeader><CardTitle>Files</CardTitle></CardHeader>
            <CardContent>
              {customerFiles.length === 0 ? <p className="text-sm text-muted-foreground">No files yet. Files attached to this customer&apos;s tickets appear here.</p> : (
                <ul className="divide-y text-sm">
                  {customerFiles.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                      <a href={`/o/${orgSlug}/support/attachments/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">{f.filename}</a>
                      <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                      <Link href={`/o/${orgSlug}/support/tickets/${f.ticketId}`} className="text-xs hover:underline">TCK-{f.ticketNumber}</Link>
                      <span className="w-24 text-right text-xs text-muted-foreground">{formatRelative(f.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "notes" && (
          <Card><CardContent className="pt-5"><NotesPanel orgSlug={orgSlug} customerId={c.id} notes={notes} currentUserId={ctx.userId} canWrite={editable} canDeleteAny={perms.archive} /></CardContent></Card>
        )}

        {tab === "timeline" && (
          <Card>
            <CardContent className="pt-5">
              {timeline.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
                <ol className="relative space-y-4 border-l pl-6">
                  {timeline.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-[1.85rem] top-1 size-3 rounded-full border-2 border-card bg-accent" aria-hidden />
                      <div className="text-sm"><span className="font-medium">{t.actorName ?? "System"}</span> {describeAudit(t.action)}</div>
                      {t.changes && (
                        <div className="text-xs text-muted-foreground">
                          {Object.entries(t.changes).map(([k, v]) => <div key={k}>{k}: {String(v.from ?? "—")} → {String(v.to ?? "—")}</div>)}
                        </div>
                      )}
                      {typeof t.metadata?.preview === "string" && <div className="text-xs italic text-muted-foreground">&ldquo;{t.metadata.preview}&rdquo;</div>}
                      <div className="text-xs text-muted-foreground" title={formatDateTime(t.createdAt, ctx.timezone)}>{formatRelative(t.createdAt)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )}

        {LATER_TABS[tab] && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Clock className="size-7 text-highlight" aria-hidden />
              <h2 className="font-semibold">{LATER_TABS[tab].label} arrive in Phase {LATER_TABS[tab].phase}</h2>
              <p className="max-w-md text-sm text-muted-foreground">{LATER_TABS[tab].what} will be linked to this customer profile automatically when that module ships.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate font-semibold" title={value} data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
