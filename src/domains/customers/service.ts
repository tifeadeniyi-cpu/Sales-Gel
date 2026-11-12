import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { memberships } from "@/domains/identity/schema";
import { auditLogs } from "@/domains/platform/schema";
import { notify } from "@/domains/platform/notifications";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import { canReadRecord, type OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { nextNumber } from "@/server/db/sequences";
import { withTenant } from "@/server/db/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import {
  assertCanRead,
  assertMembershipInOrg,
  ensureTags,
  loadForWrite,
  readScope,
  requirePerm,
  setCustomerTags,
  validateCustomFields,
} from "./internal";
import { deriveDisplayName, normalizeEmail, normalizeHandle, normalizePhone } from "./normalize";
import {
  customerAddresses,
  customerConsents,
  customerEmails,
  customerIdentities,
  customerMerges,
  customerNotes,
  customerPhones,
  customers,
  customerTags,
  tags,
} from "./schema";
import {
  consentSchema,
  customerInputSchema,
  inlineValueSchemas,
  INLINE_FIELDS,
  listFiltersSchema,
  noteSchema,
  tagSchema,
  type CustomerInput,
  type CustomerListFilters,
  type InlineField,
} from "./validation";

type ParsedInput = ReturnType<typeof customerInputSchema.parse>;

/* ───────────────────────── Write helpers ───────────────────────── */

async function writeChildren(tx: Tx, orgId: string, customerId: string, data: ParsedInput) {
  const emails = dedupe(
    data.emails.map((e) => ({ ...e, normalizedEmail: normalizeEmail(e.email) })),
    (e) => e.normalizedEmail,
  );
  const phonesNorm: { phone: string; e164: string; label: string | null; isPrimary?: boolean }[] = [];
  for (const [i, p] of data.phones.entries()) {
    const e164 = normalizePhone(p.phone);
    if (!e164) throw new ValidationError("Invalid phone number.", { [`phones.${i}.phone`]: ["Enter a valid phone number"] });
    phonesNorm.push({ ...p, e164 });
  }
  const phones = dedupe(phonesNorm, (p) => p.e164);
  const identities = dedupe(
    data.identities.map((i) => ({ ...i, normalizedHandle: normalizeHandle(i.handle) })),
    (i) => `${i.provider}:${i.normalizedHandle}`,
  );

  await tx.delete(customerEmails).where(and(eq(customerEmails.organizationId, orgId), eq(customerEmails.customerId, customerId)));
  await tx.delete(customerPhones).where(and(eq(customerPhones.organizationId, orgId), eq(customerPhones.customerId, customerId)));
  await tx.delete(customerIdentities).where(and(eq(customerIdentities.organizationId, orgId), eq(customerIdentities.customerId, customerId), isNull(customerIdentities.externalId)));
  await tx.delete(customerAddresses).where(and(eq(customerAddresses.organizationId, orgId), eq(customerAddresses.customerId, customerId)));

  const primaryIdx = <T extends { isPrimary?: boolean }>(arr: T[]) => Math.max(0, arr.findIndex((x) => x.isPrimary));
  if (emails.length) {
    const pi = primaryIdx(emails);
    await tx.insert(customerEmails).values(
      emails.map((e, i) => ({ organizationId: orgId, customerId, email: e.email, normalizedEmail: e.normalizedEmail, label: e.label, isPrimary: i === pi })),
    );
  }
  if (phones.length) {
    const pi = primaryIdx(phones);
    await tx.insert(customerPhones).values(phones.map((p, i) => ({ organizationId: orgId, customerId, phone: p.phone, e164: p.e164, label: p.label, isPrimary: i === pi })));
  }
  if (identities.length) {
    await tx.insert(customerIdentities).values(
      identities.map((i) => ({ organizationId: orgId, customerId, provider: i.provider, handle: i.handle.replace(/^@/, ""), normalizedHandle: i.normalizedHandle })),
    );
  }
  if (data.addresses.length) {
    const defaults = new Set<string>();
    await tx.insert(customerAddresses).values(
      data.addresses.map((a) => {
        const isDefault = !defaults.has(a.kind) && (a.isDefault ?? true);
        if (isDefault) defaults.add(a.kind);
        return { organizationId: orgId, customerId, ...a, isDefault };
      }),
    );
  }
  return { email: emails[0]?.email ?? null, phone: phones[0]?.phone ?? null, handle: identities[0]?.handle ?? null };
}

