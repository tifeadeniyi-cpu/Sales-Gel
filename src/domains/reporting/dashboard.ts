import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { orders, payments, refunds } from "@/domains/commerce/schema";
import { memberships } from "@/domains/identity/schema";
import { auditLogs } from "@/domains/platform/schema";
import { leads, pipelineStages, pipelines } from "@/domains/sales/schema";
import { leadScope } from "@/domains/sales/service";
import { supportTickets } from "@/domains/support/schema";
import { ticketScope } from "@/domains/support/service";
import { tasks } from "@/domains/tasks/schema";
import { user } from "@/server/auth/schema";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ForbiddenError } from "@/server/errors";
import { pctChange, type Grouping, type Period } from "./period";

export interface DashboardScope {
  period: Period;
  /** Restrict to one team member's records (managers only). */
  memberId?: string | null;
  /** Reporting currency for revenue figures. */
  currency?: string | null;
}

const ACTIVE_TICKET = ["new", "open", "pending_customer", "pending_internal", "escalated"] as const;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Who may filter the dashboard by team member: anyone who can see others' work in at least one area. */
export function canFilterByMember(ctx: OrgContext) {
  return ctx.permissions.has("leads.read") || ctx.permissions.has("tickets.read");
}

async function assertMember(tx: Tx, ctx: OrgContext, memberId: string | null | undefined) {
  if (!memberId) return null;
  if (!canFilterByMember(ctx)) throw new ForbiddenError("You can only see your own work.");
  const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, memberId)));
  return m ? m.id : null;
}

async function revenueFor(tx: Tx, ctx: OrgContext, from: Date, to: Date, memberId: string | null) {
  const orderScope = memberId ? sql`and o.assigned_membership_id = ${memberId}` : sql``;
  const rows = await tx.execute<{ currency: string; paid: string; refunded: string }>(sql`
    select currency, sum(paid)::bigint::text as paid, sum(refunded)::bigint::text as refunded from (
      select p.currency, p.amount as paid, 0 as refunded from ${payments} p join ${orders} o on o.id = p.order_id
       where p.organization_id = ${ctx.orgId} and p.status = 'succeeded' and p.voided_at is null and p.received_at >= ${ts(from)} and p.received_at < ${ts(to)} ${orderScope}
      union all
      select r.currency, 0, r.amount from ${refunds} r join ${orders} o on o.id = r.order_id
       where r.organization_id = ${ctx.orgId} and r.refunded_at >= ${ts(from)} and r.refunded_at < ${ts(to)} ${orderScope}
    ) x group by currency`);
  return Object.fromEntries([...rows].map((r) => [r.currency, Number(r.paid) - Number(r.refunded)])) as Record<string, number>;
}

