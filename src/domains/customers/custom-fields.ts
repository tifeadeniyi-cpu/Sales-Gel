import "server-only";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { isUniqueViolation } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { requirePerm } from "./internal";
import { customFieldDefinitions } from "./schema";
import { customFieldSchema } from "./validation";

export async function listCustomFields(ctx: OrgContext, opts: { includeArchived?: boolean } = {}) {
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.organizationId, ctx.orgId),
          eq(customFieldDefinitions.entity, "customer"),
          opts.includeArchived ? undefined : isNull(customFieldDefinitions.archivedAt),
        ),
      )
      .orderBy(asc(customFieldDefinitions.position), asc(customFieldDefinitions.createdAt)),
  );
}
export type CustomFieldDef = Awaited<ReturnType<typeof listCustomFields>>[number];

export async function createCustomField(ctx: OrgContext, input: { label: string; key: string; type: string; options?: string[]; required?: boolean }) {
  requirePerm(ctx, "org.settings.manage");
  const data = parseInput(customFieldSchema, input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [{ pos }] = await tx.select({ pos: max(customFieldDefinitions.position) }).from(customFieldDefinitions).where(eq(customFieldDefinitions.organizationId, ctx.orgId));
      const [row] = await tx
        .insert(customFieldDefinitions)
        .values({ organizationId: ctx.orgId, entity: "customer", key: data.key, label: data.label, type: data.type, options: data.type === "select" ? data.options : null, required: data.required, position: (pos ?? 0) + 1 })
        .returning();
      await audit(tx, ctx, { action: "custom_field.created", entityType: "custom_field", entityId: row.id, metadata: { key: data.key, type: data.type } });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Key taken.", { key: ["A field with this key already exists (including archived fields)."] });
    throw err;
  }
}

/** Key and type are immutable once created, so stored values never change meaning. */
export async function updateCustomField(ctx: OrgContext, id: string, input: { label?: string; options?: string[]; required?: boolean }) {
  requirePerm(ctx, "org.settings.manage");
  return withTenant(ctx, async (tx) => {
    const [def] = await tx.select().from(customFieldDefinitions).where(and(eq(customFieldDefinitions.organizationId, ctx.orgId), eq(customFieldDefinitions.id, id)));
    if (!def) throw new NotFoundError("Field not found.");
    const data = parseInput(customFieldSchema, { label: input.label ?? def.label, key: def.key, type: def.type, options: input.options ?? def.options ?? undefined, required: input.required ?? def.required });
    await tx.update(customFieldDefinitions).set({ label: data.label, options: def.type === "select" ? data.options : null, required: data.required }).where(eq(customFieldDefinitions.id, id));
    await audit(tx, ctx, { action: "custom_field.updated", entityType: "custom_field", entityId: id, metadata: { label: data.label, required: data.required } });
  });
}

/** Archiving hides the field from forms; stored values are kept on customer records. */
export async function setCustomFieldArchived(ctx: OrgContext, id: string, archived: boolean) {
  requirePerm(ctx, "org.settings.manage");
  return withTenant(ctx, async (tx) => {
    const [def] = await tx
      .update(customFieldDefinitions)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(customFieldDefinitions.organizationId, ctx.orgId), eq(customFieldDefinitions.id, id)))
      .returning();
    if (!def) throw new NotFoundError("Field not found.");
    await audit(tx, ctx, { action: archived ? "custom_field.archived" : "custom_field.restored", entityType: "custom_field", entityId: id, metadata: { key: def.key } });
  });
}