function dedupe<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

/* ───────────────────────── Create / update ───────────────────────── */

export async function createCustomer(ctx: OrgContext, input: CustomerInput, opts: { source?: string } = {}) {
  requirePerm(ctx, "customers.write");
  const data = parseInput(customerInputSchema, input);
  return withTenant(ctx, async (tx) => {
    // Reps who can only see their own customers own what they create, so they don't lose sight of it.
    const ownerMembershipId = ctx.permissions.has("customers.read") ? (data.ownerMembershipId ?? null) : ctx.membershipId;
    await assertMembershipInOrg(tx, ctx, ownerMembershipId);
    const customFields = await validateCustomFields(tx, ctx.orgId, data.customFields);
    const id = newId();
    const number = await nextNumber(tx, ctx.orgId, "customer");
    await tx.insert(customers).values({
      id,
      organizationId: ctx.orgId,
      number,
      type: data.type,
      firstName: data.firstName,
      lastName: data.lastName,
      companyName: data.companyName,
      displayName: "pending",
      source: data.source ?? null,
      ownerMembershipId,
      preferredChannel: data.preferredChannel ?? null,
      preferredCurrency: data.preferredCurrency ?? null,
      customFields,
      status: data.provisional ? "provisional" : "active",
      createdByUserId: ctx.userId,
      lastActivityAt: new Date(),
    });
    const primary = await writeChildren(tx, ctx.orgId, id, data);
    await tx.update(customers).set({ displayName: deriveDisplayName({ ...data, ...primary }) }).where(eq(customers.id, id));
    await setCustomerTags(tx, ctx.orgId, id, await ensureTags(tx, ctx.orgId, data.tagNames));
    await audit(tx, ctx, { action: "customer.created", entityType: "customer", entityId: id, metadata: { number, via: opts.source ?? "manual" } });
    await emit(tx, ctx.orgId, "customer.created", { customerId: id });
    if (ownerMembershipId && ownerMembershipId !== ctx.membershipId) await notifyOwner(tx, ctx, id, ownerMembershipId);
    return { id, number };
  });
}

export async function updateCustomer(ctx: OrgContext, id: string, input: CustomerInput) {
  requirePerm(ctx, "customers.write");
  const data = parseInput(customerInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const before = await loadForWrite(tx, ctx, id);
    const ownerMembershipId = ctx.permissions.has("customers.read") ? (data.ownerMembershipId ?? null) : before.ownerMembershipId;
    await assertMembershipInOrg(tx, ctx, ownerMembershipId);
    const customFields = await validateCustomFields(tx, ctx.orgId, data.customFields);
    const primary = await writeChildren(tx, ctx.orgId, id, data);
    const next = {
      type: data.type,
      firstName: data.firstName,
      lastName: data.lastName,
      companyName: data.companyName,
      source: data.source ?? null,
      ownerMembershipId,
      preferredChannel: data.preferredChannel ?? null,
      preferredCurrency: data.preferredCurrency ?? null,
      customFields,
      displayName: deriveDisplayName({ ...data, ...primary }),
      status: before.status === "archived" ? "archived" : data.provisional ? "provisional" : "active",
    };
    await tx.update(customers).set({ ...next, lastActivityAt: new Date() }).where(eq(customers.id, id));
    await setCustomerTags(tx, ctx.orgId, id, await ensureTags(tx, ctx.orgId, data.tagNames));
    await audit(tx, ctx, { action: "customer.updated", entityType: "customer", entityId: id, changes: diff(before, next) });
    if (ownerMembershipId && ownerMembershipId !== before.ownerMembershipId && ownerMembershipId !== ctx.membershipId) {
      await notifyOwner(tx, ctx, id, ownerMembershipId);
    }
    return { id };
  });
}

