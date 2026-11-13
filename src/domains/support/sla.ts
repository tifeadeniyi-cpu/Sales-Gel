import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { audit, emit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { withScope } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { addBusinessMinutes, ALWAYS_ON, businessMinutesBetween, type Calendar, DEFAULT_SCHEDULE } from "./business-time";
import { businessHours, holidays, slaPolicies, supportTickets, ticketSlaEvents, ticketStatuses, type StatusCategory } from "./schema";

type Ticket = typeof supportTickets.$inferSelect;
type Policy = typeof slaPolicies.$inferSelect;

/** Categories where the resolution clock stops. The first-response clock never pauses. */
const PAUSED: StatusCategory[] = ["pending_customer", "resolved", "closed"];
export const isPausedCategory = (c: StatusCategory) => PAUSED.includes(c);

/* ───────── calendar & policy ───────── */

/** The workspace's default business hours (Mon–Fri 9–5 in the workspace timezone until configured). */
export async function loadCalendar(tx: Tx, orgId: string): Promise<Calendar> {
  const [bh] = await tx.select().from(businessHours).where(and(eq(businessHours.organizationId, orgId), eq(businessHours.isDefault, 1)));
  if (!bh) {
    const [org] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
    return { mode: "business", timezone: org?.tz ?? "UTC", schedule: DEFAULT_SCHEDULE, holidays: new Set() };
  }
  const days = await tx.select({ date: holidays.date }).from(holidays).where(eq(holidays.businessHoursId, bh.id));
  return { mode: "business", timezone: bh.timezone, schedule: bh.schedule, holidays: new Set(days.map((d) => d.date)) };
}

export function policyMatches(p: Pick<Policy, "conditions">, t: Pick<Ticket, "priority" | "ticketTypeId" | "channel">) {
  const c = p.conditions ?? {};
  if (c.priorities?.length && !c.priorities.includes(t.priority)) return false;
  if (c.channels?.length && !c.channels.includes(t.channel)) return false;
  if (c.ticketTypeIds?.length && (!t.ticketTypeId || !c.ticketTypeIds.includes(t.ticketTypeId))) return false;
  return true;
}

async function findPolicy(tx: Tx, orgId: string, t: Ticket) {
  const list = await tx.select().from(slaPolicies).where(and(eq(slaPolicies.organizationId, orgId), eq(slaPolicies.isActive, 1), isNull(slaPolicies.archivedAt))).orderBy(asc(slaPolicies.position), asc(slaPolicies.createdAt));
  return list.find((p) => policyMatches(p, t) && p.targets[t.priority] && (p.targets[t.priority].firstResponse || p.targets[t.priority].resolution)) ?? null;
}

const calendarFor = (p: Policy, cal: Calendar) => (p.calendar === "24x7" ? { ...ALWAYS_ON, timezone: cal.timezone } : cal);

async function event(tx: Tx, orgId: string, ticketId: string, kind: string, metadata: Record<string, unknown> = {}) {
  await tx.insert(ticketSlaEvents).values({ organizationId: orgId, ticketId, kind, metadata });
}

/* ───────── computing due dates ───────── */

/**
 * (Re)applies the matching SLA policy: on creation, and when priority, type or channel change, or a
 * policy is edited. Due dates count working time from when the ticket was created, plus any time
 * the resolution clock spent paused.
 */
export async function applySla(tx: Tx, orgId: string, ticketId: string, now = new Date()) {
  const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for("update");
  if (!t) return;
  const policy = await findPolicy(tx, orgId, t);
  if (!policy) {
    if (t.slaPolicyId) {
      await tx.update(supportTickets).set({ slaPolicyId: null, firstResponseDueAt: null, resolutionDueAt: null }).where(eq(supportTickets.id, t.id));
      await event(tx, orgId, t.id, "removed", {});
    }
    return;
  }
  const cal = calendarFor(policy, await loadCalendar(tx, orgId));
  const target = policy.targets[t.priority];
  const firstResponseDueAt = target.firstResponse ? addBusinessMinutes(t.createdAt, target.firstResponse, cal) : null;
  // While paused, the due date is meaningless; it is recomputed on resume.
  const resolutionDueAt = target.resolution && !t.slaPausedAt ? addBusinessMinutes(t.createdAt, target.resolution + t.slaPausedMinutes, cal) : null;
  const changed = t.slaPolicyId !== policy.id || t.firstResponseDueAt?.getTime() !== firstResponseDueAt?.getTime() || t.resolutionDueAt?.getTime() !== resolutionDueAt?.getTime();
  if (!changed) return;
  await tx.update(supportTickets).set({ slaPolicyId: policy.id, firstResponseDueAt, resolutionDueAt }).where(eq(supportTickets.id, t.id));
  await event(tx, orgId, t.id, "applied", { policy: policy.name, priority: t.priority, firstResponseDueAt, resolutionDueAt });
  // A due date moved earlier than "now" on an unmet clock breaches on the next check.
  await scheduleChecks(tx, orgId, { id: t.id, firstResponseDueAt: t.firstRespondedAt ? null : firstResponseDueAt, resolutionDueAt }, now);
}

async function scheduleChecks(tx: Tx, orgId: string, t: { id: string; firstResponseDueAt: Date | null; resolutionDueAt: Date | null }, now: Date) {
  for (const [kind, due] of [["first_response", t.firstResponseDueAt], ["resolution", t.resolutionDueAt]] as const) {
    if (!due) continue;
    const runAt = due.getTime() < now.getTime() ? now : due;
    await enqueue(tx, orgId, "support.sla_check", { ticketId: t.id, kind, dueAt: due.toISOString() }, { runAt, idempotencyKey: `sla:${t.id}:${kind}:${due.toISOString()}` });
  }
}

/** First staff reply: records whether the first-response target was met. */
export async function slaOnFirstResponse(tx: Tx, orgId: string, t: Ticket, at: Date) {
  if (!t.slaPolicyId || !t.firstResponseDueAt) return;
  if (at <= t.firstResponseDueAt) await event(tx, orgId, t.id, "first_response_met", { dueAt: t.firstResponseDueAt });
  else if (!t.firstResponseBreachedAt) {
    await tx.update(supportTickets).set({ firstResponseBreachedAt: t.firstResponseDueAt }).where(eq(supportTickets.id, t.id));
    await event(tx, orgId, t.id, "first_response_breached", { dueAt: t.firstResponseDueAt, respondedAt: at });
  }
}

/** Pauses/resumes the resolution clock as the status moves; records resolution met. */
export async function slaOnStatusChange(tx: Tx, orgId: string, t: Ticket, to: StatusCategory, now = new Date()) {
  if (!t.slaPolicyId) return;
  const wasPaused = !!t.slaPausedAt;
  const pause = isPausedCategory(to);
  const runningOnTime = t.resolutionDueAt && now <= t.resolutionDueAt;
  if ((to === "resolved" || to === "closed") && !["resolved", "closed"].includes(t.statusCategory) && !t.resolutionBreachedAt && (runningOnTime || wasPaused)) {
    await event(tx, orgId, t.id, "resolution_met", { dueAt: t.resolutionDueAt });
  }
  if (pause && !wasPaused) {
    await tx.update(supportTickets).set({ slaPausedAt: now, resolutionDueAt: null }).where(eq(supportTickets.id, t.id));
    await event(tx, orgId, t.id, "paused", { status: to });
  } else if (!pause && wasPaused) {
    const [p] = await tx.select().from(slaPolicies).where(eq(slaPolicies.id, t.slaPolicyId));
    const cal = p ? calendarFor(p, await loadCalendar(tx, orgId)) : ALWAYS_ON;
    const pausedMinutes = t.slaPausedMinutes + businessMinutesBetween(t.slaPausedAt!, now, cal);
    const target = p?.targets[t.priority]?.resolution ?? null;
    const resolutionDueAt = target ? addBusinessMinutes(t.createdAt, target + pausedMinutes, cal) : null;
    await tx.update(supportTickets).set({ slaPausedAt: null, slaPausedMinutes: pausedMinutes, resolutionDueAt }).where(eq(supportTickets.id, t.id));
    await event(tx, orgId, t.id, "resumed", { pausedMinutes, resolutionDueAt });
    if (resolutionDueAt && !t.resolutionBreachedAt) await scheduleChecks(tx, orgId, { id: t.id, firstResponseDueAt: null, resolutionDueAt }, now);
  }
}

/* ───────── breach handling (background) ───────── */

async function recipients(tx: Tx, orgId: string, t: Ticket) {
  if (t.assigneeMembershipId) {
    const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.id, t.assigneeMembershipId), eq(memberships.status, "active")));
    if (m) return [m.userId];
  }
  // Unassigned: everyone who can assign tickets.
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct m.user_id from memberships m join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = ${orgId} and m.status = 'active' and rp.permission_key = 'tickets.assign'`);
  return rows.map((r) => r.user_id);
}

async function managers(tx: Tx, orgId: string) {
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct m.user_id from memberships m join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = ${orgId} and m.status = 'active' and rp.permission_key = 'tickets.assign'`);
  return rows.map((r) => r.user_id);
}

