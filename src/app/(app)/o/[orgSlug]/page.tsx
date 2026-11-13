import Link from "next/link";
import { ArrowRight, CircleDollarSign, Filter, Inbox, KanbanSquare, MessageSquareOff, Plug, ShoppingBag, Ticket } from "lucide-react";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getOrder, listOrders } from "@/domains/commerce/orders";
import { listAssignableMembers } from "@/domains/customers/service";
import { canFilterByMember, getActivityFeed, getDashboardCards, getPipelineSummary, getSalesSeries, listDashboardMembers, type ActivityItem } from "@/domains/reporting/dashboard";
import { getDashboardLayout } from "@/domains/reporting/layout";
import { COMPARE_LABELS, resolvePeriod } from "@/domains/reporting/period";
import type { WidgetKey } from "@/domains/reporting/widgets";
import { getSupportStats, getTicket } from "@/domains/support/service";
import { CHANNEL_LABELS } from "@/domains/support/validation";
import { getTask, listTasks } from "@/domains/tasks/service";
import { formatMoney } from "@/lib/money";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";
import { can, canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { requireUser } from "@/server/auth/session";
import { FULFILLMENT_STATUS, PAYMENT_STATUS, SOURCE_LABELS } from "./orders/_components/labels";
import { OrderBadges, OrderItemsCard, OrderSideCard, OrderToolbar } from "./orders/_components/order-view";
import { CATEGORY_TONE, PRIORITY } from "./support/tickets/_components/labels";
import { loadTicketLookups } from "./support/tickets/_components/load";
import { NewTicketButton } from "./support/tickets/_components/new-ticket-dialog";
import { TicketBadges, TicketWorkspace } from "./support/tickets/_components/ticket-view";
import { TaskDetailPanel } from "./tasks/_components/task-detail";
import { TaskFormDialog } from "./tasks/_components/task-form-dialog";
import { CustomizeDashboard } from "./_dashboard/customize";
import { FollowUps } from "./_dashboard/followups";
import { DashboardHeader } from "./_dashboard/header";
import { OpenRecord, OpenRow } from "./_dashboard/open-record";
import { SalesChart } from "./_dashboard/sales-chart";

type SP = Record<string, string | undefined>;
const UUID = /^[0-9a-f-]{36}$/i;

/** Stage colors match the pipeline board's palette (configured per stage). */
const STAGE_COLORS: Record<string, string> = { teal: "#0b7f72", blue: "#0053ee", gold: "#c88a2b", purple: "#7c3aed", gray: "#6b7280", green: "#15803d", red: "#b91c1c" };

function money(t: Record<string, number> | null | undefined, fallback: string) {
  const parts = Object.entries(t ?? {}).map(([c, v]) => formatMoney(v, c));
  return parts.length ? parts.join(" · ") : formatMoney(0, fallback);
}

function Change({ value, label }: { value: number | null | undefined; label: string | null }) {
  if (!label) return null;
  if (value === null || value === undefined) return <span className="text-xs text-muted-foreground">No comparison data</span>;
  const up = value >= 0;
  return (
    <span className={cn("text-xs font-medium", up ? "text-success" : "text-danger")}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> <span className="sr-only">{up ? "Up" : "Down"} </span>{Math.abs(value)}% <span className="font-normal text-muted-foreground">vs {label.toLowerCase()}</span>
    </span>
  );
}

function StatCard({ href, icon, tint, label, value, sub, change, testId }: { href: string; icon: React.ReactNode; tint: string; label: string; value: string; sub: React.ReactNode; change?: React.ReactNode; testId: string }) {
  return (
    <Link href={href} className="group block rounded-xl focus-visible:outline-primary" data-testid={testId}>
      <Card className="h-full rounded-xl transition group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md">
        <CardContent className="flex gap-3 p-4">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", tint)} aria-hidden>{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="truncate text-2xl font-bold tracking-tight" title={value} data-testid={`${testId}-value`}>{value}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
            {change && <div className="mt-1">{change}</div>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Widget({ title, subtitle, actions, children, className, id }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; id: string }) {
  return (
    <section aria-labelledby={`w-${id}`} className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`w-${id}`} className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 text-sm">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

const ACTIVITY_TEXT: Record<string, string> = {
  "lead.created": "created lead", "lead.stage_changed": "moved deal", "lead.won": "won deal", "lead.lost": "marked deal lost",
  "payment.recorded": "recorded a payment on", "refund.issued": "issued a refund on", "order.created": "created order", "order.completed": "completed order",
  "order.cancelled": "cancelled order", "order.fulfillment_created": "fulfilled items on", "ticket.created": "opened ticket", "ticket.resolved": "resolved ticket",
  "ticket.customer_message": "logged a customer reply on", "ticket.replied": "replied on", "task.completed": "completed task",
};
function activityHref(base: string, a: ActivityItem) {
  if (!a.entityId) return null;
  return a.entityType === "lead" ? `${base}/leads/${a.entityId}` : a.entityType === "order" ? `${base}/orders/${a.entityId}` : a.entityType === "ticket" ? `${base}/support/tickets/${a.entityId}` : a.entityType === "task" ? `${base}/tasks?open=${a.entityId}&scope=all` : null;
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const user = await requireUser();
  const sp = await searchParams;
  const base = `/o/${orgSlug}`;
  const period = resolvePeriod({ range: sp.range, from: sp.from, to: sp.to, compare: sp.compare }, ctx.timezone);
  const compareLabel = period.prev ? COMPARE_LABELS[period.compare] : null;
  const memberId = canFilterByMember(ctx) && sp.member && UUID.test(sp.member) ? sp.member : null;
  const seeMoney = can(ctx, "orders.read") && can(ctx, "orders.financials");
  const metric = sp.metric === "orders" || !seeMoney ? "orders" : "revenue";
  const taskStatus = sp.tasks === "done" ? "done" : "open";
  const scope = { period, memberId, currency: sp.currency && /^[A-Z]{3}$/.test(sp.currency) ? sp.currency : null };

  const [layout, cards, members, assignable] = await Promise.all([
    getDashboardLayout(ctx),
    getDashboardCards(ctx, scope),
    listDashboardMembers(ctx),
    can(ctx, "tasks.read") ? listAssignableMembers(ctx) : Promise.resolve([]),
  ]);
  const currency = cards.revenue?.currency ?? ctx.defaultCurrency;
  const [series, pipeline, followups, recentOrders, support, activity, ticketLookups] = await Promise.all([
    can(ctx, "orders.read") ? getSalesSeries(ctx, { ...scope, currency, metric }) : Promise.resolve(null),
    getPipelineSummary(ctx, scope),
    can(ctx, "tasks.read") ? listTasks(ctx, { scope: "mine", status: taskStatus }) : Promise.resolve(null),
    can(ctx, "orders.read") ? listOrders(ctx, { from: period.from.toISOString(), to: period.to.toISOString(), assignee: memberId ?? undefined, pageSize: 25 }) : Promise.resolve(null),
    getSupportStats(ctx, { since: period.from, until: period.to, membershipId: memberId ?? undefined }),
    getActivityFeed(ctx, { limit: 12, memberId }),
    can(ctx, "tickets.write") ? loadTicketLookups(ctx) : Promise.resolve(null),
  ]);

  // Record side panel (`?open=order:<id>` etc.) — the dashboard stays put underneath.
  let drawer: React.ReactNode = null;
  const [openKind, openId] = (sp.open ?? "").split(":");
  if (openId && UUID.test(openId)) {
    if (openKind === "order" && can(ctx, "orders.read")) {
      const o = await getOrder(ctx, openId);
      if (o) drawer = (
        <RecordDrawer title={`ORD-${o.number}`} subtitle={<OrderBadges o={o} />} fullHref={`${base}/orders/${o.id}`}>
          <div className="space-y-4 p-5"><OrderToolbar ctx={ctx} orgSlug={orgSlug} o={o} /><OrderItemsCard o={o} /><OrderSideCard ctx={ctx} orgSlug={orgSlug} o={o} /></div>
        </RecordDrawer>
      );
    } else if (openKind === "ticket" && canAny(ctx, "tickets.read", "tickets.read_assigned")) {
      const t = await getTicket(ctx, openId);
      if (t) drawer = (
        <RecordDrawer wide title={`TCK-${t.number} · ${t.subject}`} subtitle={<TicketBadges t={t} />} fullHref={`${base}/support/tickets/${t.id}`}>
          <div className="p-5"><TicketWorkspace ctx={ctx} orgSlug={orgSlug} t={t} lookups={await loadTicketLookups(ctx)} /></div>
        </RecordDrawer>
      );
    } else if (openKind === "task" && can(ctx, "tasks.read")) {
      const t = await getTask(ctx, openId);
      if (t) drawer = (
        <RecordDrawer title="Task" fullHref={`${base}/tasks?open=${t.id}&scope=all`}>
          <TaskDetailPanel orgSlug={orgSlug} task={t} members={assignable.map((m) => ({ membershipId: m.membershipId, name: m.name }))} currentUserId={ctx.userId} currentMembershipId={ctx.membershipId}
            canWrite={can(ctx, "tasks.write")} canDelete={can(ctx, "tasks.write") && (t.createdByUserId === ctx.userId || t.assigneeMembershipId === ctx.membershipId || can(ctx, "members.manage"))} />
        </RecordDrawer>
      );
    }
  }

  const from = encodeURIComponent(period.from.toISOString());
  const to = encodeURIComponent(period.to.toISOString());
  const periodWord = period.label.toLowerCase();
  const memberQ = (k: string) => (memberId ? `&${k}=${memberId}` : "");

  const widgets: Record<WidgetKey, React.ReactNode> = {
    sales: series ? (
      <Widget id="sales" title="Sales Performance" subtitle={`${period.label} · ${metric === "revenue" ? "payments received minus refunds" : "orders placed"}`}
        actions={<Link href={`${base}/orders?moneyFrom=${from}&moneyTo=${to}${memberQ("assignee")}`} className="text-primary hover:underline">View report <ArrowRight className="inline size-3.5" /></Link>}>
        <SalesChart data={series} currencies={cards.revenue?.currencies ?? [currency]} compareLabel={compareLabel} canRevenue={seeMoney} />
      </Widget>
    ) : null,
    pipeline: pipeline ? (
      <Widget id="pipeline" title="Sales Pipeline" subtitle={`${pipeline.pipelineName ?? "Pipeline"} · open deals now, Won in ${periodWord}`}
        actions={<>
          {can(ctx, "leads.write") && <Button asChild size="sm" variant="outline"><Link href={`${base}/deals?new=1`}>Add deal</Link></Button>}
          <Link href={`${base}/deals${memberId ? `?owner=${memberId}` : ""}`} className="text-primary hover:underline">View pipeline <ArrowRight className="inline size-3.5" /></Link>
        </>}>
        {pipeline.stages.length === 0 ? <p className="text-sm text-muted-foreground">No pipeline yet.</p> : (
          <>
            <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {pipeline.stages.map((st) => (
                <li key={st.id}>
                  <Link href={`${base}/deals?stage=${st.id}${memberQ("owner")}`} className="block h-full rounded-lg border p-3 transition hover:border-primary/40 hover:bg-muted/30" style={{ borderTopColor: STAGE_COLORS[st.color] ?? "#64748b", borderTopWidth: 3 }}>
                    <div className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span className="truncate">{st.name}</span>
                      <span className="rounded-full bg-muted px-2 text-xs tabular-nums" aria-label={`${st.count} deals`}>{st.count}</span>
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold tabular-nums">{money(st.byCurrency, ctx.defaultCurrency)}</div>
                    {st.category === "won" && <div className="text-[11px] text-muted-foreground">Won in {periodWord}</div>}
                  </Link>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Lost deals stay available in the full pipeline. Values are shown per currency.</p>
          </>
        )}
      </Widget>
    ) : null,
    inbox: (
      <Widget id="inbox" title="Inbox Preview" subtitle="Conversations that need a reply">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageSquareOff className="size-6" aria-hidden /></span>
          <div>
            <p className="font-medium">No channels connected yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Email, WhatsApp, Instagram, Messenger, SMS and website chat will appear here once connected. Nothing is being received until then.</p>
          </div>
          <Button asChild variant="outline"><Link href={`${base}/inbox`}><Plug /> Connect channel</Link></Button>
        </div>
      </Widget>
    ),
    followups: followups ? (
      <Widget id="followups" title="My Follow-ups" subtitle="Overdue first, then today and upcoming"
        actions={<>
          {can(ctx, "tasks.write") && <TaskFormDialog orgSlug={orgSlug} members={assignable.map((m) => ({ membershipId: m.membershipId, name: m.name }))} currentMembershipId={ctx.membershipId} canSearchLeads={canAny(ctx, "leads.read", "leads.read_assigned")} canSearchCustomers={canAny(ctx, "customers.read", "customers.read_assigned")} trigger={<Button size="sm" variant="outline">Add task</Button>} />}
          <Link href={`${base}/tasks`} className="text-primary hover:underline">View all tasks <ArrowRight className="inline size-3.5" /></Link>
        </>}>
        <FollowUps orgSlug={orgSlug} tasks={followups.slice(0, 10)} members={assignable.map((m) => ({ membershipId: m.membershipId, name: m.name }))} canWrite={can(ctx, "tasks.write")} status={taskStatus} />
      </Widget>
    ) : null,
    orders: recentOrders ? (
      <Widget id="orders" title="Recent Orders" subtitle={`Placed in ${periodWord}`}
        actions={<>
          {can(ctx, "orders.write") && <Button asChild size="sm" variant="outline"><Link href={`${base}/orders/new`}>Create order</Link></Button>}
          <Link href={`${base}/orders?from=${from}&to=${to}${memberQ("assignee")}`} className="text-primary hover:underline">View all orders <ArrowRight className="inline size-3.5" /></Link>
        </>}>
        {recentOrders.rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No orders in {periodWord}.</p> : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground"><th className="px-5 py-2 font-medium">Order</th><th className="py-2 font-medium">Customer · source</th><th className="py-2 font-medium">Date</th><th className="py-2 text-right font-medium">Total</th><th className="py-2 pl-3 font-medium">Payment</th><th className="py-2 pr-5 font-medium">Fulfillment</th></tr></thead>
              <tbody className="divide-y">
                {recentOrders.rows.slice(0, 6).map((o) => (
                  <OpenRow key={o.id} kind="order" id={o.id}>
                    <td className="whitespace-nowrap px-5 py-2.5"><OpenRecord kind="order" id={o.id} className="font-medium text-primary">ORD-{o.number}</OpenRecord></td>
                    <td className="max-w-40 py-2.5"><div className="truncate">{o.customerName ?? <span className="text-muted-foreground">Walk-in</span>}</div><div className="text-xs text-muted-foreground">{SOURCE_LABELS[o.source] ?? o.source}</div></td>
                    <td className="whitespace-nowrap py-2.5 text-muted-foreground" title={formatDateTime(o.placedAt, ctx.timezone)}>{formatRelative(o.placedAt)}</td>
                    <td className="whitespace-nowrap py-2.5 text-right font-medium tabular-nums">{o.totalAmount === null ? "—" : formatMoney(o.totalAmount, o.currency)}</td>
                    <td className="whitespace-nowrap py-2.5 pl-3"><Badge tone={PAYMENT_STATUS[o.paymentStatus].tone}>{PAYMENT_STATUS[o.paymentStatus].label}</Badge></td>
                    <td className="whitespace-nowrap py-2.5 pr-5"><Badge tone={FULFILLMENT_STATUS[o.fulfillmentStatus].tone}>{FULFILLMENT_STATUS[o.fulfillmentStatus].label}</Badge></td>
                  </OpenRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Widget>
    ) : null,
    support: support ? (
      <Widget id="support" title="Support Overview" subtitle={`Workload now · resolved in ${periodWord}`}
        actions={<>
          {ticketLookups && <NewTicketButton size="sm" variant="outline" label="Create ticket" orgSlug={orgSlug} lookups={ticketLookups.lookups} />}
          <Link href={`${base}/support/tickets?view=open${memberQ("assignee")}`} className="text-primary hover:underline">View tickets <ArrowRight className="inline size-3.5" /></Link>
        </>}>
        <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Open", String(support.open), `${base}/support/tickets?view=open${memberQ("assignee")}`],
            ["Unassigned", String(support.unassigned), `${base}/support/tickets?view=unassigned`],
            ["Overdue", support.withPolicy ? String(support.slaOverdue) : "—", support.withPolicy ? `${base}/support/tickets?view=sla` : null],
            [`Resolved`, String(support.resolved), `${base}/support/tickets?view=resolved${memberQ("assignee")}`],
          ].map(([l, v, href]) => {
            const inner = (<><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-xl font-bold tabular-nums">{v}</dd>{l === "Overdue" && !support.withPolicy && <dd className="text-[11px] text-muted-foreground">Needs SLA targets</dd>}</>);
            return href ? <Link key={l} href={href} className="rounded-lg border p-3 hover:border-primary/40">{inner}</Link> : <div key={l} className="rounded-lg border bg-muted/30 p-3" title="Overdue tickets are calculated once SLA policies are configured in Settings → Support.">{inner}</div>;
          })}
        </dl>
        {support.priorityTickets.length === 0 ? <p className="text-center text-sm text-muted-foreground">No open tickets.</p> : (
          <ul className="divide-y rounded-lg border text-sm">
            {support.priorityTickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <OpenRecord kind="ticket" id={t.id} className="min-w-0 flex-1 truncate font-medium"><span className="text-muted-foreground">TCK-{t.number}</span> {t.subject}</OpenRecord>
                <span className="max-w-28 truncate text-xs text-muted-foreground">{t.customerName ?? "No customer"}</span>
                <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                <Badge tone={CATEGORY_TONE[t.statusCategory]}>{t.statusName}</Badge>
                <span className="w-24 truncate text-right text-xs">{t.assigneeName ?? <span className="text-warning">Unassigned</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ) : null,
    activity: (
      <Widget id="activity" title="Recent Activity" subtitle="Across deals, orders, tickets and tasks you can see">
        {activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
          <ol className="divide-y">
            {activity.map((a) => {
              const href = activityHref(base, a);
              return (
                <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", a.entityType === "order" ? "bg-primary/10 text-primary" : a.entityType === "ticket" ? "bg-accent/20 text-teal-ink" : a.entityType === "lead" ? "bg-highlight/15 text-highlight" : "bg-success/10 text-success")} aria-hidden>
                    {a.entityType === "order" ? <ShoppingBag className="size-3.5" /> : a.entityType === "ticket" ? <Ticket className="size-3.5" /> : a.entityType === "lead" ? <KanbanSquare className="size-3.5" /> : <Filter className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{a.actorName ?? "System"}</span> {ACTIVITY_TEXT[a.action] ?? a.action}{" "}
                    {href && a.label ? <Link href={href} className="font-medium text-primary hover:underline">{a.label}</Link> : a.label && <span className="font-medium">{a.label}</span>}
                    {a.stage && <span className="text-muted-foreground"> → {a.stage}</span>}
                    {a.source && <span className="text-xs text-muted-foreground"> · via {(a.entityType === "order" ? SOURCE_LABELS[a.source] : CHANNEL_LABELS[a.source as keyof typeof CHANNEL_LABELS]) ?? a.source}</span>}
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()} title={formatDateTime(a.createdAt, ctx.timezone)}>{formatRelative(a.createdAt)}</time>
                </li>
              );
            })}
          </ol>
        )}
      </Widget>
    ),
  };

  const c = cards;
  return (
    <>
      <DashboardHeader
        firstName={user.name.split(/\s+/)[0] || user.name}
        range={period.range}
        compare={period.compare}
        from={sp.from}
        to={sp.to}
        memberId={memberId}
        members={members}
        onCustomize={<CustomizeDashboard orgSlug={orgSlug} layout={layout.widgets} source={layout.source} canSetDefault={can(ctx, "org.settings.manage")} hasWorkspaceDefault={layout.hasWorkspaceDefault} />}
      />

      <h2 className="sr-only">Performance</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {c.revenue && (
          <StatCard testId="card-revenue" href={`${base}/orders?moneyFrom=${from}&moneyTo=${to}${memberQ("assignee")}`} tint="bg-success/10 text-success" icon={<CircleDollarSign className="size-5" />}
            label="Sales Revenue" value={formatMoney(c.revenue.value, c.revenue.currency)}
            sub={c.revenue.currencies.length > 1 ? `${c.revenue.currency} · other currencies reported separately` : `${period.label} · net of refunds`}
            change={<Change value={c.revenue.change} label={compareLabel} />} />
        )}
        {c.newLeads && (
          <StatCard testId="card-leads" href={`${base}/leads?status=all&from=${from}&to=${to}${memberQ("owner")}`} tint="bg-highlight/15 text-highlight" icon={<Filter className="size-5" />}
            label="New Leads" value={c.newLeads.value.toLocaleString()} sub={`Created ${periodWord}`} change={<Change value={c.newLeads.change} label={compareLabel} />} />
        )}
        {c.openDeals && (
          <StatCard testId="card-deals" href={`${base}/deals${memberId ? `?owner=${memberId}` : ""}`} tint="bg-primary/10 text-primary" icon={<KanbanSquare className="size-5" />}
            label="Open Deals" value={c.openDeals.count.toLocaleString()} sub={<>Now · {money(c.openDeals.byCurrency, ctx.defaultCurrency)}</>} />
        )}
        {c.orders && (
          <StatCard testId="card-orders" href={`${base}/orders?from=${from}&to=${to}${memberQ("assignee")}`} tint="bg-info/10 text-info" icon={<ShoppingBag className="size-5" />}
            label="Orders" value={c.orders.value.toLocaleString()} sub={`Placed ${periodWord}`} change={<Change value={c.orders.change} label={compareLabel} />} />
        )}
        <StatCard testId="card-conversations" href={`${base}/inbox`} tint="bg-muted text-muted-foreground" icon={<Inbox className="size-5" />}
          label="Unresponded Conversations" value="—" sub="No channels connected · Connect channel" />
        {c.openTickets && (
          <StatCard testId="card-tickets" href={`${base}/support/tickets?view=open${memberQ("assignee")}`} tint="bg-accent/20 text-teal-ink" icon={<Ticket className="size-5" />}
            label="Open Tickets" value={c.openTickets.value.toLocaleString()} sub={`Now · ${c.openTickets.urgent} urgent or high · ${c.openTickets.unassigned} unassigned`} />
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {layout.widgets.filter((w) => w.visible && widgets[w.key]).map((w) => (
          <div key={w.key} className={cn("min-w-0", w.width === "full" && "md:col-span-2")}>{widgets[w.key]}</div>
        ))}
      </div>
      {drawer}
    </>
  );
}