async function notifyOwner(tx: Tx, ctx: OrgContext, customerId: string, membershipId: string) {
  const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, membershipId));
  const [c] = await tx.select({ displayName: customers.displayName }).from(customers).where(eq(customers.id, customerId));
  if (m && c) {
    await notify(tx, {
      orgId: ctx.orgId,
      recipientUserId: m.userId,
      type: "customer.assigned",
      title: `You're now the owner of ${c.displayName}`,
      link: `/o/${ctx.orgSlug}/customers/${customerId}`,
      entityType: "customer",
      entityId: customerId,
    });
  }
}

/** Inline edit of a single field. Returns the persisted value so the UI shows what was actually saved. */
export async function updateCustomerField(ctx: OrgContext, id: string, field: string, value: unknown) {
  requirePerm(ctx, "customers.write");
  if (!(INLINE_FIELDS as readonly string[]).includes(field)) throw new ValidationError("This field can't be edited inline.");
  const f = field as InlineField;
  const parsed = inlineValueSchemas[f].safeParse(value === "" ? null : value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid value.", { [f]: parsed.error.issues.map((i) => i.message) });
  const v = parsed.data as never;
  return withTenant(ctx, async (tx) => {
    const before = await loadForWrite(tx, ctx, id);
    if (f === "ownerMembershipId") {
      if (!ctx.permissions.has("customers.read")) throw new ForbiddenError("You can only reassign customers if you can see all customers.");
      await assertMembershipInOrg(tx, ctx, v);
    }
    if (f === "status" && before.status === "archived") throw new ValidationError("Restore the customer before changing its status.");
    const patch: Record<string, unknown> = { [f]: v };
    if (["firstName", "lastName", "companyName", "type"].includes(f)) {
      const merged = { ...before, ...patch };
      if (merged.type === "business" && !merged.companyName) throw new ValidationError("Business customers need a company name.", { companyName: ["Business customers need a company name"] });
      const [email] = await tx.select({ email: customerEmails.email }).from(customerEmails).where(and(eq(customerEmails.customerId, id), eq(customerEmails.isPrimary, true)));
      const [phone] = await tx.select({ phone: customerPhones.phone }).from(customerPhones).where(and(eq(customerPhones.customerId, id), eq(customerPhones.isPrimary, true)));
      patch.displayName = deriveDisplayName({ ...merged, email: email?.email, phone: phone?.phone });
    }
    const [after] = await tx.update(customers).set({ ...patch, lastActivityAt: new Date() }).where(eq(customers.id, id)).returning();
    await audit(tx, ctx, { action: "customer.updated", entityType: "customer", entityId: id, changes: diff(before, patch) });
    if (f === "ownerMembershipId" && v && v !== before.ownerMembershipId && v !== ctx.membershipId) await notifyOwner(tx, ctx, id, v);
    return { value: after[f], displayName: after.displayName };
  });
}

export async function setCustomerArchived(ctx: OrgContext, id: string, archived: boolean) {
  requirePerm(ctx, "customers.archive");
  return withTenant(ctx, async (tx) => {
    const before = await loadForWrite(tx, ctx, id);
    if ((before.status === "archived") === archived) return;
    const status = archived ? "archived" : "active";
    await tx.update(customers).set({ status, archivedAt: archived ? new Date() : null }).where(eq(customers.id, id));
    await audit(tx, ctx, { action: archived ? "customer.archived" : "customer.restored", entityType: "customer", entityId: id, changes: { status: { from: before.status, to: status } } });
  });
}

export async function setCustomerTagNames(ctx: OrgContext, id: string, tagNames: string[]) {
  requirePerm(ctx, "customers.write");
  const names = tagNames.map((n) => parseInput(tagSchema, { name: n }).name);
  return withTenant(ctx, async (tx) => {
    await loadForWrite(tx, ctx, id);
    const before = (await tx.select({ name: tags.name }).from(customerTags).innerJoin(tags, eq(tags.id, customerTags.tagId)).where(eq(customerTags.customerId, id))).map((t) => t.name);
    await setCustomerTags(tx, ctx.orgId, id, await ensureTags(tx, ctx.orgId, names));
    await audit(tx, ctx, { action: "customer.tags_changed", entityType: "customer", entityId: id, changes: { tags: { from: before.sort(), to: [...names].sort() } } });
  });
}

/* ───────────────────────── Bulk ───────────────────────── */

const MAX_BULK = 500;

async function lockMany(tx: Tx, ctx: OrgContext, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new ValidationError("Select at least one customer.");
  if (unique.length > MAX_BULK) throw new ValidationError(`Select at most ${MAX_BULK} customers at a time.`);
  const rows = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, unique), ne(customers.status, "merged"), readScope(ctx)))
    .for("update");
  if (rows.length !== unique.length) throw new NotFoundError("Some selected customers no longer exist or aren't visible to you.");
  return rows;
}