/** The six performance cards. Each value carries the drill-down filter it was computed with. */
export async function getDashboardCards(ctx: OrgContext, s: DashboardScope) {
  const { period } = s;
  return withTenant(ctx, async (tx) => {
    const memberId = await assertMember(tx, ctx, s.memberId);
    const p = period.prev;

    // Sales revenue: payments received in the period minus refunds processed in it, per currency.
    let revenue: null | { byCurrency: Record<string, number>; previous: Record<string, number> | null; currencies: string[]; currency: string; value: number; change: number | null } = null;
    if (ctx.permissions.has("orders.read") && ctx.permissions.has("orders.financials")) {
      const cur = await revenueFor(tx, ctx, period.from, period.to, memberId);
      const prev = p ? await revenueFor(tx, ctx, p.from, p.to, memberId) : null;
      const currencies = [...new Set([...Object.keys(cur), ...Object.keys(prev ?? {})])].sort();
      const currency = s.currency && /^[A-Z]{3}$/.test(s.currency) ? s.currency : currencies.includes(ctx.defaultCurrency) || !currencies.length ? ctx.defaultCurrency : currencies[0];
      revenue = { byCurrency: cur, previous: prev, currencies: currencies.length ? currencies : [ctx.defaultCurrency], currency, value: cur[currency] ?? 0, change: prev ? pctChange(cur[currency] ?? 0, prev[currency] ?? 0) : null };
    }

    // New leads created in the period.
    let newLeads: null | { value: number; previous: number | null; change: number | null } = null;
    let openDeals: null | { count: number; byCurrency: Record<string, number> } = null;
    if (ctx.permissions.has("leads.read") || ctx.permissions.has("leads.read_assigned")) {
      const base = and(eq(leads.organizationId, ctx.orgId), isNull(leads.archivedAt), leadScope(ctx), memberId ? eq(leads.ownerMembershipId, memberId) : undefined);
      const countIn = async (from: Date, to: Date) => (await tx.select({ n: count() }).from(leads).where(and(base, gte(leads.createdAt, from), lt(leads.createdAt, to))))[0].n;
      const value = await countIn(period.from, period.to);
      const previous = p ? await countIn(p.from, p.to) : null;
      newLeads = { value, previous, change: pctChange(value, previous) };
      const open = await tx.select({ currency: leads.currency, n: count(), v: sql<string>`coalesce(sum(${leads.valueAmount}),0)::text` }).from(leads).where(and(base, eq(leads.status, "open"))).groupBy(leads.currency);
      openDeals = { count: open.reduce((a, r) => a + r.n, 0), byCurrency: Object.fromEntries(open.filter((r) => Number(r.v) > 0).map((r) => [r.currency, Number(r.v)])) };
    }

    // Orders placed in the period (all statuses, matching the orders list for the same dates).
    let ordersCard: null | { value: number; previous: number | null; change: number | null } = null;
    if (ctx.permissions.has("orders.read")) {
      const base = and(eq(orders.organizationId, ctx.orgId), memberId ? eq(orders.assignedMembershipId, memberId) : undefined);
      const countIn = async (from: Date, to: Date) => (await tx.select({ n: count() }).from(orders).where(and(base, gte(orders.placedAt, from), lt(orders.placedAt, to))))[0].n;
      const value = await countIn(period.from, period.to);
      const previous = p ? await countIn(p.from, p.to) : null;
      ordersCard = { value, previous, change: pctChange(value, previous) };
    }

    // Open tickets: current workload, not date-bound.
    let openTickets: null | { value: number; urgent: number; unassigned: number } = null;
    if (ctx.permissions.has("tickets.read") || ctx.permissions.has("tickets.read_assigned")) {
      const [r] = await tx
        .select({
          n: count(),
          urgent: sql<number>`count(*) filter (where ${supportTickets.priority} in ('urgent','high'))::int`,
          unassigned: sql<number>`count(*) filter (where ${supportTickets.assigneeMembershipId} is null)::int`,
        })
        .from(supportTickets)
        .where(and(eq(supportTickets.organizationId, ctx.orgId), ticketScope(ctx), memberId ? eq(supportTickets.assigneeMembershipId, memberId) : undefined, inArray(supportTickets.statusCategory, [...ACTIVE_TICKET])));
      openTickets = { value: r.n, urgent: r.urgent, unassigned: r.unassigned };
    }

    return { revenue, newLeads, openDeals, orders: ordersCard, openTickets, memberId, conversations: { connected: false as const } };
  });
}
export type DashboardCards = Awaited<ReturnType<typeof getDashboardCards>>;

function bucketExpr(col: SQL | unknown, g: Grouping, tz: string) {
  const unit = g === "hour" ? "hour" : g === "day" ? "day" : g === "week" ? "week" : "month";
  return sql`date_trunc(${unit}, (${col} at time zone ${tz}))`;
}

/** Buckets between from and to in the org timezone, as local timestamp strings ("YYYY-MM-DD HH:00"). */
function bucketKeys(from: Date, to: Date, g: Grouping, tz: string): string[] {
  const keys: string[] = [];
  const fmt = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)!.value;
    return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour") };
  };
  const start = fmt(from);
  let cur = Date.UTC(start.y, start.m - 1, start.d, g === "hour" ? start.h : 0);
  if (g === "week") {
    const dow = (new Date(cur).getUTCDay() + 6) % 7; // ISO week starts Monday, like date_trunc
    cur -= dow * 86_400_000;
  }
  if (g === "month") cur = Date.UTC(start.y, start.m - 1, 1);
  const endLocal = fmt(new Date(to.getTime() - 1));
  const endUtc = Date.UTC(endLocal.y, endLocal.m - 1, endLocal.d, g === "hour" ? endLocal.h : 23);
  let guard = 0;
  while (cur <= endUtc && guard++ < 800) {
    const d = new Date(cur);
    keys.push(`${d.toISOString().slice(0, 10)}${g === "hour" ? ` ${String(d.getUTCHours()).padStart(2, "0")}:00` : ""}`);
    if (g === "hour") cur += 3_600_000;
    else if (g === "day") cur += 86_400_000;
    else if (g === "week") cur += 7 * 86_400_000;
    else cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return keys;
}

