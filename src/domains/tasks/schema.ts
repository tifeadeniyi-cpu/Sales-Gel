import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

/** One shared task entity; it appears in many contexts through task_relations (no duplicate tasks). */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    organizationId: organizationId(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("medium"),
    assigneeMembershipId: uuid("assignee_membership_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    dueAt: tsz("due_at"),
    reminderAt: tsz("reminder_at"),
    recurrence: text("recurrence").notNull().default("none"),
    recurredFromId: uuid("recurred_from_id"),
    completedAt: tsz("completed_at"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("tasks_org_id_uq").on(t.organizationId, t.id),
    index("tasks_assignee_idx").on(t.organizationId, t.assigneeMembershipId, t.status, t.dueAt),
    index("tasks_due_idx").on(t.organizationId, t.status, t.dueAt),
    foreignKey({ name: "tasks_org_fk", columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    check("tasks_status_chk", sql`${t.status} in ('todo','in_progress','done')`),
    check("tasks_priority_chk", sql`${t.priority} in ('low','medium','high','urgent')`),
    check("tasks_recurrence_chk", sql`${t.recurrence} in ('none','daily','weekly','monthly')`),
    check("tasks_done_chk", sql`(${t.status} = 'done') = (${t.completedAt} is not null)`),
  ],
);

/**
 * Polymorphic links (customer, lead; later order, ticket). Validated in the service;
 * rows are removed when the task is deleted.
 */
export const taskRelations = pgTable(
  "task_relations",
  {
    organizationId: organizationId(),
    taskId: uuid("task_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.entityType, t.entityId] }),
    index("task_relations_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    foreignKey({ name: "task_relations_task_fk", columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
    check("task_relations_type_chk", sql`${t.entityType} in ('customer','lead','order','ticket')`),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: id(),
    organizationId: organizationId(),
    taskId: uuid("task_id").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_comments_task_idx").on(t.organizationId, t.taskId, t.createdAt),
    foreignKey({ name: "task_comments_task_fk", columns: [t.organizationId, t.taskId], foreignColumns: [tasks.organizationId, tasks.id] }).onDelete("cascade"),
  ],
);