export async function bulkUpdateCustomers(
  ctx: OrgContext,
  ids: string[],
  op: { kind: "assign"; ownerMembershipId: string | null } | { kind: "addTag"; tagName: string } | { kind: "removeTag"; tagId: string } | { kind: "archive" } | { kind: "restore" },
) {
  if (op.kind === "archive" || op.kind === "restore") requirePerm(ctx, "customers.archive");
  else requirePerm(ctx, "customers.write");
  if (op.kind === "assign") requirePerm(ctx, "customers.read");
  return withTenant(ctx, async (tx) => {
    const rows = await lockMany(tx, ctx, ids);
    const rowIds = rows.map((r) => r.id);
    switch (op.kind) {
      case "assign":
        await assertMembershipInOrg(tx, ctx, op.ownerMembershipId);
        await tx.update(customers).set({ ownerMembershipId: op.ownerMembershipId }).where(inArray(customers.id, rowIds));
        if (op.ownerMembershipId && op.ownerMembershipId !== ctx.membershipId) {
          const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, op.ownerMembershipId));
          if (m) await notify(tx, { orgId: ctx.orgId, recipientUserId: m.userId, type: "customer.assigned", title: `${rows.length} customer(s) assigned to you`, link: `/o/${ctx.orgSlug}/customers?owner=me` });
        }
        break;
      case "addTag": {
        const parsed = parseInput(tagSchema, { name: op.tagName });
        const [tagId] = await ensureTags(tx, ctx.orgId, [parsed.name]);
        await tx.insert(customerTags).values(rowIds.map((customerId) => ({ organizationId: ctx.orgId, customerId, tagId }))).onConflictDoNothing();
        break;
      }
      case "removeTag":
        await tx.delete(customerTags).where(and(eq(customerTags.organizationId, ctx.orgId), eq(customerTags.tagId, op.tagId), inArray(customerTags.customerId, rowIds)));
        break;
      case "archive":
        await tx.update(customers).set({ status: "archived", archivedAt: new Date() }).where(and(inArray(customers.id, rowIds), ne(customers.status, "archived")));
        break;
      case "restore":
        await tx.update(customers).set({ status: "active", archivedAt: null }).where(and(inArray(customers.id, rowIds), eq(customers.status, "archived")));
        break;
    }
    for (const id of rowIds) {
      await audit(tx, ctx, { action: `customer.bulk_${op.kind}`, entityType: "customer", entityId: id, metadata: { op, count: rowIds.length } });
    }
    return { count: rowIds.length };
  });
}

/* ───────────────────────── Reads ───────────────────────── */

