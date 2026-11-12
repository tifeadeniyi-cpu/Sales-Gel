import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/domains/customers/schema";
import { memberships } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { leads } from "@/domains/sales/schema";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { taskComments, taskRelations, tasks } from "./schema";

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export const RELATION_TYPES = ["customer", "lead"] as const;
type RelationType = (typeof RELATION_TYPES)[number];

const dateTime = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, c) => {
    if (v === null || v === undefined || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      c.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return d;
  });

export const taskInputSchema = z.object({
  title: z.string().trim().min(2, "Give the task a title").max(200),
  description: z.string().trim().max(10_000).nullish().transform((v) => v || null),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  assigneeMembershipId: z.uuid().nullish(),
  dueAt: dateTime,
  reminderAt: dateTime,
  recurrence: z.enum(RECURRENCES).default("none"),
  relations: z.array(z.object({ type: z.enum(RELATION_TYPES), id: z.uuid() })).max(10).default([]),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export const taskFiltersSchema = z.object({
  scope: z.enum(["mine", "all", "created"]).default("mine"),
  status: z.enum(["open", "done", "all"]).default("open"),
  due: z.enum(["overdue", "today", "week", "none", "any"]).default("any"),
  entityType: z.enum(RELATION_TYPES).optional(),
  entityId: z.uuid().optional(),
  assignee: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TaskFilters = z.input<typeof taskFiltersSchema>;

function canRead(ctx: OrgContext) {
  if (!ctx.permissions.has("tasks.read")) throw new ForbiddenError(undefined, "tasks.read");
}
function canWrite(ctx: OrgContext) {
  if (!ctx.permissions.has("tasks.write")) throw new ForbiddenError(undefined, "tasks.write");
}

async function assertAssignee(tx: Tx, ctx: OrgContext, membershipId: string | null | undefined) {
  if (!membershipId) return null;
  const [m] = await tx.select({ id: memberships.id, userId: memberships.userId, status: memberships.status }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, membershipId)));
  if (!m || m.status !== "active") throw new ValidationError("Choose an active team member.", { assigneeMembershipId: ["Choose an active team member."] });
  return m;
}

/** Related records must exist in this org and be visible to the caller. */
async function assertRelations(tx: Tx, ctx: OrgContext, rels: { type: RelationType; id: string }[]) {
  for (const r of rels) {
    if (r.type === "customer") {
      const [c] = await tx.select({ ownerMembershipId: customers.ownerMembershipId, status: customers.status }).from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, r.id)));
      const ok = c && c.status !== "merged" && (ctx.permissions.has("customers.read") || (ctx.permissions.has("customers.read_assigned") && c.ownerMembershipId === ctx.membershipId));
      if (!ok) throw new ValidationError("Link a customer you have access to.", { relations: ["Link a customer you have access to."] });
    } else {
      const [l] = await tx.select({ ownerMembershipId: leads.ownerMembershipId }).from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, r.id)));
      const ok = l && (ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && l.ownerMembershipId === ctx.membershipId));
      if (!ok) throw new ValidationError("Link a lead you have access to.", { relations: ["Link a lead you have access to."] });
    }
  }
}

async function auditRelated(tx: Tx, ctx: OrgContext, taskId: string, title: string, action: string, rels: { entityType: string; entityId: string }[]) {
  for (const r of rels) await audit(tx, ctx, { action: `${r.entityType}.${action}`, entityType: r.entityType, entityId: r.entityId, metadata: { taskId, preview: title } });
}

async function notifyAssignee(tx: Tx, ctx: OrgContext, taskId: string, title: string, assignee: { id: string; userId: string } | null) {
  if (!assignee || assignee.id === ctx.membershipId) return;
  await notify(tx, { orgId: ctx.orgId, recipientUserId: assignee.userId, type: "task.assigned", title: `Task assigned to you: ${title}`, link: `/o/${ctx.orgSlug}/tasks?open=${taskId}`, entityType: "task", entityId: taskId });
}

export async function createTask(ctx: OrgContext, input: TaskInput) {
  canWrite(ctx);
  const data = parseInput(taskInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const assignee = await assertAssignee(tx, ctx, data.assigneeMembershipId ?? ctx.membershipId);
    await assertRelations(tx, ctx, data.relations);
    const id = newId();
    await tx.insert(tasks).values({
      id,
      organizationId: ctx.orgId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      assigneeMembershipId: assignee?.id ?? null,
      createdByUserId: ctx.userId,
      dueAt: data.dueAt,
      reminderAt: data.reminderAt,
      recurrence: data.recurrence,
    });
    const rels = dedupeRels(data.relations).map((r) => ({ organizationId: ctx.orgId, taskId: id, entityType: r.type, entityId: r.id }));
    if (rels.length) await tx.insert(taskRelations).values(rels);
    await audit(tx, ctx, { action: "task.created", entityType: "task", entityId: id, metadata: { title: data.title, assignee: assignee?.id ?? null } });
    await auditRelated(tx, ctx, id, data.title, "task_created", rels);
    await emit(tx, ctx.orgId, "task.created", { taskId: id });
    await notifyAssignee(tx, ctx, id, data.title, assignee);
    return { id };
  });
}

