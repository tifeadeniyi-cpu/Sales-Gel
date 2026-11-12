import "server-only";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { memberships } from "@/domains/identity/schema";
import type { Permission } from "@/server/authz/catalog";
import { canReadRecord, type OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { customFieldDefinitions, customers, customerTags, tags } from "./schema";

export type CustomerRow = typeof customers.$inferSelect;

/** SQL predicate limiting customers to what the caller may read (all vs. owned). */
export function readScope(ctx: OrgContext): SQL | undefined {
  if (ctx.permissions.has("customers.read")) return undefined;
  if (ctx.permissions.has("customers.read_assigned")) return eq(customers.ownerMembershipId, ctx.membershipId);
  return sql`false`;
}

export function assertCanRead(ctx: OrgContext) {
  if (!ctx.permissions.has("customers.read") && !ctx.permissions.has("customers.read_assigned")) {
    throw new ForbiddenError(undefined, "customers.read");
  }
}

/** Loads a customer row-locked for writing, enforcing record-level read scope (hidden records are 404). */
export async function loadForWrite(tx: Tx, ctx: OrgContext, id: string, opts: { allowMerged?: boolean } = {}) {
  const [c] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, id)))
    .for("update");
  if (!c || !canReadRecord(ctx, "customers", { ownerMembershipId: c.ownerMembershipId })) {
    throw new NotFoundError("Customer not found.");
  }
  if (c.status === "merged" && !opts.allowMerged) {
    throw new ValidationError("This customer was merged into another record. Edit the surviving customer instead.");
  }
  return c;
}

export function requirePerm(ctx: OrgContext, ...perms: Permission[]) {
  for (const p of perms) if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
}

export async function assertMembershipInOrg(tx: Tx, ctx: OrgContext, membershipId: string | null | undefined) {
  if (!membershipId) return;
  const [m] = await tx
    .select({ id: memberships.id, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, membershipId)));
  if (!m || m.status !== "active") {
    throw new ValidationError("Choose an active team member.", { ownerMembershipId: ["Choose an active team member."] });
  }
}

/** Finds or creates tags by name (case-insensitive) and returns their ids. */
export async function ensureTags(tx: Tx, orgId: string, names: string[]): Promise<string[]> {
  const byKey = new Map<string, string>();
  for (const n of names) {
    const t = n.trim();
    if (t && !byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t);
  }
  const unique = [...byKey.values()];
  if (!unique.length) return [];
  await tx
    .insert(tags)
    .values(unique.map((name) => ({ organizationId: orgId, name })))
    .onConflictDoNothing();
  const rows = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.organizationId, orgId), inArray(sql`lower(${tags.name})`, unique.map((n) => n.toLowerCase()))));
  return rows.map((r) => r.id);
}

export async function setCustomerTags(tx: Tx, orgId: string, customerId: string, tagIds: string[]) {
  await tx.delete(customerTags).where(and(eq(customerTags.organizationId, orgId), eq(customerTags.customerId, customerId)));
  if (tagIds.length) {
    await tx.insert(customerTags).values(tagIds.map((tagId) => ({ organizationId: orgId, customerId, tagId }))).onConflictDoNothing();
  }
}

/** Validates custom field values against active definitions; returns the cleaned object. */
export async function validateCustomFields(
  tx: Tx,
  orgId: string,
  values: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const defs = await tx
    .select()
    .from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.organizationId, orgId), eq(customFieldDefinitions.entity, "customer"), isNull(customFieldDefinitions.archivedAt)));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const def of defs) {
    const raw = values[def.key];
    const empty = raw === undefined || raw === null || raw === "";
    if (empty) {
      if (def.required && !opts.partial) errors[`customFields.${def.key}`] = [`${def.label} is required`];
      else if (raw !== undefined) out[def.key] = null;
      continue;
    }
    switch (def.type) {
      case "text":
        out[def.key] = String(raw).trim().slice(0, 1000);
        break;
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
        if (!Number.isFinite(n)) errors[`customFields.${def.key}`] = [`${def.label} must be a number`];
        else out[def.key] = n;
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || Number.isNaN(Date.parse(String(raw)))) {
          errors[`customFields.${def.key}`] = [`${def.label} must be a date (YYYY-MM-DD)`];
        } else out[def.key] = String(raw);
        break;
      case "select":
        if (!def.options?.includes(String(raw))) errors[`customFields.${def.key}`] = [`Choose a valid ${def.label}`];
        else out[def.key] = String(raw);
        break;
      case "boolean":
        out[def.key] = raw === true || raw === "true" || raw === "on" || raw === "yes";
        break;
    }
  }
  if (Object.keys(errors).length) throw new ValidationError("Please fix the custom fields.", errors);
  return out;
}