function listWhere(ctx: OrgContext, f: ReturnType<typeof listFiltersSchema.parse>): SQL {
  const conds: (SQL | undefined)[] = [eq(customers.organizationId, ctx.orgId), readScope(ctx)];
  if (f.view === "active") conds.push(inArray(customers.status, ["active", "provisional"]));
  else if (f.view === "provisional") conds.push(eq(customers.status, "provisional"));
  else if (f.view === "archived") conds.push(eq(customers.status, "archived"));
  else conds.push(ne(customers.status, "merged"));
  if (f.owner === "me") conds.push(eq(customers.ownerMembershipId, ctx.membershipId));
  else if (f.owner === "unassigned") conds.push(isNull(customers.ownerMembershipId));
  else if (f.owner && /^[0-9a-f-]{36}$/i.test(f.owner)) conds.push(eq(customers.ownerMembershipId, f.owner));
  if (f.source) conds.push(eq(customers.source, f.source));
  if (f.type) conds.push(eq(customers.type, f.type));
  if (f.marketing) conds.push(eq(customers.emailMarketing, f.marketing));
  if (f.tag) {
    conds.push(sql`exists (select 1 from ${customerTags} where ${customerTags.customerId} = ${customers.id} and ${customerTags.tagId} = ${f.tag})`);
  }
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const digits = f.q.replace(/\D/g, "");
    const numberMatch = f.q.match(/^(?:cus-)?(\d+)$/i);
    conds.push(
      or(
        ilike(customers.displayName, like),
        ilike(customers.companyName, like),
        sql`exists (select 1 from ${customerEmails} where ${customerEmails.customerId} = ${customers.id} and ${customerEmails.normalizedEmail} ilike ${like})`,
        sql`exists (select 1 from ${customerIdentities} where ${customerIdentities.customerId} = ${customers.id} and ${customerIdentities.normalizedHandle} ilike ${`%${normalizeHandle(f.q)}%`})`,
        digits.length >= 4 ? sql`exists (select 1 from ${customerPhones} where ${customerPhones.customerId} = ${customers.id} and ${customerPhones.e164} like ${`%${digits}%`})` : undefined,
        numberMatch ? eq(customers.number, Number(numberMatch[1])) : undefined,
      ),
    );
  }
  return and(...conds)!;
}

const ORDER: Record<string, SQL[]> = {
  created_desc: [desc(customers.createdAt), desc(customers.id)],
  created_asc: [asc(customers.createdAt), asc(customers.id)],
  name_asc: [asc(sql`lower(${customers.displayName})`), asc(customers.id)],
  name_desc: [desc(sql`lower(${customers.displayName})`), desc(customers.id)],
  updated_desc: [desc(customers.updatedAt), desc(customers.id)],
  activity_desc: [sql`${customers.lastActivityAt} desc nulls last`, desc(customers.id)],
};

export async function listCustomers(ctx: OrgContext, filters: CustomerListFilters = {}) {
  assertCanRead(ctx);
  const f = parseInput(listFiltersSchema, filters);
  return withTenant(ctx, async (tx) => {
    const where = listWhere(ctx, f);
    const [{ total }] = await tx.select({ total: count() }).from(customers).where(where);
    const rows = await tx
      .select({
        id: customers.id,
        number: customers.number,
        type: customers.type,
        displayName: customers.displayName,
        firstName: customers.firstName,
        lastName: customers.lastName,
        companyName: customers.companyName,
        source: customers.source,
        status: customers.status,
        emailMarketing: customers.emailMarketing,
        ownerMembershipId: customers.ownerMembershipId,
        ownerName: user.name,
        createdAt: customers.createdAt,
        lastActivityAt: customers.lastActivityAt,
        primaryEmail: sql<string | null>`(select ${customerEmails.email} from ${customerEmails} where ${customerEmails.customerId} = ${customers.id} order by ${customerEmails.isPrimary} desc, ${customerEmails.createdAt} limit 1)`,
        primaryPhone: sql<string | null>`(select ${customerPhones.phone} from ${customerPhones} where ${customerPhones.customerId} = ${customers.id} order by ${customerPhones.isPrimary} desc, ${customerPhones.createdAt} limit 1)`,
      })
      .from(customers)
      .leftJoin(memberships, and(eq(memberships.organizationId, customers.organizationId), eq(memberships.id, customers.ownerMembershipId)))
      .leftJoin(user, eq(user.id, memberships.userId))
      .where(where)
      .orderBy(...ORDER[f.sort])
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize);
    const ids = rows.map((r) => r.id);
    const tagRows = ids.length
      ? await tx
          .select({ customerId: customerTags.customerId, id: tags.id, name: tags.name, color: tags.color })
          .from(customerTags)
          .innerJoin(tags, eq(tags.id, customerTags.tagId))
          .where(and(eq(customerTags.organizationId, ctx.orgId), inArray(customerTags.customerId, ids)))
          .orderBy(asc(tags.name))
      : [];
    return {
      rows: rows.map((r) => ({ ...r, tags: tagRows.filter((t) => t.customerId === r.id).map(({ id, name, color }) => ({ id, name, color })) })),
      total,
      page: f.page,
      pageSize: f.pageSize,
      pageCount: Math.max(1, Math.ceil(total / f.pageSize)),
      filters: f,
    };
  });
}