async function seriesFor(tx: Tx, ctx: OrgContext, metric: "revenue" | "orders", from: Date, to: Date, g: Grouping, currency: string, memberId: string | null) {
  const tz = ctx.timezone;
  const keyFmt = g === "hour" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";
  const map = new Map<string, number>();
  if (metric === "orders") {
    const b = bucketExpr(orders.placedAt, g, tz);
    const rows = await tx
      .select({ k: sql<string>`to_char(${b}, ${keyFmt})`, v: count() })
      .from(orders)
      .where(and(eq(orders.organizationId, ctx.orgId), memberId ? eq(orders.assignedMembershipId, memberId) : undefined, gte(orders.placedAt, from), lt(orders.placedAt, to)))
      .groupBy(sql`1`);
    rows.forEach((r) => map.set(r.k, r.v));
  } else {
    const scope = memberId ? sql`and o.assigned_membership_id = ${memberId}` : sql``;
    const unit = g;
    const rows = await tx.execute<{ k: string; v: string }>(sql`
      select to_char(date_trunc(${unit}, (t at time zone ${tz})), ${keyFmt}) as k, sum(v)::bigint::text as v from (
        select p.received_at as t, p.amount as v from ${payments} p join ${orders} o on o.id = p.order_id
         where p.organization_id = ${ctx.orgId} and p.currency = ${currency} and p.status = 'succeeded' and p.voided_at is null and p.received_at >= ${ts(from)} and p.received_at < ${ts(to)} ${scope}
        union all
        select r.refunded_at, -r.amount from ${refunds} r join ${orders} o on o.id = r.order_id
         where r.organization_id = ${ctx.orgId} and r.currency = ${currency} and r.refunded_at >= ${ts(from)} and r.refunded_at < ${ts(to)} ${scope}
      ) x group by 1`);
    [...rows].forEach((r) => map.set(r.k, Number(r.v)));
  }
  return bucketKeys(from, to, g, tz).map((k) => ({ key: k, value: map.get(k) ?? 0 }));
}

/** Revenue or order counts over time, with an aligned comparison series. */
export async function getSalesSeries(ctx: OrgContext, s: DashboardScope & { metric: "revenue" | "orders" }) {
  if (!ctx.permissions.has("orders.read")) return null;
  if (s.metric === "revenue" && !ctx.permissions.has("orders.financials")) return null;
  return withTenant(ctx, async (tx) => {
    const memberId = await assertMember(tx, ctx, s.memberId);
    const currency = s.currency ?? ctx.defaultCurrency;
    const current = await seriesFor(tx, ctx, s.metric, s.period.from, s.period.to, s.period.grouping, currency, memberId);
    const prev = s.period.prev ? await seriesFor(tx, ctx, s.metric, s.period.prev.from, s.period.prev.to, s.period.grouping, currency, memberId) : null;
    return { metric: s.metric, grouping: s.period.grouping, currency, current, previous: prev, total: current.reduce((a, b) => a + b.value, 0), previousTotal: prev ? prev.reduce((a, b) => a + b.value, 0) : null };
  });
}
export type SalesSeries = NonNullable<Awaited<ReturnType<typeof getSalesSeries>>>;

/** Configured stages of the default pipeline: open stages now, Won within the period. */
export async function getPipelineSummary(ctx: OrgContext, s: DashboardScope) {
  if (!ctx.permissions.has("leads.read") && !ctx.permissions.has("leads.read_assigned")) return null;
  return withTenant(ctx, async (tx) => {
    const memberId = await assertMember(tx, ctx, s.memberId);
    const [pl] = await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), isNull(pipelines.archivedAt))).orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt)).limit(1);
    if (!pl) return { pipelineId: null, stages: [] };
    const stages = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, pl.id), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position));
    const base = and(eq(leads.organizationId, ctx.orgId), eq(leads.pipelineId, pl.id), isNull(leads.archivedAt), leadScope(ctx), memberId ? eq(leads.ownerMembershipId, memberId) : undefined);
    const rows = await tx
      .select({ stageId: leads.stageId, currency: leads.currency, n: count(), v: sql<string>`coalesce(sum(${leads.valueAmount}),0)::text` })
      .from(leads)
      .where(and(base, or(eq(leads.status, "open"), and(eq(leads.status, "won"), gte(leads.closedAt, s.period.from), lt(leads.closedAt, s.period.to)))))
      .groupBy(leads.stageId, leads.currency);
    return {
      pipelineId: pl.id,
      pipelineName: pl.name,
      stages: stages
        .filter((st) => st.category !== "lost")
        .map((st) => {
          const r = rows.filter((x) => x.stageId === st.id);
          return { id: st.id, name: st.name, color: st.color, category: st.category, count: r.reduce((a, x) => a + x.n, 0), byCurrency: Object.fromEntries(r.filter((x) => Number(x.v) > 0).map((x) => [x.currency, Number(x.v)])) };
        }),
    };
  });
}

