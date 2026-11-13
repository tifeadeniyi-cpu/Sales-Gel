import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { orders } from "@/domains/commerce/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

export const PROVIDERS = ["stripe", "shopify"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * A workspace's connection to an external provider. Credentials are encrypted at rest
 * (AES-256-GCM, key from INTEGRATIONS_ENCRYPTION_KEY) and never returned to the browser.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    organizationId: organizationId(),
    provider: text("provider").$type<Provider>().notNull(),
    status: text("status").notNull().default("active"),
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name"),
    credentials: text("credentials").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: tsz("last_sync_at"),
    lastError: text("last_error"),
    connectedByUserId: text("connected_by_user_id").references(() => user.id, { onDelete: "set null" }),
    disconnectedAt: tsz("disconnected_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("integration_connections_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("integration_connections_active_uq").on(t.organizationId, t.provider).where(sql`${t.status} <> 'disconnected'`),
    orgFk("integration_connections_org_fk", t),
    check("integration_connections_provider_chk", sql`${t.provider} in ('stripe','shopify')`),
    check("integration_connections_status_chk", sql`${t.status} in ('active','error','disconnected')`),
  ],
);

/**
 * Routing only (no tenant data, no secrets): which workspace/connection a provider account
 * belongs to, so an unauthenticated webhook can be scoped before anything is read.
 */
export const integrationRoutes = pgTable(
  "integration_routes",
  {
    provider: text("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ name: "integration_routes_pk", columns: [t.provider, t.externalAccountId] }), uniqueIndex("integration_routes_connection_uq").on(t.connectionId)],
);

/** Every inbound webhook delivery, verified and de-duplicated before processing. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid("connection_id").notNull(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    topic: text("topic").notNull(),
    signatureVerified: boolean("signature_verified").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: createdAt(),
    processedAt: tsz("processed_at"),
  },
  (t) => [
    unique("webhook_events_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("webhook_events_dedupe_uq").on(t.connectionId, t.providerEventId),
    index("webhook_events_status_idx").on(t.organizationId, t.status, t.receivedAt),
    orgFk("webhook_events_org_fk", t),
    foreignKey({ name: "webhook_events_connection_fk", columns: [t.organizationId, t.connectionId], foreignColumns: [integrationConnections.organizationId, integrationConnections.id] }).onDelete("cascade"),
    check("webhook_events_status_chk", sql`${t.status} in ('received','processed','ignored','failed')`),
  ],
);

/** Links an external record (Shopify order, customer…) to the SalesGel record it became. */
export const externalRecordMappings = pgTable(
  "external_record_mappings",
  {
    id: id(),
    organizationId: organizationId(),
    connectionId: uuid("connection_id").notNull(),
    externalType: text("external_type").notNull(),
    externalId: text("external_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalUpdatedAt: tsz("external_updated_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("external_record_mappings_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("external_record_mappings_uq").on(t.connectionId, t.externalType, t.externalId),
    index("external_record_mappings_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    foreignKey({ name: "external_record_mappings_connection_fk", columns: [t.organizationId, t.connectionId], foreignColumns: [integrationConnections.organizationId, integrationConnections.id] }).onDelete("cascade"),
  ],
);

/** Hosted payment pages (Stripe Checkout) sent to customers for an order's balance. */
export const paymentLinks = pgTable(
  "payment_links",
  {
    id: id(),
    organizationId: organizationId(),
    orderId: uuid("order_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    url: text("url").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("open"),
    expiresAt: tsz("expires_at"),
    paidAt: tsz("paid_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("payment_links_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("payment_links_session_uq").on(t.provider, t.providerSessionId),
    index("payment_links_order_idx").on(t.organizationId, t.orderId),
    foreignKey({ name: "payment_links_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }).onDelete("cascade"),
    foreignKey({ name: "payment_links_connection_fk", columns: [t.organizationId, t.connectionId], foreignColumns: [integrationConnections.organizationId, integrationConnections.id] }),
    check("payment_links_status_chk", sql`${t.status} in ('open','paid','expired','failed','cancelled')`),
    check("payment_links_amount_chk", sql`${t.amount} > 0`),
  ],
);

/** Durable background jobs (sync, webhook processing, reminders). Retries with backoff. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    organizationId: organizationId(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: tsz("run_at").notNull().defaultNow(),
    lockedUntil: tsz("locked_until"),
    idempotencyKey: text("idempotency_key"),
    lastError: text("last_error"),
    finishedAt: tsz("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("jobs_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("jobs_idempotency_uq").on(t.organizationId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
    index("jobs_due_idx").on(t.organizationId, t.status, t.runAt),
    orgFk("jobs_org_fk", t),
    check("jobs_status_chk", sql`${t.status} in ('pending','running','done','failed')`),
  ],
);

/**
 * Work index (no tenant data): the earliest time each workspace has due background work.
 * Maintained by triggers on jobs/outbox inserts so the worker can find work without
 * reading across tenants.
 */
export const orgWorkSignals = pgTable("org_work_signals", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  dueAt: tsz("due_at").notNull(),
});