/** Ids in the current list order, for drawer Previous/Next. Capped to keep it cheap. */
export async function listCustomerIds(ctx: OrgContext, filters: CustomerListFilters = {}, limit = 2000) {
  assertCanRead(ctx);
  const f = parseInput(listFiltersSchema, filters);
  return withTenant(ctx, async (tx) =>
    (await tx.select({ id: customers.id }).from(customers).where(listWhere(ctx, f)).orderBy(...ORDER[f.sort]).limit(limit)).map((r) => r.id),
  );
}

export async function getCustomer(ctx: OrgContext, id: string) {
  assertCanRead(ctx);
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, id)));
    if (!c || !canReadRecord(ctx, "customers", { ownerMembershipId: c.ownerMembershipId })) return null;
    const [emails, phones, identities, addresses, tagRows, consents, owner, merges] = await Promise.all([
      tx.select().from(customerEmails).where(eq(customerEmails.customerId, id)).orderBy(desc(customerEmails.isPrimary), asc(customerEmails.createdAt)),
      tx.select().from(customerPhones).where(eq(customerPhones.customerId, id)).orderBy(desc(customerPhones.isPrimary), asc(customerPhones.createdAt)),
      tx.select().from(customerIdentities).where(eq(customerIdentities.customerId, id)).orderBy(asc(customerIdentities.createdAt)),
      tx.select().from(customerAddresses).where(eq(customerAddresses.customerId, id)).orderBy(asc(customerAddresses.kind), desc(customerAddresses.isDefault)),
      tx.select({ id: tags.id, name: tags.name, color: tags.color }).from(customerTags).innerJoin(tags, eq(tags.id, customerTags.tagId)).where(eq(customerTags.customerId, id)).orderBy(asc(tags.name)),
      tx
        .select({ id: customerConsents.id, channel: customerConsents.channel, status: customerConsents.status, source: customerConsents.source, note: customerConsents.note, createdAt: customerConsents.createdAt, recordedBy: user.name })
        .from(customerConsents)
        .leftJoin(user, eq(user.id, customerConsents.recordedByUserId))
        .where(eq(customerConsents.customerId, id))
        .orderBy(desc(customerConsents.createdAt)),
      c.ownerMembershipId
        ? tx.select({ membershipId: memberships.id, name: user.name, email: user.email }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.id, c.ownerMembershipId)).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      tx
        .select({ id: customerMerges.id, mergedId: customerMerges.mergedId, createdAt: customerMerges.createdAt, revertedAt: customerMerges.revertedAt, mergedName: customers.displayName, mergedNumber: customers.number })
        .from(customerMerges)
        .innerJoin(customers, eq(customers.id, customerMerges.mergedId))
        .where(eq(customerMerges.survivorId, id))
        .orderBy(desc(customerMerges.createdAt)),
    ]);
    return { ...c, emails, phones, identities, addresses, tags: tagRows, consents, owner, merges };
  });
}
export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** Customer timeline: audited events for this customer, newest first. */
export async function getCustomerTimeline(ctx: OrgContext, id: string, limit = 100) {
  const c = await getCustomer(ctx, id);
  if (!c) throw new NotFoundError("Customer not found.");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, changes: auditLogs.changes, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actorName: user.name })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "customer"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
  );
}

