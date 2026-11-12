import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

/** Append-only. The app role has INSERT/SELECT only (see migration grants). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    organizationId: organizationId(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    organizationId: organizationId(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: tsz("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notifications_org_id_uq").on(t.organizationId, t.id),
    index("notifications_recipient_idx").on(t.organizationId, t.recipientUserId, t.createdAt.desc()),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("notification_prefs_uq").on(t.organizationId, t.userId, t.eventType),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

/** Transactional outbox. Written in the same transaction as the business change. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    organizationId: organizationId(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: tsz("available_at").notNull().defaultNow(),
    processedAt: tsz("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_pending_idx").on(t.status, t.availableAt),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    check("outbox_status_chk", sql`${t.status} in ('pending','processing','done','failed')`),
  ],
);