function dedupeRels(r: { type: RelationType; id: string }[]) {
  const seen = new Set<string>();
  return r.filter((x) => (seen.has(`${x.type}:${x.id}`) ? false : (seen.add(`${x.type}:${x.id}`), true)));
}

async function loadTask(tx: Tx, ctx: OrgContext, id: string) {
  const [t] = await tx.select().from(tasks).where(and(eq(tasks.organizationId, ctx.orgId), eq(tasks.id, id))).for("update");
  if (!t) throw new NotFoundError("Task not found.");
  return t;
}

const updatable = taskInputSchema.pick({ title: true, description: true, priority: true, assigneeMembershipId: true, dueAt: true, reminderAt: true, recurrence: true }).partial();

export async function updateTask(ctx: OrgContext, id: string, patchInput: Record<string, unknown>) {
  canWrite(ctx);
  const raw = parseInput(updatable.extend({ status: z.enum(["todo", "in_progress"]).optional() }), patchInput);
  const patch = Object.fromEntries(Object.entries(raw).filter(([k]) => k in patchInput)) as Partial<typeof tasks.$inferInsert>;
  return withTenant(ctx, async (tx) => {
    const before = await loadTask(tx, ctx, id);
    let assignee = null;
    if ("assigneeMembershipId" in patch) assignee = await assertAssignee(tx, ctx, patch.assigneeMembershipId);
    if (patch.status && before.status === "done") throw new ValidationError("Reopen the task first.");
    const [after] = await tx.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    await audit(tx, ctx, { action: "task.updated", entityType: "task", entityId: id, changes: diff(before, patch) });
    if (assignee && assignee.id !== before.assigneeMembershipId) {
      await notifyAssignee(tx, ctx, id, after.title, assignee);
      await emit(tx, ctx.orgId, "task.assigned", { taskId: id, assigneeMembershipId: assignee.id });
    }
    return after;
  });
}

function nextDue(from: Date, rec: string): Date {
  const d = new Date(from);
  if (rec === "daily") d.setUTCDate(d.getUTCDate() + 1);
  if (rec === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  if (rec === "monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}
export { nextDue as _nextDueForTests };

/** Completes or reopens a task. Completing a recurring task schedules the next occurrence (once). */
export async function setTaskDone(ctx: OrgContext, id: string, done: boolean) {
  canWrite(ctx);
  return withTenant(ctx, async (tx) => {
    const t = await loadTask(tx, ctx, id);
    if ((t.status === "done") === done) return { nextId: null };
    await tx
      .update(tasks)
      .set(done ? { status: "done", completedAt: new Date(), completedByUserId: ctx.userId } : { status: "todo", completedAt: null, completedByUserId: null })
      .where(eq(tasks.id, id));
    const rels = await tx.select().from(taskRelations).where(eq(taskRelations.taskId, id));
    await audit(tx, ctx, { action: done ? "task.completed" : "task.reopened", entityType: "task", entityId: id });
    if (done) await auditRelated(tx, ctx, id, t.title, "task_completed", rels);
    let nextId: string | null = null;
    if (done && t.recurrence !== "none") {
      const [existing] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.organizationId, ctx.orgId), eq(tasks.recurredFromId, id)));
      if (!existing) {
        nextId = newId();
        const base = t.dueAt ?? new Date();
        await tx.insert(tasks).values({
          id: nextId,
          organizationId: ctx.orgId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          assigneeMembershipId: t.assigneeMembershipId,
          createdByUserId: ctx.userId,
          dueAt: nextDue(base, t.recurrence),
          reminderAt: t.reminderAt && t.dueAt ? new Date(nextDue(base, t.recurrence).getTime() - (t.dueAt.getTime() - t.reminderAt.getTime())) : null,
          recurrence: t.recurrence,
          recurredFromId: id,
        });
        if (rels.length) await tx.insert(taskRelations).values(rels.map((r) => ({ ...r, taskId: nextId! })));
        await audit(tx, ctx, { action: "task.created", entityType: "task", entityId: nextId, metadata: { title: t.title, recurredFrom: id } });
      }
    }
    if (done) await emit(tx, ctx.orgId, "task.completed", { taskId: id });
    return { nextId };
  });
}