export async function searchCustomers(ctx: OrgContext, q: string, limit = 8) {
  if (!ctx.permissions.has("customers.read") && !ctx.permissions.has("customers.read_assigned")) return [];
  if (q.trim().length < 2) return [];
  const res = await listCustomers(ctx, { q, view: "all", pageSize: 25, sort: "name_asc" });
  return res.rows.slice(0, limit);
}

/* ───────────────────────── Notes ───────────────────────── */

export async function listNotes(ctx: OrgContext, customerId: string) {
  const c = await getCustomer(ctx, customerId);
  if (!c) throw new NotFoundError("Customer not found.");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: customerNotes.id, body: customerNotes.body, pinned: customerNotes.pinned, createdAt: customerNotes.createdAt, updatedAt: customerNotes.updatedAt, authorUserId: customerNotes.authorUserId, authorName: user.name })
      .from(customerNotes)
      .leftJoin(user, eq(user.id, customerNotes.authorUserId))
      .where(and(eq(customerNotes.organizationId, ctx.orgId), eq(customerNotes.customerId, customerId)))
      .orderBy(desc(customerNotes.pinned), desc(customerNotes.createdAt)),
  );
}

export async function addNote(ctx: OrgContext, customerId: string, input: { body: string }) {
  requirePerm(ctx, "customers.write");
  const { body } = parseInput(noteSchema, input);
  return withTenant(ctx, async (tx) => {
    await loadForWrite(tx, ctx, customerId);
    const id = newId();
    await tx.insert(customerNotes).values({ id, organizationId: ctx.orgId, customerId, authorUserId: ctx.userId, body });
    await tx.update(customers).set({ lastActivityAt: new Date() }).where(eq(customers.id, customerId));
    await audit(tx, ctx, { action: "customer.note_added", entityType: "customer", entityId: customerId, metadata: { noteId: id, preview: body.slice(0, 140) } });
    return { id };
  });
}

async function loadNote(tx: Tx, ctx: OrgContext, noteId: string) {
  const [n] = await tx.select().from(customerNotes).where(and(eq(customerNotes.organizationId, ctx.orgId), eq(customerNotes.id, noteId))).for("update");
  if (!n) throw new NotFoundError("Note not found.");
  await loadForWrite(tx, ctx, n.customerId);
  return n;
}

export async function updateNote(ctx: OrgContext, noteId: string, input: { body?: string; pinned?: boolean }) {
  requirePerm(ctx, "customers.write");
  return withTenant(ctx, async (tx) => {
    const n = await loadNote(tx, ctx, noteId);
    const patch: { body?: string; pinned?: boolean } = {};
    if (input.body !== undefined) {
      if (n.authorUserId !== ctx.userId) throw new ForbiddenError("Only the author can edit a note.");
      patch.body = parseInput(noteSchema, { body: input.body }).body;
    }
    if (input.pinned !== undefined) patch.pinned = input.pinned;
    await tx.update(customerNotes).set(patch).where(eq(customerNotes.id, n.id));
    await audit(tx, ctx, { action: input.body !== undefined ? "customer.note_edited" : input.pinned ? "customer.note_pinned" : "customer.note_unpinned", entityType: "customer", entityId: n.customerId, metadata: { noteId: n.id } });
  });
}

export async function deleteNote(ctx: OrgContext, noteId: string) {
  requirePerm(ctx, "customers.write");
  return withTenant(ctx, async (tx) => {
    const n = await loadNote(tx, ctx, noteId);
    if (n.authorUserId !== ctx.userId && !ctx.permissions.has("customers.archive")) {
      throw new ForbiddenError("Only the author or a manager can delete a note.");
    }
    await tx.delete(customerNotes).where(eq(customerNotes.id, n.id));
    await audit(tx, ctx, { action: "customer.note_deleted", entityType: "customer", entityId: n.customerId, metadata: { noteId: n.id, body: n.body } });
  });
}

