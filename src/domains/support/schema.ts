import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, customType, date, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, teams } from "@/domains/identity/schema";
import { customers } from "@/domains/customers/schema";
import { leads } from "@/domains/sales/schema";
import { orders } from "@/domains/commerce/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const STATUS_CATEGORIES = ["new", "open", "pending_customer", "pending_internal", "escalated", "resolved", "closed"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_CHANNELS = ["manual", "phone", "email", "whatsapp", "instagram", "facebook", "tiktok", "sms", "in_person", "web_form", "portal"] as const;
export const MESSAGE_KINDS = ["reply", "note", "customer"] as const;

/** Statuses are configurable; their category drives behavior and reporting. */
export const ticketStatuses = pgTable(
  "ticket_statuses",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    category: text("category").$type<StatusCategory>().notNull(),
    color: text("color").notNull().default("#64748b"),
    position: integer("position").notNull().default(0),
    isDefault: integer("is_default").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ticket_statuses_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("ticket_statuses_name_uq").on(t.organizationId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    uniqueIndex("ticket_statuses_default_uq").on(t.organizationId).where(sql`${t.isDefault} = 1`),
    orgFk("ticket_statuses_org_fk", t),
    check("ticket_statuses_category_chk", sql`${t.category} in ('new','open','pending_customer','pending_internal','escalated','resolved','closed')`),
  ],
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ticket_types_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("ticket_types_name_uq").on(t.organizationId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    orgFk("ticket_types_org_fk", t),
  ],
);

/* ───────── Phase 7: business hours, SLA policies, forms ───────── */

/** Working hours used by SLA clocks. One default calendar per workspace. */
export const businessHours = pgTable(
  "business_hours",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    /** {"1": [[540, 1020]], …}: minutes after local midnight per weekday (0 = Sunday). */
    schedule: jsonb("schedule").$type<Record<string, [number, number][]>>().notNull(),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("business_hours_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("business_hours_default_uq").on(t.organizationId).where(sql`${t.isDefault} = 1`),
    orgFk("business_hours_org_fk", t),
  ],
);

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    organizationId: organizationId(),
    businessHoursId: uuid("business_hours_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("holidays_org_id_uq").on(t.organizationId, t.id),
    unique("holidays_date_uq").on(t.businessHoursId, t.date),
    foreignKey({ name: "holidays_calendar_fk", columns: [t.organizationId, t.businessHoursId], foreignColumns: [businessHours.organizationId, businessHours.id] }).onDelete("cascade"),
  ],
);

export interface SlaTargets { firstResponse: number | null; resolution: number | null }
export interface SlaConditions { priorities?: string[]; ticketTypeIds?: string[]; channels?: string[] }

/** First active policy (by position) whose conditions match a ticket applies to it. */
export const slaPolicies = pgTable(
  "sla_policies",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    conditions: jsonb("conditions").$type<SlaConditions>().notNull().default({}),
    /** Minutes of working time per priority. */
    targets: jsonb("targets").$type<Record<string, SlaTargets>>().notNull(),
    calendar: text("calendar").notNull().default("business"),
    escalateOnBreach: integer("escalate_on_breach").notNull().default(1),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("sla_policies_org_id_uq").on(t.organizationId, t.id),
    orgFk("sla_policies_org_fk", t),
    check("sla_policies_calendar_chk", sql`${t.calendar} in ('business','24x7')`),
  ],
);

export type FormFieldType = "short_text" | "long_text" | "email" | "phone" | "number" | "select" | "multi_select" | "checkbox" | "date" | "order_number";
export interface FormField { key: string; label: string; type: FormFieldType; required: boolean; help?: string; options?: string[] }