export async function deleteTask(ctx: OrgContext, id: string) {
  canWrite(ctx);
  return withTenant(ctx, async (tx) => {
    const t = await loadTask(tx, ctx, id);
    if (t.createdByUserId !== ctx.userId && t.assigneeMembershipId !== ctx.membershipId && !ctx.permissions.has("members.manage")) {
      throw new ForbiddenError("Only the creator, the assignee or an admin can delete a task.");
    }
    const rels = await tx.select().from(taskRelations).where(eq(taskRelations.taskId, id));
    await tx.delete(tasks).where(eq(tasks.id, id));
    await audit(tx, ctx, { action: "task.deleted", entityType: "task", entityId: id, metadata: { title: t.title } });
    await auditRelated(tx, ctx, id, t.title, "task_deleted", rels);
  });
}

/* ───────────────────────── Reads ───────────────────────── */

const assigneeUser = sql`(select ${user.name} from ${memberships} join ${user} on ${user.id} = ${memberships.userId} where ${memberships.id} = ${tasks.assigneeMembershipId})`;

export async function listTasks(ctx: OrgContext, filters: TaskFilters = {}) {
  canRead(ctx);
  const f = parseInput(taskFiltersSchema, filters);
  return withTenant(ctx, async (tx) => {
    const tz = ctx.timezone;
    const localDue = sql`(${tasks.dueAt} at time zone ${tz})::date`;
    const localToday = sql`(now() at time zone ${tz})::date`;
    const conds: (SQL | undefined)[] = [eq(tasks.organizationId, ctx.orgId)];
    if (f.scope === "mine") conds.push(eq(tasks.assigneeMembershipId, ctx.membershipId));
    if (f.scope === "created") conds.push(eq(tasks.createdByUserId, ctx.userId));
    if (f.assignee) conds.push(eq(tasks.assigneeMembershipId, f.assignee));
    if (f.status === "open") conds.push(ne(tasks.status, "done"));
    if (f.status === "done") conds.push(eq(tasks.status, "done"));
    if (f.due === "overdue") conds.push(sql`${tasks.dueAt} < now()`, ne(tasks.status, "done"));
    if (f.due === "today") conds.push(sql`${localDue} = ${localToday}`);
    if (f.due === "week") conds.push(sql`${localDue} between ${localToday} and ${localToday} + 7`);
    if (f.due === "none") conds.push(isNull(tasks.dueAt));
    if (f.from) conds.push(sql`${tasks.dueAt} >= ${f.from}`);
    if (f.to) conds.push(sql`${tasks.dueAt} < ${f.to}`);
    if (f.entityType && f.entityId) {
      conds.push(sql`exists (select 1 from ${taskRelations} r where r.task_id = ${tasks.id} and r.entity_type = ${f.entityType} and r.entity_id = ${f.entityId})`);
    }
    const rows = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        reminderAt: tasks.reminderAt,
        recurrence: tasks.recurrence,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        createdByUserId: tasks.createdByUserId,
        assigneeMembershipId: tasks.assigneeMembershipId,
        assigneeName: sql<string | null>`${assigneeUser}`,
        overdue: sql<boolean>`(${tasks.dueAt} < now() and ${tasks.status} <> 'done')`,
      })
      .from(tasks)
      .where(and(...conds))
      .orderBy(sql`${tasks.status} = 'done'`, sql`${tasks.dueAt} asc nulls last`, desc(tasks.createdAt))
      .limit(500);
    return attachRelations(tx, ctx, rows);
  });
}
export type TaskView = Awaited<ReturnType<typeof listTasks>>[number];

/** Adds related-record labels, masking any the caller isn't allowed to see. */
async function attachRelations<T extends { id: string }>(tx: Tx, ctx: OrgContext, rows: T[]) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows.map((r) => ({ ...r, relations: [] as { type: string; id: string; label: string; visible: boolean }[] }));
  const rels = await tx.select().from(taskRelations).where(and(eq(taskRelations.organizationId, ctx.orgId), inArray(taskRelations.taskId, ids)));
  const custIds = rels.filter((r) => r.entityType === "customer").map((r) => r.entityId);
  const leadIds = rels.filter((r) => r.entityType === "lead").map((r) => r.entityId);
  const cs = custIds.length ? await tx.select({ id: customers.id, name: customers.displayName, owner: customers.ownerMembershipId }).from(customers).where(inArray(customers.id, custIds)) : [];
  const ls = leadIds.length ? await tx.select({ id: leads.id, name: leads.title, owner: leads.ownerMembershipId }).from(leads).where(inArray(leads.id, leadIds)) : [];
  const seeCust = (o: string | null) => ctx.permissions.has("customers.read") || (ctx.permissions.has("customers.read_assigned") && o === ctx.membershipId);
  const seeLead = (o: string | null) => ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && o === ctx.membershipId);
  return rows.map((r) => ({
    ...r,
    relations: rels
      .filter((x) => x.taskId === r.id)
      .map((x) => {
        const rec = x.entityType === "customer" ? cs.find((c) => c.id === x.entityId) : ls.find((l) => l.id === x.entityId);
        const visible = !!rec && (x.entityType === "customer" ? seeCust(rec.owner) : seeLead(rec.owner));
        return { type: x.entityType, id: x.entityId, label: visible ? rec!.name : `Restricted ${x.entityType}`, visible };
      }),
  }));
}