/* ───────────────────────── Consent ───────────────────────── */

export async function recordConsent(ctx: OrgContext, customerId: string, input: { channel: string; status: string; source: string; note?: string }) {
  requirePerm(ctx, "customers.write");
  const data = parseInput(consentSchema, input);
  return withTenant(ctx, async (tx) => {
    await loadForWrite(tx, ctx, customerId);
    await tx.insert(customerConsents).values({ organizationId: ctx.orgId, customerId, channel: data.channel, status: data.status, source: data.source, note: data.note, recordedByUserId: ctx.userId });
    if (data.channel === "email") {
      await tx.update(customers).set({ emailMarketing: data.status === "granted" ? "subscribed" : "unsubscribed" }).where(eq(customers.id, customerId));
    }
    await audit(tx, ctx, { action: "customer.consent_recorded", entityType: "customer", entityId: customerId, metadata: data });
  });
}

/* ───────────────────────── Tags ───────────────────────── */

export async function listTags(ctx: OrgContext) {
  assertCanRead(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ id: tags.id, name: tags.name, color: tags.color, usage: sql<number>`(select count(*)::int from ${customerTags} where ${customerTags.tagId} = ${tags.id})` })
      .from(tags)
      .where(eq(tags.organizationId, ctx.orgId))
      .orderBy(asc(tags.name));
    return rows;
  });
}

export async function createTag(ctx: OrgContext, input: { name: string; color?: string }) {
  requirePerm(ctx, "customers.write");
  const data = parseInput(tagSchema, input);
  try {
    return await withTenant(ctx, async (tx) => {
      const [t] = await tx.insert(tags).values({ organizationId: ctx.orgId, name: data.name, color: data.color }).returning();
      await audit(tx, ctx, { action: "tag.created", entityType: "tag", entityId: t.id, metadata: { name: t.name } });
      return t;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ValidationError("Tag exists.", { name: ["A tag with this name already exists."] });
    throw err;
  }
}

export async function deleteTag(ctx: OrgContext, tagId: string) {
  requirePerm(ctx, "customers.write", "customers.read");
  return withTenant(ctx, async (tx) => {
    const [t] = await tx.delete(tags).where(and(eq(tags.organizationId, ctx.orgId), eq(tags.id, tagId))).returning();
    if (!t) throw new NotFoundError("Tag not found.");
    await audit(tx, ctx, { action: "tag.deleted", entityType: "tag", entityId: t.id, metadata: { name: t.name } });
  });
}

/* ───────────────────────── Overview metrics ───────────────────────── */

/** Commerce metrics (lifetime spend, orders, AOV) arrive with Orders in Phase 4. */
export async function getCustomerStats(ctx: OrgContext) {
  assertCanRead(ctx);
  return withTenant(ctx, async (tx) => {
    const scope = readScope(ctx);
    const base = and(eq(customers.organizationId, ctx.orgId), scope);
    const [row] = await tx
      .select({
        active: sql<number>`count(*) filter (where ${customers.status} in ('active','provisional'))::int`,
        provisional: sql<number>`count(*) filter (where ${customers.status} = 'provisional')::int`,
        new30: sql<number>`count(*) filter (where ${customers.status} in ('active','provisional') and ${customers.createdAt} > now() - interval '30 days')::int`,
        subscribed: sql<number>`count(*) filter (where ${customers.status} in ('active','provisional') and ${customers.emailMarketing} = 'subscribed')::int`,
      })
      .from(customers)
      .where(base);
    return row;
  });
}

export async function listAssignableMembers(ctx: OrgContext) {
  return withTenant(ctx, (tx) =>
    tx
      .select({ membershipId: memberships.id, name: user.name, email: user.email })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.status, "active")))
      .orderBy(asc(user.name)),
  );
}