const FEED_ACTIONS = [
  "lead.created", "lead.stage_changed", "lead.won", "lead.lost", "payment.recorded", "refund.issued", "order.created", "order.completed", "order.cancelled",
  "order.fulfillment_created", "ticket.created", "ticket.resolved", "ticket.customer_message", "ticket.replied", "task.completed",
];

/**
 * Recent activity across sales, orders, support and tasks. Rows are filtered to records the caller
 * may see (same rules as each module), so restricted records never leak through the feed.
 */
export async function getActivityFeed(ctx: OrgContext, opts: { limit?: number; memberId?: string | null } = {}) {
  const limit = Math.min(opts.limit ?? 12, 50);
  return withTenant(ctx, async (tx) => {
    const memberId = await assertMember(tx, ctx, opts.memberId);
    const p = ctx.permissions;
    const allowed: SQL[] = [];
    const ownLead = sql`exists (select 1 from ${leads} l where l.id::text = ${auditLogs.entityId} and l.owner_membership_id = ${ctx.membershipId})`;
    if (p.has("leads.read")) allowed.push(sql`${auditLogs.entityType} = 'lead'`);
    else if (p.has("leads.read_assigned")) allowed.push(sql`(${auditLogs.entityType} = 'lead' and ${ownLead})`);
    if (p.has("orders.read")) allowed.push(sql`(${auditLogs.entityType} = 'order' ${p.has("orders.financials") ? sql`` : sql`and ${auditLogs.action} not in ('payment.recorded','refund.issued','payment.voided')`})`);
    const ownTicket = sql`exists (select 1 from ${supportTickets} t where t.id::text = ${auditLogs.entityId} and t.assignee_membership_id = ${ctx.membershipId})`;
    if (p.has("tickets.read")) allowed.push(sql`${auditLogs.entityType} = 'ticket'`);
    else if (p.has("tickets.read_assigned")) allowed.push(sql`(${auditLogs.entityType} = 'ticket' and ${ownTicket})`);
    if (p.has("tasks.read")) allowed.push(sql`${auditLogs.entityType} = 'task'`);
    if (!allowed.length) return [];
    const actorMembership = memberId ? sql`exists (select 1 from ${memberships} m where m.id = ${memberId} and m.user_id = ${auditLogs.actorUserId})` : undefined;
    const rows = await tx
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, changes: auditLogs.changes, createdAt: auditLogs.createdAt, actorName: user.name })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.organizationId, ctx.orgId), inArray(auditLogs.action, FEED_ACTIONS), sql`(${sql.join(allowed, sql` or `)})`, actorMembership))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    // Resolve record references (numbers/titles) for links.
    const ids = (t: string) => rows.filter((r) => r.entityType === t && r.entityId).map((r) => r.entityId!);
    const [ls, os, tks, ts2] = await Promise.all([
      ids("lead").length ? tx.select({ id: leads.id, label: sql<string>`'LEAD-' || ${leads.number} || ' · ' || ${leads.title}` }).from(leads).where(inArray(leads.id, ids("lead"))) : [],
      ids("order").length ? tx.select({ id: orders.id, label: sql<string>`'ORD-' || ${orders.number}`, source: orders.source }).from(orders).where(inArray(orders.id, ids("order"))) : [],
      ids("ticket").length ? tx.select({ id: supportTickets.id, label: sql<string>`'TCK-' || ${supportTickets.number} || ' · ' || ${supportTickets.subject}`, source: supportTickets.channel }).from(supportTickets).where(inArray(supportTickets.id, ids("ticket"))) : [],
      ids("task").length ? tx.select({ id: tasks.id, label: tasks.title }).from(tasks).where(inArray(tasks.id, ids("task"))) : [],
    ]);
    const lookup = new Map<string, { label: string; source?: string | null }>();
    [...ls, ...os, ...tks, ...ts2].forEach((r) => lookup.set(r.id, r as { label: string; source?: string | null }));
    return rows.map((r) => {
      const ref = r.entityId ? lookup.get(r.entityId) : undefined;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return { id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, actorName: r.actorName, createdAt: r.createdAt, label: ref?.label ?? null, source: (meta.channel as string | undefined) ?? ref?.source ?? null, stage: ((r.changes as { stage?: { to?: string } } | null)?.stage?.to) ?? undefined };
    });
  });
}
export type ActivityItem = Awaited<ReturnType<typeof getActivityFeed>>[number];

/** Members a manager can filter the dashboard by. */
export async function listDashboardMembers(ctx: OrgContext) {
  if (!canFilterByMember(ctx)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({ membershipId: memberships.id, name: user.name })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active")))
      .orderBy(asc(user.name)),
  );
}