export async function getTask(ctx: OrgContext, id: string) {
  canRead(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        reminderAt: tasks.reminderAt,
        recurrence: tasks.recurrence,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
        createdByUserId: tasks.createdByUserId,
        assigneeMembershipId: tasks.assigneeMembershipId,
        assigneeName: sql<string | null>`${assigneeUser}`,
        overdue: sql<boolean>`(${tasks.dueAt} < now() and ${tasks.status} <> 'done')`,
      })
      .from(tasks)
      .where(and(eq(tasks.organizationId, ctx.orgId), eq(tasks.id, id)));
    if (!rows.length) return null;
    const [withRels] = await attachRelations(tx, ctx, rows);
    const comments = await tx
      .select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, authorUserId: taskComments.authorUserId, authorName: user.name })
      .from(taskComments)
      .leftJoin(user, eq(user.id, taskComments.authorUserId))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt));
    const [creator] = withRels.createdByUserId ? await tx.select({ name: user.name }).from(user).where(eq(user.id, withRels.createdByUserId)) : [];
    return { ...withRels, comments, creatorName: creator?.name ?? null };
  });
}
export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTask>>>;

export async function addTaskComment(ctx: OrgContext, taskId: string, input: { body: string; mentionMembershipIds?: string[] }) {
  if (!ctx.permissions.has("tasks.read")) throw new ForbiddenError(undefined, "tasks.read");
  const body = parseInput(z.string().trim().min(1, "Write a comment").max(5000), input.body);
  const mentions = [...new Set(input.mentionMembershipIds ?? [])];
  return withTenant(ctx, async (tx) => {
    const t = await loadTask(tx, ctx, taskId);
    const id = newId();
    await tx.insert(taskComments).values({ id, organizationId: ctx.orgId, taskId, authorUserId: ctx.userId, body });
    const recipients = new Map<string, string>();
    if (mentions.length) {
      const ms = await tx.select({ id: memberships.id, userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), inArray(memberships.id, mentions), eq(memberships.status, "active")));
      if (ms.length !== mentions.length) throw new ValidationError("You can only mention active team members.");
      for (const m of ms) if (m.id !== ctx.membershipId) recipients.set(m.userId, "mention");
    }
    if (t.assigneeMembershipId && t.assigneeMembershipId !== ctx.membershipId) {
      const [a] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, t.assigneeMembershipId));
      if (a && !recipients.has(a.userId)) recipients.set(a.userId, "comment");
    }
    for (const [userId, kind] of recipients) {
      await notify(tx, {
        orgId: ctx.orgId,
        recipientUserId: userId,
        type: kind === "mention" ? "mention" : "task.assigned",
        title: kind === "mention" ? `You were mentioned on “${t.title}”` : `New comment on “${t.title}”`,
        body: body.slice(0, 140),
        link: `/o/${ctx.orgSlug}/tasks?open=${taskId}`,
        entityType: "task",
        entityId: taskId,
      });
    }
    await audit(tx, ctx, { action: "task.commented", entityType: "task", entityId: taskId, metadata: { commentId: id, mentions } });
    return { id };
  });
}

export async function deleteTaskComment(ctx: OrgContext, commentId: string) {
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.select().from(taskComments).where(and(eq(taskComments.organizationId, ctx.orgId), eq(taskComments.id, commentId)));
    if (!c) throw new NotFoundError("Comment not found.");
    if (c.authorUserId !== ctx.userId) throw new ForbiddenError("Only the author can delete a comment.");
    await tx.delete(taskComments).where(eq(taskComments.id, commentId));
    await audit(tx, ctx, { action: "task.comment_deleted", entityType: "task", entityId: c.taskId, metadata: { body: c.body } });
  });
}

export async function getTaskStats(ctx: OrgContext) {
  if (!ctx.permissions.has("tasks.read")) return null;
  return withTenant(ctx, async (tx) => {
    const tz = ctx.timezone;
    const [row] = await tx
      .select({
        dueToday: sql<number>`count(*) filter (where ${tasks.status} <> 'done' and (${tasks.dueAt} at time zone ${tz})::date = (now() at time zone ${tz})::date)::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} <> 'done' and ${tasks.dueAt} < now())::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.organizationId, ctx.orgId), eq(tasks.assigneeMembershipId, ctx.membershipId)));
    return row;
  });
}