/** Job: checks one clock at its due time. Stale jobs (due date moved, clock met or paused) do nothing. */
export async function runSlaCheck(job: JobContext) {
  const p = job.payload as { ticketId: string; kind: "first_response" | "resolution"; dueAt: string };
  await withScope({ orgId: job.orgId }, async (tx) => {
    const [t] = await tx.select().from(supportTickets).where(and(eq(supportTickets.organizationId, job.orgId), eq(supportTickets.id, p.ticketId))).for("update");
    if (!t || !t.slaPolicyId) return;
    const now = new Date();
    const due = new Date(p.dueAt);
    if (due > now) return;
    if (p.kind === "first_response") {
      if (t.firstRespondedAt || t.firstResponseBreachedAt || ["resolved", "closed"].includes(t.statusCategory) || t.firstResponseDueAt?.getTime() !== due.getTime()) return;
      await tx.update(supportTickets).set({ firstResponseBreachedAt: due }).where(eq(supportTickets.id, t.id));
      await event(tx, job.orgId, t.id, "first_response_breached", { dueAt: due });
    } else {
      if (t.slaPausedAt || t.resolutionBreachedAt || ["resolved", "closed"].includes(t.statusCategory) || t.resolutionDueAt?.getTime() !== due.getTime()) return;
      await tx.update(supportTickets).set({ resolutionBreachedAt: due }).where(eq(supportTickets.id, t.id));
      await event(tx, job.orgId, t.id, "resolution_breached", { dueAt: due });
    }
    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, job.orgId));
    const link = `/o/${org.slug}/support/tickets/${t.id}`;
    const what = p.kind === "first_response" ? "first reply" : "resolution";
    await audit(tx, { orgId: job.orgId, userId: null }, { action: "ticket.sla_breached", entityType: "ticket", entityId: t.id, metadata: { kind: p.kind, dueAt: due } });
    for (const u of await recipients(tx, job.orgId, t)) {
      await notify(tx, { orgId: job.orgId, recipientUserId: u, type: "sla.warning", title: `TCK-${t.number} missed its ${what} target`, body: t.subject, link, entityType: "ticket", entityId: t.id });
    }
    const [policy] = await tx.select().from(slaPolicies).where(eq(slaPolicies.id, t.slaPolicyId));
    if (policy?.escalateOnBreach && !t.escalatedAt && !["resolved", "closed", "escalated"].includes(t.statusCategory)) await escalate(tx, job.orgId, t, `Missed ${what} target`, link);
    await emit(tx, job.orgId, "ticket.sla_breached", { ticketId: t.id, kind: p.kind });
  });
}

