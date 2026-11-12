import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    businessType: text("business_type"),
    timezone: text("timezone").notNull().default("UTC"),
    defaultCurrency: text("default_currency").notNull().default("USD"),
    address: text("address"),
    logoKey: text("logo_key"),
    status: text("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("organizations_status_chk", sql`${t.status} in ('active','suspended')`),
    check("organizations_currency_chk", sql`${t.defaultCurrency} ~ '^[A-Z]{3}$'`),
    check("organizations_slug_chk", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'`),
  ],
);

/** Global permission catalog — synced from src/server/authz/catalog.ts. */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: id(),
    organizationId: organizationId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("roles_org_id_uq").on(t.organizationId, t.id),
    unique("roles_org_key_uq").on(t.organizationId, t.key),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: organizationId(),
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }).onDelete("cascade"),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: organizationId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull(),
    status: text("status").notNull().default("active"),
    title: text("title"),
    joinedAt: createdAt(),
    deactivatedAt: tsz("deactivated_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("memberships_org_id_uq").on(t.organizationId, t.id),
    unique("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    check("memberships_status_chk", sql`${t.status} in ('active','deactivated')`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    organizationId: organizationId(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("teams_org_id_uq").on(t.organizationId, t.id),
    unique("teams_org_name_uq").on(t.organizationId, t.name),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    organizationId: organizationId(),
    teamId: uuid("team_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.membershipId] }),
    foreignKey({
      columns: [t.organizationId, t.teamId],
      foreignColumns: [teams.organizationId, teams.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
    }).onDelete("cascade"),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: organizationId(),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: tsz("expires_at").notNull(),
    acceptedAt: tsz("accepted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("invitations_org_id_uq").on(t.organizationId, t.id),
    index("invitations_org_email_idx").on(t.organizationId, t.email),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }).onDelete("cascade"),
    check("invitations_status_chk", sql`${t.status} in ('pending','accepted','revoked')`),
  ],
);

/** Per-org human-readable number sequences (ORD-1001, TCK-12 …). */
export const orgSequences = pgTable(
  "org_sequences",
  {
    organizationId: organizationId(),
    key: text("key").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.key] }),
    foreignKey({ columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade"),
  ],
);
