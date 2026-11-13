import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { memberships, organizations } from "@/domains/identity/schema";
import { customers } from "@/domains/customers/schema";
import { leads } from "@/domains/sales/schema";
import { orders } from "@/domains/commerce/schema";
import { supportTickets } from "@/domains/support/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

export interface PhoneSettings {
  allowedCountries: string[];
  blockPremium: boolean;
  dailySpendLimitCents: number | null;
  ringTimeoutSec: number;
  voicemailGreeting: string;
  afterHours: "voicemail" | "ring";
  useBusinessHours: boolean;
}
export const DEFAULT_PHONE_SETTINGS: PhoneSettings = {
  allowedCountries: ["US", "CA"], blockPremium: true, dailySpendLimitCents: 2000, ringTimeoutSec: 20,
  voicemailGreeting: "Sorry we missed your call. Please leave a message after the tone and we'll call you back.", afterHours: "voicemail", useBusinessHours: true,
};

/** One provider subaccount per workspace. Credentials (subaccount token, API key, TwiML app) are encrypted. */
export const telecomAccounts = pgTable(
  "telecom_accounts",
  {
    id: id(),
    organizationId: organizationId(),
    provider: text("provider").notNull().default("twilio"),
    providerAccountSid: text("provider_account_sid").notNull(),
    credentials: text("credentials").notNull(),
    status: text("status").notNull().default("active"),
    settings: jsonb("settings").$type<PhoneSettings>().notNull(),
    lastError: text("last_error"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("telecom_accounts_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("telecom_accounts_org_uq").on(t.organizationId).where(sql`${t.status} <> 'closed'`),
    uniqueIndex("telecom_accounts_sid_uq").on(t.provider, t.providerAccountSid),
    orgFk("telecom_accounts_org_fk", t),
    check("telecom_accounts_status_chk", sql`${t.status} in ('active','suspended','error','closed')`),
  ],
);

export interface NumberRouting { type: "queue" | "agent" | "voicemail"; queueId?: string | null; membershipId?: string | null }

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: id(),
    organizationId: organizationId(),
    accountId: uuid("account_id").notNull(),
    providerSid: text("provider_sid").notNull(),
    e164: text("e164").notNull(),
    label: text("label"),
    locality: text("locality"),
    region: text("region"),
    capabilities: jsonb("capabilities").$type<{ voice: boolean; sms: boolean; mms: boolean }>().notNull(),
    routing: jsonb("routing").$type<NumberRouting>().notNull().default({ type: "voicemail" }),
    status: text("status").notNull().default("active"),
    releasedAt: tsz("released_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("phone_numbers_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("phone_numbers_sid_uq").on(t.providerSid),
    uniqueIndex("phone_numbers_active_e164_uq").on(t.e164).where(sql`${t.status} = 'active'`),
    foreignKey({ name: "phone_numbers_account_fk", columns: [t.organizationId, t.accountId], foreignColumns: [telecomAccounts.organizationId, telecomAccounts.id] }),
    check("phone_numbers_status_chk", sql`${t.status} in ('active','released')`),
  ],
);

export const AGENT_STATUSES = ["available", "busy", "away", "offline", "dnd"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Per-member phone presence. Calls only ring agents who are available and not already on a call. */
export const phoneAgents = pgTable(
  "phone_agents",
  {
    organizationId: organizationId(),
    membershipId: uuid("membership_id").notNull(),
    status: text("status").$type<AgentStatus>().notNull().default("offline"),
    activeCallId: uuid("active_call_id"),
    lastSeenAt: tsz("last_seen_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "phone_agents_pk", columns: [t.organizationId, t.membershipId] }),
    foreignKey({ name: "phone_agents_member_fk", columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete("cascade"),
    check("phone_agents_status_chk", sql`${t.status} in ('available','busy','away','offline','dnd')`),
  ],
);

export const phoneQueues = pgTable(
  "phone_queues",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    strategy: text("strategy").notNull().default("simultaneous"),
    ringTimeoutSec: integer("ring_timeout_sec").notNull().default(20),
    fallback: text("fallback").notNull().default("voicemail"),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("phone_queues_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("phone_queues_name_uq").on(t.organizationId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    orgFk("phone_queues_org_fk", t),
    check("phone_queues_strategy_chk", sql`${t.strategy} in ('simultaneous','round_robin')`),
    check("phone_queues_fallback_chk", sql`${t.fallback} in ('voicemail','hangup')`),
    check("phone_queues_timeout_chk", sql`${t.ringTimeoutSec} between 5 and 120`),
  ],
);

export const phoneQueueMembers = pgTable(
  "phone_queue_members",
  {
    organizationId: organizationId(),
    queueId: uuid("queue_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    position: integer("position").notNull().default(0),
    lastOfferedAt: tsz("last_offered_at"),
  },
  (t) => [
    primaryKey({ name: "phone_queue_members_pk", columns: [t.queueId, t.membershipId] }),
    foreignKey({ name: "phone_queue_members_queue_fk", columns: [t.organizationId, t.queueId], foreignColumns: [phoneQueues.organizationId, phoneQueues.id] }).onDelete("cascade"),
    foreignKey({ name: "phone_queue_members_member_fk", columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete("cascade"),
  ],
);

export const CALL_STATUSES = ["queued", "ringing", "in_progress", "completed", "busy", "no_answer", "failed", "canceled"] as const;

/**
 * The customer interaction. Individual provider calls (the PSTN side, each agent the call rang) are
 * call_legs; every provider callback is a call_event with a unique idempotency key.
 */
export const calls = pgTable(
  "calls",
  {
    id: id(),
    organizationId: organizationId(),
    number: integer("number").notNull(),
    accountId: uuid("account_id").notNull(),
    direction: text("direction").notNull(),
    providerCallSid: text("provider_call_sid").notNull(),
    fromE164: text("from_e164").notNull(),
    toE164: text("to_e164").notNull(),
    businessNumberId: uuid("business_number_id"),
    customerId: uuid("customer_id"),
    agentMembershipId: uuid("agent_membership_id"),
    queueId: uuid("queue_id"),
    status: text("status").notNull().default("queued"),
    outcome: text("outcome"),
    startedAt: tsz("started_at").notNull().defaultNow(),
    answeredAt: tsz("answered_at"),
    endedAt: tsz("ended_at"),
    durationSec: integer("duration_sec"),
    priceMicros: integer("price_micros"),
    priceCurrency: text("price_currency"),
    leadId: uuid("lead_id"),
    orderId: uuid("order_id"),
    ticketId: uuid("ticket_id"),
    hadVoicemail: integer("had_voicemail").notNull().default(0),
    lastEventAt: tsz("last_event_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("calls_org_id_uq").on(t.organizationId, t.id),
    unique("calls_number_uq").on(t.organizationId, t.number),
    uniqueIndex("calls_provider_uq").on(t.accountId, t.providerCallSid),
    index("calls_recent_idx").on(t.organizationId, t.startedAt),
    index("calls_customer_idx").on(t.organizationId, t.customerId),
    index("calls_agent_idx").on(t.organizationId, t.agentMembershipId),
    foreignKey({ name: "calls_account_fk", columns: [t.organizationId, t.accountId], foreignColumns: [telecomAccounts.organizationId, telecomAccounts.id] }),
    foreignKey({ name: "calls_number_fk", columns: [t.organizationId, t.businessNumberId], foreignColumns: [phoneNumbers.organizationId, phoneNumbers.id] }),
    foreignKey({ name: "calls_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "calls_agent_fk", columns: [t.organizationId, t.agentMembershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    foreignKey({ name: "calls_queue_fk", columns: [t.organizationId, t.queueId], foreignColumns: [phoneQueues.organizationId, phoneQueues.id] }),
    foreignKey({ name: "calls_lead_fk", columns: [t.organizationId, t.leadId], foreignColumns: [leads.organizationId, leads.id] }),
    foreignKey({ name: "calls_order_fk", columns: [t.organizationId, t.orderId], foreignColumns: [orders.organizationId, orders.id] }),
    foreignKey({ name: "calls_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }),
    check("calls_direction_chk", sql`${t.direction} in ('inbound','outbound')`),
    check("calls_status_chk", sql`${t.status} in ('queued','ringing','in_progress','completed','busy','no_answer','failed','canceled')`),
  ],
);

export const callLegs = pgTable(
  "call_legs",
  {
    id: id(),
    organizationId: organizationId(),
    callId: uuid("call_id").notNull(),
    providerCallSid: text("provider_call_sid").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    membershipId: uuid("membership_id"),
    status: text("status").notNull().default("queued"),
    lastSequence: integer("last_sequence").notNull().default(-1),
    answeredAt: tsz("answered_at"),
    endedAt: tsz("ended_at"),
    durationSec: integer("duration_sec"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("call_legs_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("call_legs_sid_uq").on(t.callId, t.providerCallSid),
    foreignKey({ name: "call_legs_call_fk", columns: [t.organizationId, t.callId], foreignColumns: [calls.organizationId, calls.id] }).onDelete("cascade"),
    check("call_legs_kind_chk", sql`${t.kind} in ('customer','agent','pstn')`),
  ],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: id(),
    organizationId: organizationId(),
    callId: uuid("call_id").notNull(),
    eventKey: text("event_key").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    occurredAt: tsz("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("call_events_key_uq").on(t.organizationId, t.eventKey),
    index("call_events_call_idx").on(t.organizationId, t.callId, t.occurredAt),
    foreignKey({ name: "call_events_call_fk", columns: [t.organizationId, t.callId], foreignColumns: [calls.organizationId, calls.id] }).onDelete("cascade"),
  ],
);

export const callNotes = pgTable(
  "call_notes",
  {
    id: id(),
    organizationId: organizationId(),
    callId: uuid("call_id").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("call_notes_org_id_uq").on(t.organizationId, t.id),
    index("call_notes_call_idx").on(t.organizationId, t.callId),
    foreignKey({ name: "call_notes_call_fk", columns: [t.organizationId, t.callId], foreignColumns: [calls.organizationId, calls.id] }).onDelete("cascade"),
    check("call_notes_body_chk", sql`length(${t.body}) between 1 and 5000`),
  ],
);

export const callVoicemails = pgTable(
  "call_voicemails",
  {
    id: id(),
    organizationId: organizationId(),
    callId: uuid("call_id").notNull(),
    recordingSid: text("recording_sid").notNull(),
    durationSec: integer("duration_sec"),
    status: text("status").notNull().default("new"),
    assignedMembershipId: uuid("assigned_membership_id"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: tsz("reviewed_at"),
    deletedAt: tsz("deleted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("call_voicemails_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("call_voicemails_sid_uq").on(t.recordingSid),
    index("call_voicemails_status_idx").on(t.organizationId, t.status, t.createdAt),
    foreignKey({ name: "call_voicemails_call_fk", columns: [t.organizationId, t.callId], foreignColumns: [calls.organizationId, calls.id] }).onDelete("cascade"),
    foreignKey({ name: "call_voicemails_assignee_fk", columns: [t.organizationId, t.assignedMembershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    check("call_voicemails_status_chk", sql`${t.status} in ('new','reviewed','archived')`),
  ],
);

/** Provider-reported cost per call leg (micros of the currency), fetched after the call completes. */
export const phoneUsageRecords = pgTable(
  "phone_usage_records",
  {
    id: id(),
    organizationId: organizationId(),
    callId: uuid("call_id"),
    providerSid: text("provider_sid").notNull(),
    category: text("category").notNull(),
    priceMicros: integer("price_micros").notNull(),
    currency: text("currency").notNull(),
    recordedAt: tsz("recorded_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("phone_usage_records_sid_uq").on(t.organizationId, t.providerSid),
    index("phone_usage_records_day_idx").on(t.organizationId, t.recordedAt),
    orgFk("phone_usage_records_org_fk", t),
  ],
);