/** Moves a ticket to the escalated status and alerts managers. */
async function escalate(tx: Tx, orgId: string, t: Ticket, reason: string, link: string) {
  const [to] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, orgId), eq(ticketStatuses.category, "escalated"), isNull(ticketStatuses.archivedAt))).orderBy(asc(ticketStatuses.position)).limit(1);
  const now = new Date();
  await tx
    .update(supportTickets)
    .set({ escalatedAt: now, lastActivityAt: now, updatedAt: now, ...(to ? { statusId: to.id, statusCategory: "escalated" as const } : {}) })
    .where(eq(supportTickets.id, t.id));
  await event(tx, orgId, t.id, "escalated", { reason });
  await audit(tx, { orgId, userId: null }, { action: "ticket.escalated", entityType: "ticket", entityId: t.id, metadata: { reason, from: t.statusCategory } });
  for (const u of await managers(tx, orgId)) {
    await notify(tx, { orgId, recipientUserId: u, type: "ticket.escalated", title: `TCK-${t.number} was escalated`, body: `${reason}: ${t.subject}`, link, entityType: "ticket", entityId: t.id });
  }
}

/** Re-applies policies to open tickets after policies or business hours change. */
export async function reapplySlaToOpenTickets(tx: Tx, orgId: string) {
  const open = await tx.select({ id: supportTickets.id }).from(supportTickets).where(and(eq(supportTickets.organizationId, orgId), sql`${supportTickets.statusCategory} not in ('resolved','closed')`)).limit(2000);
  for (const t of open) await applySla(tx, orgId, t.id);
  return open.length;
}

export { slaClock, type SlaState } from "./sla-state";
