import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "@/domains/identity/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

/**
 * Canonical customer record. One per real relationship; duplicates are merged, never deleted.
 * owner_membership_id → memberships uses ON DELETE SET NULL (owner_membership_id), declared in
 * migration 0003 because drizzle-kit can't express column-list SET NULL on composite FKs.
 */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    organizationId: organizationId(),
    number: bigint("number", { mode: "number" }).notNull(),
    type: text("type").notNull().default("person"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name").notNull(),
    companyName: text("company_name"),
    source: text("source"),
    ownerMembershipId: uuid("owner_membership_id"),
    preferredChannel: text("preferred_channel"),
    preferredCurrency: text("preferred_currency"),
    emailMarketing: text("email_marketing").notNull().default("unknown"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    mergedIntoId: uuid("merged_into_id"),
    archivedAt: tsz("archived_at"),
    lastActivityAt: tsz("last_activity_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_org_id_uq").on(t.organizationId, t.id),
    unique("customers_org_number_uq").on(t.organizationId, t.number),
    index("customers_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("customers_org_owner_idx").on(t.organizationId, t.ownerMembershipId),
    index("customers_org_status_idx").on(t.organizationId, t.status),
    index("customers_display_name_trgm").using("gin", sql`${t.displayName} gin_trgm_ops`),
    index("customers_company_trgm").using("gin", sql`${t.companyName} gin_trgm_ops`),
    foreignKey({ name: "customers_org_fk", columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({ name: "customers_merged_into_fk", columns: [t.organizationId, t.mergedIntoId], foreignColumns: [t.organizationId, t.id] }),
    check("customers_type_chk", sql`${t.type} in ('person','business')`),
    check("customers_status_chk", sql`${t.status} in ('provisional','active','archived','merged')`),
    check("customers_email_marketing_chk", sql`${t.emailMarketing} in ('unknown','subscribed','unsubscribed')`),
    check("customers_currency_chk", sql`${t.preferredCurrency} is null or ${t.preferredCurrency} ~ '^[A-Z]{3}$'`),
    check("customers_merged_chk", sql`(${t.status} = 'merged') = (${t.mergedIntoId} is not null)`),
  ],
);

const customerFk = (name: string, t: { organizationId: AnyPgColumn; customerId: AnyPgColumn }) =>
  foreignKey({ name: `${name}_customer_fk`, columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }).onDelete("cascade");

export const customerEmails = pgTable(
  "customer_emails",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customer_emails_org_id_uq").on(t.organizationId, t.id),
    unique("customer_emails_customer_email_uq").on(t.customerId, t.normalizedEmail),
    index("customer_emails_lookup_idx").on(t.organizationId, t.normalizedEmail),
    index("customer_emails_trgm").using("gin", sql`${t.normalizedEmail} gin_trgm_ops`),
    customerFk("customer_emails", t),
  ],
);

export const customerPhones = pgTable(
  "customer_phones",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    phone: text("phone").notNull(),
    e164: text("e164").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customer_phones_org_id_uq").on(t.organizationId, t.id),
    unique("customer_phones_customer_phone_uq").on(t.customerId, t.e164),
    index("customer_phones_lookup_idx").on(t.organizationId, t.e164),
    customerFk("customer_phones", t),
  ],
);

/** Social / messaging identities (Instagram handle, WhatsApp number, external platform ids). */
export const customerIdentities = pgTable(
  "customer_identities",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    provider: text("provider").notNull(),
    handle: text("handle"),
    normalizedHandle: text("normalized_handle"),
    externalId: text("external_id"),
    providerAccountId: text("provider_account_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customer_identities_org_id_uq").on(t.organizationId, t.id),
    index("customer_identities_lookup_idx").on(t.organizationId, t.provider, t.normalizedHandle),
    uniqueIndex("customer_identities_external_uq")
      .on(t.organizationId, t.provider, t.providerAccountId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    customerFk("customer_identities", t),
    check("customer_identities_provider_chk", sql`${t.provider} in ('instagram','facebook','whatsapp','tiktok','x','shopify','other')`),
    check("customer_identities_value_chk", sql`${t.handle} is not null or ${t.externalId} is not null`),
  ],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_addresses_org_id_uq").on(t.organizationId, t.id),
    index("customer_addresses_customer_idx").on(t.organizationId, t.customerId),
    customerFk("customer_addresses", t),
    check("customer_addresses_kind_chk", sql`${t.kind} in ('billing','shipping')`),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    color: text("color").notNull().default("teal"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tags_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("tags_org_name_uq").on(t.organizationId, sql`lower(${t.name})`),
    foreignKey({ name: "tags_org_fk", columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const customerTags = pgTable(
  "customer_tags",
  {
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.tagId] }),
    index("customer_tags_tag_idx").on(t.organizationId, t.tagId),
    customerFk("customer_tags", t),
    foreignKey({ name: "customer_tags_tag_fk", columns: [t.organizationId, t.tagId], foreignColumns: [tags.organizationId, tags.id] }).onDelete("cascade"),
  ],
);

/** Append-only consent history; customers.email_marketing mirrors the latest email consent. */
export const customerConsents = pgTable(
  "customer_consents",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    note: text("note"),
    recordedByUserId: text("recorded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("customer_consents_customer_idx").on(t.organizationId, t.customerId, t.createdAt.desc()),
    customerFk("customer_consents", t),
    check("customer_consents_channel_chk", sql`${t.channel} in ('email','sms','whatsapp')`),
    check("customer_consents_status_chk", sql`${t.status} in ('granted','revoked')`),
  ],
);

export const customerNotes = pgTable(
  "customer_notes",
  {
    id: id(),
    organizationId: organizationId(),
    customerId: uuid("customer_id").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customer_notes_org_id_uq").on(t.organizationId, t.id),
    index("customer_notes_customer_idx").on(t.organizationId, t.customerId, t.createdAt.desc()),
    customerFk("customer_notes", t),
  ],
);

/** Reconciliation trail: everything a merge moved or filled, so it can be reverted. */
export const customerMerges = pgTable(
  "customer_merges",
  {
    id: id(),
    organizationId: organizationId(),
    survivorId: uuid("survivor_id").notNull(),
    mergedId: uuid("merged_id").notNull(),
    snapshot: jsonb("snapshot").$type<MergeSnapshot>().notNull(),
    mergedByUserId: text("merged_by_user_id").references(() => user.id, { onDelete: "set null" }),
    revertedAt: tsz("reverted_at"),
    revertedByUserId: text("reverted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("customer_merges_org_id_uq").on(t.organizationId, t.id),
    index("customer_merges_survivor_idx").on(t.organizationId, t.survivorId),
    foreignKey({ name: "customer_merges_survivor_fk", columns: [t.organizationId, t.survivorId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "customer_merges_merged_fk", columns: [t.organizationId, t.mergedId], foreignColumns: [customers.organizationId, customers.id] }),
  ],
);

export interface MergeSnapshot {
  moved: Record<string, string[]>;
  filledFields: Record<string, unknown>;
  survivorTagsAdded: string[];
  mergedPrevStatus: string;
}

export const customerDuplicateDismissals = pgTable(
  "customer_duplicate_dismissals",
  {
    organizationId: organizationId(),
    customerAId: uuid("customer_a_id").notNull(),
    customerBId: uuid("customer_b_id").notNull(),
    dismissedByUserId: text("dismissed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.customerAId, t.customerBId] }),
    foreignKey({ name: "customer_dup_a_fk", columns: [t.organizationId, t.customerAId], foreignColumns: [customers.organizationId, customers.id] }).onDelete("cascade"),
    foreignKey({ name: "customer_dup_b_fk", columns: [t.organizationId, t.customerBId], foreignColumns: [customers.organizationId, customers.id] }).onDelete("cascade"),
    check("customer_dup_order_chk", sql`${t.customerAId} < ${t.customerBId}`),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    organizationId: organizationId(),
    entity: text("entity").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    options: jsonb("options").$type<string[]>(),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("custom_fields_org_id_uq").on(t.organizationId, t.id),
    unique("custom_fields_key_uq").on(t.organizationId, t.entity, t.key),
    foreignKey({ name: "custom_fields_org_fk", columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    check("custom_fields_entity_chk", sql`${t.entity} in ('customer','lead','order','ticket')`),
    check("custom_fields_type_chk", sql`${t.type} in ('text','number','date','select','boolean')`),
    check("custom_fields_key_chk", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
  ],
);
