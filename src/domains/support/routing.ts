import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { customerTags, tags } from "@/domains/customers/schema";
import { memberships, organizations, teamMembers } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { audit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { supportTickets, teamAssignmentCursors, ticketFormVersions, ticketRoutingRules, ticketTypes, type RoutingConditions } from "./schema";

type Ticket = typeof supportTickets.$inferSelect;

export interface RoutingFacts { channel: string; priority: string; ticketTypeId: string | null; text: string; customerTags: string[]; formId: string | null }

/** Pure condition check (all listed conditions must hold; empty conditions match everything). */
export function ruleMatches(c: RoutingConditions, f: RoutingFacts) {
  if (c.channels?.length && !c.channels.includes(f.channel)) return false;
  if (c.priorities?.length && !c.priorities.includes(f.priority)) return false;
  if (c.ticketTypeIds?.length && (!f.ticketTypeId || !c.ticketTypeIds.includes(f.ticketTypeId))) return false;
  if (c.formIds?.length && (!f.formId || !c.formIds.includes(f.formId))) return false;
  if (c.keywords?.length) {
    const text = f.text.toLowerCase();
    if (!c.keywords.some((k) => k.trim() && text.includes(k.trim().toLowerCase()))) return false;
  }
  if (c.customerTags?.length) {
    const have = new Set(f.customerTags.map((t) => t.toLowerCase()));
    if (!c.customerTags.some((t) => have.has(t.toLowerCase()))) return false;
  }
  return true;
}

/** Active members of a team who can work tickets, in a stable order. */
async function eligibleMembers(tx: Tx, orgId: string, teamId: string) {
  const rows = await tx.execute<{ id: string }>(sql`
    select m.id from ${teamMembers} tm
    join ${memberships} m on m.id = tm.membership_id and m.status = 'active'
    where tm.organization_id = ${orgId} and tm.team_id = ${teamId}
      and exists (select 1 from role_permissions rp where rp.role_id = m.role_id and rp.permission_key in ('tickets.read','tickets.read_assigned'))
    order by m.created_at, m.id`);
  return rows.map((r) => r.id);
}

/** Next member after the team's cursor (round robin), advancing the cursor atomically. */
export async function nextRoundRobin(tx: Tx, orgId: string, teamId: string): Promise<string | null> {
  await tx.insert(teamAssignmentCursors).values({ organizationId: orgId, teamId }).onConflictDoNothing();
  const [cur] = await tx.select().from(teamAssignmentCursors).where(eq(teamAssignmentCursors.teamId, teamId)).for("update");
  const list = await eligibleMembers(tx, orgId, teamId);
  if (!list.length) return null;
  const i = cur?.lastMembershipId ? list.indexOf(cur.lastMembershipId) : -1;
  const next = list[(i + 1) % list.length];
  await tx.update(teamAssignmentCursors).set({ lastMembershipId: next, updatedAt: new Date() }).where(eq(teamAssignmentCursors.teamId, teamId));
  return next;
}

/**
 * Runs routing rules on a new ticket. `fillOnly` (staff-created tickets) keeps whatever the creator
 * chose and only fills team/assignee/type left empty; portal and form tickets get every action.
 */
export async function routeTicket(tx: Tx, orgId: string, ticketId: string, opts: { fillOnly: boolean }) {
  const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).for("update");
  if (!t) return null;
  const rules = await tx.select().from(ticketRoutingRules).where(and(eq(ticketRoutingRules.organizationId, orgId), eq(ticketRoutingRules.isActive, 1), isNull(ticketRoutingRules.archivedAt))).orderBy(asc(ticketRoutingRules.position), asc(ticketRoutingRules.createdAt));
  if (!rules.length) return null;
  const facts = await factsFor(tx, t);
  const rule = rules.find((r) => ruleMatches(r.conditions ?? {}, facts));
  if (!rule) return null;
  const a = rule.actions;
  const patch: Partial<typeof supportTickets.$inferInsert> = {};
  if (a.teamId && !(opts.fillOnly && t.teamId)) patch.teamId = a.teamId;
  const teamId = patch.teamId ?? t.teamId;
  if (!(opts.fillOnly && t.assigneeMembershipId)) {
    if (a.assign === "member" && a.membershipId) {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, orgId), eq(memberships.id, a.membershipId), eq(memberships.status, "active")));
      if (m) patch.assigneeMembershipId = m.id;
    } else if (a.assign === "round_robin" && teamId) {
      const m = await nextRoundRobin(tx, orgId, teamId);
      if (m) patch.assigneeMembershipId = m;
    }
  }
  if (a.priority && !opts.fillOnly) patch.priority = a.priority;
  if (a.ticketTypeId && !(opts.fillOnly && t.ticketTypeId)) {
    const [ty] = await tx.select({ id: ticketTypes.id }).from(ticketTypes).where(and(eq(ticketTypes.organizationId, orgId), eq(ticketTypes.id, a.ticketTypeId), isNull(ticketTypes.archivedAt)));
    if (ty) patch.ticketTypeId = ty.id;
  }
  if (a.addTags?.length) patch.tags = [...new Set([...(t.tags ?? []), ...a.addTags])].slice(0, 20);
  if (Object.keys(patch).length) await tx.update(supportTickets).set(patch).where(eq(supportTickets.id, t.id));
  await tx.update(ticketRoutingRules).set({ matchedCount: sql`${ticketRoutingRules.matchedCount} + 1` }).where(eq(ticketRoutingRules.id, rule.id));
  await audit(tx, { orgId, userId: null }, { action: "ticket.routed", entityType: "ticket", entityId: t.id, metadata: { rule: rule.name, ruleId: rule.id, applied: Object.keys(patch) } });
  if (patch.assigneeMembershipId) {
    const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, patch.assigneeMembershipId));
    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
    if (m) await notify(tx, { orgId, recipientUserId: m.userId, type: "ticket.assigned", title: `TCK-${t.number} was assigned to you`, body: `${t.subject} (rule: ${rule.name})`, link: `/o/${org.slug}/support/tickets/${t.id}`, entityType: "ticket", entityId: t.id });
  }
  return { ruleId: rule.id, rule: rule.name, patch };
}

async function factsFor(tx: Tx, t: Ticket): Promise<RoutingFacts> {
  let tagNames: string[] = [];
  if (t.customerId) {
    const rows = await tx.select({ name: tags.name }).from(customerTags).innerJoin(tags, eq(tags.id, customerTags.tagId)).where(eq(customerTags.customerId, t.customerId));
    tagNames = rows.map((r) => r.name);
  }
  let formId: string | null = null;
  if (t.formVersionId) {
    const [v] = await tx.select({ formId: ticketFormVersions.formId }).from(ticketFormVersions).where(inArray(ticketFormVersions.id, [t.formVersionId]));
    formId = v?.formId ?? null;
  }
  return { channel: t.channel, priority: t.priority, ticketTypeId: t.ticketTypeId, text: `${t.subject}\n${t.description ?? ""}`, customerTags: tagNames, formId };
}