export const ticketForms = pgTable(
  "ticket_forms",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    description: text("description"),
    draftFields: jsonb("draft_fields").$type<FormField[]>().notNull().default([]),
    currentVersionId: uuid("current_version_id"),
    ticketTypeId: uuid("ticket_type_id"),
    priority: text("priority").notNull().default("normal"),
    portalVisible: integer("portal_visible").notNull().default(1),
    position: integer("position").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("ticket_forms_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("ticket_forms_name_uq").on(t.organizationId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    orgFk("ticket_forms_org_fk", t),
    foreignKey({ name: "ticket_forms_type_fk", columns: [t.organizationId, t.ticketTypeId], foreignColumns: [ticketTypes.organizationId, ticketTypes.id] }),
    check("ticket_forms_priority_chk", sql`${t.priority} in ('low','normal','high','urgent')`),
  ],
);

/** Published form definitions. Immutable: tickets keep pointing at exactly what the customer saw. */
export const ticketFormVersions = pgTable(
  "ticket_form_versions",
  {
    id: id(),
    organizationId: organizationId(),
    formId: uuid("form_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    fields: jsonb("fields").$type<FormField[]>().notNull(),
    publishedByUserId: text("published_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_form_versions_org_id_uq").on(t.organizationId, t.id),
    unique("ticket_form_versions_num_uq").on(t.formId, t.version),
    foreignKey({ name: "ticket_form_versions_form_fk", columns: [t.organizationId, t.formId], foreignColumns: [ticketForms.organizationId, ticketForms.id] }).onDelete("cascade"),
  ],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: id(),
    organizationId: organizationId(),
    number: integer("number").notNull(),
    subject: text("subject").notNull(),
    description: text("description"),
    customerId: uuid("customer_id"),
    channel: text("channel").notNull().default("manual"),
    ticketTypeId: uuid("ticket_type_id"),
    statusId: uuid("status_id").notNull(),
    statusCategory: text("status_category").$type<StatusCategory>().notNull(),
    priority: text("priority").notNull().default("normal"),
    assigneeMembershipId: uuid("assignee_membership_id"),
    teamId: uuid("team_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    firstRespondedAt: tsz("first_responded_at"),
    resolvedAt: tsz("resolved_at"),
    closedAt: tsz("closed_at"),
    reopenedCount: integer("reopened_count").notNull().default(0),
    resolutionCategory: text("resolution_category"),
    resolutionNote: text("resolution_note"),
    lastActivityAt: tsz("last_activity_at").notNull().defaultNow(),
    lastCustomerMessageAt: tsz("last_customer_message_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    // SLA (Phase 7). Due dates are instants. While waiting on the customer (or resolved) the
    // resolution clock is paused; paused working minutes accumulate so due dates can be recomputed.
    slaPolicyId: uuid("sla_policy_id"),
    firstResponseDueAt: tsz("first_response_due_at"),
    resolutionDueAt: tsz("resolution_due_at"),
    firstResponseBreachedAt: tsz("first_response_breached_at"),
    resolutionBreachedAt: tsz("resolution_breached_at"),
    slaPausedAt: tsz("sla_paused_at"),
    slaPausedMinutes: integer("sla_paused_minutes").notNull().default(0),
    escalatedAt: tsz("escalated_at"),
    formVersionId: uuid("form_version_id"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("support_tickets_org_id_uq").on(t.organizationId, t.id),
    unique("support_tickets_number_uq").on(t.organizationId, t.number),
    index("support_tickets_queue_idx").on(t.organizationId, t.statusCategory, t.lastActivityAt),
    index("support_tickets_assignee_idx").on(t.organizationId, t.assigneeMembershipId),
    index("support_tickets_customer_idx").on(t.organizationId, t.customerId),
    index("support_tickets_subject_trgm").using("gin", sql`${t.subject} gin_trgm_ops`),
    orgFk("support_tickets_org_fk", t),
    foreignKey({ name: "support_tickets_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "support_tickets_status_fk", columns: [t.organizationId, t.statusId], foreignColumns: [ticketStatuses.organizationId, ticketStatuses.id] }),
    foreignKey({ name: "support_tickets_type_fk", columns: [t.organizationId, t.ticketTypeId], foreignColumns: [ticketTypes.organizationId, ticketTypes.id] }),
    foreignKey({ name: "support_tickets_sla_fk", columns: [t.organizationId, t.slaPolicyId], foreignColumns: [slaPolicies.organizationId, slaPolicies.id] }),
    foreignKey({ name: "support_tickets_form_version_fk", columns: [t.organizationId, t.formVersionId], foreignColumns: [ticketFormVersions.organizationId, ticketFormVersions.id] }),
    index("support_tickets_sla_due_idx").on(t.organizationId, t.resolutionDueAt).where(sql`${t.resolutionBreachedAt} is null`),
    check("support_tickets_priority_chk", sql`${t.priority} in ('low','normal','high','urgent')`),
    check("support_tickets_category_chk", sql`${t.statusCategory} in ('new','open','pending_customer','pending_internal','escalated','resolved','closed')`),
    check("support_tickets_subject_chk", sql`length(btrim(${t.subject})) between 1 and 200`),
  ],
);

/**
 * Conversation on a ticket. `reply` = staff to customer (public), `note` = internal only,
 * `customer` = a message from the customer that staff logged (phone call, DM) or a channel delivered.
 * Append-only: history is never rewritten.
 */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid("ticket_id").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    channel: text("channel"),
    deliveryStatus: text("delivery_status").notNull().default("not_sent"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_messages_org_id_uq").on(t.organizationId, t.id),
    index("ticket_messages_ticket_idx").on(t.organizationId, t.ticketId, t.createdAt),
    foreignKey({ name: "ticket_messages_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }).onDelete("cascade"),
    check("ticket_messages_kind_chk", sql`${t.kind} in ('reply','note','customer')`),
    check("ticket_messages_delivery_chk", sql`${t.deliveryStatus} in ('not_sent','queued','sent','delivered','failed','received')`),
    check("ticket_messages_body_chk", sql`length(${t.body}) between 1 and 20000`),
  ],
);

/**
 * Uploaded files. Phase 5 stores content in Postgres (`storage = 'db'`, 10 MB cap per file) behind a
 * storage interface; object storage can replace it without changing callers.
 */
export const files = pgTable(
  "files",
  {
    id: id(),
    organizationId: organizationId(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storage: text("storage").notNull().default("db"),
    storageKey: text("storage_key"),
    content: bytea("content"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("files_org_id_uq").on(t.organizationId, t.id),
    orgFk("files_org_fk", t),
    check("files_size_chk", sql`${t.sizeBytes} between 1 and 10485760`),
    check("files_storage_chk", sql`(${t.storage} = 'db' and ${t.content} is not null) or (${t.storage} <> 'db' and ${t.storageKey} is not null)`),
  ],
);

export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid("ticket_id").notNull(),
    messageId: uuid("message_id"),
    fileId: uuid("file_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_attachments_org_id_uq").on(t.organizationId, t.id),
    index("ticket_attachments_ticket_idx").on(t.organizationId, t.ticketId),
    foreignKey({ name: "ticket_attachments_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }).onDelete("cascade"),
    foreignKey({ name: "ticket_attachments_message_fk", columns: [t.organizationId, t.messageId], foreignColumns: [ticketMessages.organizationId, ticketMessages.id] }),
    foreignKey({ name: "ticket_attachments_file_fk", columns: [t.organizationId, t.fileId], foreignColumns: [files.organizationId, files.id] }),
  ],
);

/** Links a ticket to the orders and leads it is about. Exactly one target per row. */
export const ticketRecordLinks = pgTable(
  "ticket_record_links",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid("ticket_id").notNull(),
    orderId: uuid("order_id"),
    leadId: uuid("lead_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_record_links_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("ticket_record_links_order_uq").on(t.ticketId, t.orderId).where(sql`${t.orderId} is not null`),
    uniqueIndex("ticket_record_links_lead_uq").on(t.ticketId, t.leadId).where(sql`${t.leadId} is not null`),
    index("ticket_record_links_order_idx").on(t.organizationId, t.orderId),
    foreignKey({ name: "ticket_record_links_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }).onDelete("cascade"),
    foreignKey({ name: "ticket_record_links_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }).onDelete("cascade"),
    foreignKey({ name: "ticket_record_links_lead_fk", columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }).onDelete("cascade"),
    check("ticket_record_links_one_chk", sql`num_nonnulls(${t.orderId}, ${t.leadId}) = 1`),
  ],
);


/** Append-only SLA history for a ticket (applied, met, breached, paused, resumed, escalated). */
export const ticketSlaEvents = pgTable(
  "ticket_sla_events",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid("ticket_id").notNull(),
    kind: text("kind").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ticket_sla_events_org_id_uq").on(t.organizationId, t.id),
    index("ticket_sla_events_ticket_idx").on(t.organizationId, t.ticketId, t.createdAt),
    foreignKey({ name: "ticket_sla_events_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }).onDelete("cascade"),
    check("ticket_sla_events_kind_chk", sql`${t.kind} in ('applied','removed','first_response_met','first_response_breached','resolution_met','resolution_breached','paused','resumed','escalated')`),
  ],
);

export interface RoutingConditions { channels?: string[]; priorities?: string[]; ticketTypeIds?: string[]; keywords?: string[]; customerTags?: string[]; formIds?: string[] }
export interface RoutingActions { teamId?: string | null; assign?: "none" | "member" | "round_robin"; membershipId?: string | null; priority?: string | null; ticketTypeId?: string | null; addTags?: string[] }

/** Evaluated in position order on new tickets; the first matching active rule wins. */
export const ticketRoutingRules = pgTable(
  "ticket_routing_rules",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    conditions: jsonb("conditions").$type<RoutingConditions>().notNull().default({}),
    actions: jsonb("actions").$type<RoutingActions>().notNull(),
    matchedCount: integer("matched_count").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("ticket_routing_rules_org_id_uq").on(t.organizationId, t.id), orgFk("ticket_routing_rules_org_fk", t)],
);

/** Round-robin pointer per team. */
export const teamAssignmentCursors = pgTable(
  "team_assignment_cursors",
  {
    organizationId: organizationId(),
    teamId: uuid("team_id").notNull().primaryKey(),
    lastMembershipId: uuid("last_membership_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("team_assignment_cursors_org_uq").on(t.organizationId, t.teamId),
    foreignKey({ name: "team_assignment_cursors_team_fk", columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }).onDelete("cascade"),
  ],
);

/* ───────── Customer portal ───────── */

export const supportPortals = pgTable(
  "support_portals",
  {
    organizationId: organizationId().primaryKey(),
    slug: text("slug").notNull(),
    enabled: integer("enabled").notNull().default(0),
    title: text("title").notNull(),
    welcome: text("welcome"),
    updatedAt: updatedAt(),
  },
  (t) => [
    orgFk("support_portals_org_fk", t),
    check("support_portals_slug_chk", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`),
  ],
);

/** Public slug → workspace. Holds no tenant data; read before a tenant scope exists. */
export const portalRoutes = pgTable("portal_routes", {
  slug: text("slug").primaryKey(),
  organizationId: uuid("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
});

/** Single-ticket access links for customers. Only a SHA-256 of the secret is stored. */
export const portalAccessTokens = pgTable(
  "portal_access_tokens",
  {
    id: id(),
    organizationId: organizationId(),
    ticketId: uuid("ticket_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tsz("expires_at").notNull(),
    revokedAt: tsz("revoked_at"),
    lastUsedAt: tsz("last_used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("portal_access_tokens_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("portal_access_tokens_hash_uq").on(t.tokenHash),
    index("portal_access_tokens_ticket_idx").on(t.organizationId, t.ticketId),
    foreignKey({ name: "portal_access_tokens_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }).onDelete("cascade"),
  ],
);

/** Portal submission log for rate limiting (hashed IP, normalized email). */
export const portalSubmissions = pgTable(
  "portal_submissions",
  {
    id: id(),
    organizationId: organizationId(),
    ipHash: text("ip_hash").notNull(),
    email: text("email").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("portal_submissions_recent_idx").on(t.organizationId, t.createdAt), orgFk("portal_submissions_org_fk", t)],
);
