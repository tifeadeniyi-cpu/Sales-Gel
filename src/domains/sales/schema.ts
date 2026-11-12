import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { customers } from "@/domains/customers/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("pipelines_org_id_uq").on(t.organizationId, t.id),
    foreignKey({ name: "pipelines_org_fk", columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    organizationId: organizationId(),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    color: text("color").notNull().default("teal"),
    probability: integer("probability").notNull().default(0),
    category: text("category").notNull().default("open"),
    requiredFields: jsonb("required_fields").$type<string[]>().notNull().default([]),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("pipeline_stages_org_id_uq").on(t.organizationId, t.id),
    unique("pipeline_stages_pipeline_id_uq").on(t.organizationId, t.pipelineId, t.id),
    index("pipeline_stages_pipeline_idx").on(t.organizationId, t.pipelineId, t.position),
    foreignKey({ name: "pipeline_stages_pipeline_fk", columns: [t.organizationId, t.pipelineId], foreignColumns: [pipelines.organizationId, pipelines.id] }).onDelete("cascade"),
    check("pipeline_stages_category_chk", sql`${t.category} in ('open','won','lost')`),
    check("pipeline_stages_probability_chk", sql`${t.probability} between 0 and 100`),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    organizationId: organizationId(),
    number: bigint("number", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    customerId: uuid("customer_id"),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    status: text("status").notNull().default("open"),
    valueAmount: bigint("value_amount", { mode: "number" }),
    currency: text("currency").notNull(),
    source: text("source"),
    probability: integer("probability"),
    priority: text("priority").notNull().default("medium"),
    ownerMembershipId: uuid("owner_membership_id"),
    expectedCloseDate: date("expected_close_date", { mode: "string" }),
    notes: text("notes"),
    position: doublePrecision("position").notNull().default(0),
    closedAt: tsz("closed_at"),
    lostReason: text("lost_reason"),
    archivedAt: tsz("archived_at"),
    lastActivityAt: tsz("last_activity_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("leads_org_id_uq").on(t.organizationId, t.id),
    unique("leads_org_number_uq").on(t.organizationId, t.number),
    index("leads_board_idx").on(t.organizationId, t.pipelineId, t.stageId, t.position),
    index("leads_owner_idx").on(t.organizationId, t.ownerMembershipId),
    index("leads_customer_idx").on(t.organizationId, t.customerId),
    index("leads_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
    foreignKey({ name: "leads_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    // Stage must belong to the lead's pipeline (and org).
    foreignKey({ name: "leads_stage_fk", columns: [t.organizationId, t.pipelineId, t.stageId], foreignColumns: [pipelineStages.organizationId, pipelineStages.pipelineId, pipelineStages.id] }),
    check("leads_status_chk", sql`${t.status} in ('open','won','lost')`),
    check("leads_priority_chk", sql`${t.priority} in ('low','medium','high','urgent')`),
    check("leads_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("leads_probability_chk", sql`${t.probability} is null or ${t.probability} between 0 and 100`),
    check("leads_value_chk", sql`${t.valueAmount} is null or ${t.valueAmount} >= 0`),
    check("leads_closed_chk", sql`(${t.status} = 'open') = (${t.closedAt} is null)`),
  ],
);

export const leadStageHistory = pgTable(
  "lead_stage_history",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid("lead_id").notNull(),
    fromStageId: uuid("from_stage_id"),
    toStageId: uuid("to_stage_id").notNull(),
    changedByUserId: text("changed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("lead_stage_history_lead_idx").on(t.organizationId, t.leadId, t.createdAt),
    foreignKey({ name: "lead_stage_history_lead_fk", columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }).onDelete("cascade"),
    foreignKey({ name: "lead_stage_history_to_fk", columns: [t.organizationId, t.toStageId], foreignColumns: [pipelineStages.organizationId, pipelineStages.id] }),
    foreignKey({ name: "lead_stage_history_from_fk", columns: [t.organizationId, t.fromStageId], foreignColumns: [pipelineStages.organizationId, pipelineStages.id] }),
  ],
);

/** Interested products. product_id links to the catalog once Products ships (Phase 4). */
export const leadProducts = pgTable(
  "lead_products",
  {
    id: id(),
    organizationId: organizationId(),
    leadId: uuid("lead_id").notNull(),
    productId: uuid("product_id"),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index("lead_products_lead_idx").on(t.organizationId, t.leadId),
    foreignKey({ name: "lead_products_lead_fk", columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }).onDelete("cascade"),
    check("lead_products_qty_chk", sql`${t.quantity} > 0`),
  ],
);
