import "server-only";
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { audit, emit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { loadForWrite, readScope, requirePerm } from "./internal";
import { normalizeEmail, normalizeHandle, normalizePhone } from "./normalize";
import {
  customerAddresses,
  customerConsents,
  customerDuplicateDismissals,
  customerEmails,
  customerIdentities,
  customerMerges,
  customerNotes,
  customerPhones,
  customers,
  customerTags,
  type MergeSnapshot,
} from "./schema";

export type MatchReason = "email" | "phone" | "identity";

/* ───────────────────────── Detection ───────────────────────── */

/**
 * Suggested duplicate pairs, based on exact normalized identifiers (email, E.164 phone,
 * provider + handle). Suggestions only: nothing is ever merged automatically.
 */
export async function findDuplicateSuggestions(ctx: OrgContext, opts: { customerId?: string; limit?: number } = {}) {
  requirePerm(ctx, "customers.read");
  const limit = Math.min(opts.limit ?? 50, 200);
  return withTenant(ctx, async (tx) => {
    const focus = opts.customerId ? sql`and (a.customer_id = ${opts.customerId} or b.customer_id = ${opts.customerId})` : sql``;
    const rows = await tx.execute<{ a: string; b: string; reasons: string[]; values: string[] }>(sql`
      with keys as (
        select customer_id, 'email' as reason, normalized_email as value from ${customerEmails} where organization_id = ${ctx.orgId}
        union all
        select customer_id, 'phone', e164 from ${customerPhones} where organization_id = ${ctx.orgId}
        union all
        select customer_id, 'identity', provider || ':' || normalized_handle from ${customerIdentities}
          where organization_id = ${ctx.orgId} and normalized_handle is not null
      ),
      live as (
        select k.* from keys k join ${customers} c on c.id = k.customer_id
        where c.status in ('active','provisional')
      )
      select least(a.customer_id, b.customer_id) as a, greatest(a.customer_id, b.customer_id) as b,
             array_agg(distinct a.reason) as reasons, array_agg(distinct a.value) as values
      from live a join live b on a.reason = b.reason and a.value = b.value and a.customer_id < b.customer_id
      where true ${focus}
        and not exists (
          select 1 from ${customerDuplicateDismissals} d
          where d.organization_id = ${ctx.orgId} and d.customer_a_id = least(a.customer_id, b.customer_id) and d.customer_b_id = greatest(a.customer_id, b.customer_id)
        )
      group by 1, 2
      order by count(*) desc, 1
      limit ${limit}
    `);
    const pairs = [...rows];
    const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
    const people = ids.length
      ? await tx
          .select({ id: customers.id, number: customers.number, displayName: customers.displayName, status: customers.status, createdAt: customers.createdAt, ownerMembershipId: customers.ownerMembershipId })
          .from(customers)
          .where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, ids), readScope(ctx)))
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return pairs
      .filter((p) => byId.has(p.a) && byId.has(p.b))
      .map((p) => ({ a: byId.get(p.a)!, b: byId.get(p.b)!, reasons: p.reasons as MatchReason[], values: p.values }));
  });
}

/** Live check while creating/editing: which existing customers share an identifier with this input? */
export async function findMatchesForIdentifiers(
  ctx: OrgContext,
  input: { emails?: string[]; phones?: string[]; identities?: { provider: string; handle: string }[]; excludeId?: string },
) {
  if (!ctx.permissions.has("customers.read") && !ctx.permissions.has("customers.read_assigned")) return [];
  const emails = (input.emails ?? []).map(normalizeEmail).filter(Boolean);
  const phones = (input.phones ?? []).map((p) => normalizePhone(p)).filter((p): p is string => !!p);
  const handles = (input.identities ?? []).map((i) => `${i.provider}:${normalizeHandle(i.handle)}`).filter((h) => !h.endsWith(":"));
  if (!emails.length && !phones.length && !handles.length) return [];
  return withTenant(ctx, async (tx) => {
    const list = (vals: string[]): SQL => (vals.length ? sql.join(vals.map((v) => sql`${v}`), sql`, `) : sql`null`);
    const rows = await tx.execute<{ id: string; reason: string }>(sql`
      select customer_id as id, 'email' as reason from ${customerEmails} where organization_id = ${ctx.orgId} and normalized_email in (${list(emails)})
      union select customer_id, 'phone' from ${customerPhones} where organization_id = ${ctx.orgId} and e164 in (${list(phones)})
      union select customer_id, 'identity' from ${customerIdentities} where organization_id = ${ctx.orgId} and provider || ':' || normalized_handle in (${list(handles)})
    `);
    const ids = [...new Set([...rows].map((r) => r.id))].filter((id) => id !== input.excludeId);
    if (!ids.length) return [];
    const found = await tx
      .select({ id: customers.id, number: customers.number, displayName: customers.displayName, status: customers.status })
      .from(customers)
      .where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, ids), ne(customers.status, "merged"), readScope(ctx)));
    return found.map((f) => ({ ...f, reasons: [...rows].filter((r) => r.id === f.id).map((r) => r.reason as MatchReason) }));
  });
}

export async function dismissDuplicate(ctx: OrgContext, idA: string, idB: string) {
  requirePerm(ctx, "customers.merge");
  if (idA === idB) throw new ValidationError("Pick two different customers.");
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  return withTenant(ctx, async (tx) => {
    await loadForWrite(tx, ctx, a);
    await loadForWrite(tx, ctx, b);
    await tx.insert(customerDuplicateDismissals).values({ organizationId: ctx.orgId, customerAId: a, customerBId: b, dismissedByUserId: ctx.userId }).onConflictDoNothing();
    await audit(tx, ctx, { action: "customer.duplicate_dismissed", entityType: "customer", entityId: a, metadata: { other: b } });
  });
}

/* ───────────────────────── Merge ───────────────────────── */

/**
 * Tables whose rows follow a customer through a merge. Later phases register theirs
 * (leads, orders, tickets, conversations, tasks) so history is always preserved.
 */
interface MoverDef {
  key: string;
  /** Moves rows from `from` to `to` and returns moved ids; conflicting rows stay put. */
  move(tx: Tx, orgId: string, from: string, to: string): Promise<string[]>;
  /** Moves the given ids back to `to`. */
  restore(tx: Tx, orgId: string, ids: string[], to: string): Promise<void>;
}

function simpleMover(key: string, table: typeof customerNotes | typeof customerAddresses | typeof customerConsents): MoverDef {
  return {
    key,
    async move(tx, orgId, from, to) {
      const rows = await tx.update(table).set({ customerId: to }).where(and(eq(table.organizationId, orgId), eq(table.customerId, from))).returning({ id: table.id });
      return rows.map((r) => r.id);
    },
    async restore(tx, orgId, ids, to) {
      if (ids.length) await tx.update(table).set({ customerId: to }).where(and(eq(table.organizationId, orgId), inArray(table.id, ids)));
    },
  };
}

/** Moves identifier rows unless the survivor already has the same normalized value. */
function identifierMover(
  key: string,
  table: typeof customerEmails | typeof customerPhones | typeof customerIdentities,
  valueCol: typeof customerEmails.normalizedEmail | typeof customerPhones.e164 | typeof customerIdentities.normalizedHandle,
): MoverDef {
  return {
    key,
    async move(tx, orgId, from, to) {
      const existing = await tx.select({ v: valueCol }).from(table).where(and(eq(table.organizationId, orgId), eq(table.customerId, to)));
      const taken = existing.map((e) => e.v).filter((v): v is string => !!v);
      const rows = await tx
        .update(table)
        .set({ customerId: to, ...("isPrimary" in table ? { isPrimary: false } : {}) })
        .where(and(eq(table.organizationId, orgId), eq(table.customerId, from), taken.length ? or(isNull(valueCol), notInArray(valueCol, taken)) : undefined))
        .returning({ id: table.id });
      return rows.map((r) => r.id);
    },
    async restore(tx, orgId, ids, to) {
      if (ids.length) await tx.update(table).set({ customerId: to }).where(and(eq(table.organizationId, orgId), inArray(table.id, ids)));
    },
  };
}

const MOVERS: MoverDef[] = [
  identifierMover("emails", customerEmails, customerEmails.normalizedEmail),
  identifierMover("phones", customerPhones, customerPhones.e164),
  identifierMover("identities", customerIdentities, customerIdentities.normalizedHandle),
  simpleMover("addresses", customerAddresses),
  simpleMover("notes", customerNotes),
  simpleMover("consents", customerConsents),
];

export function registerMergeMover(mover: MoverDef) {
  if (!MOVERS.some((m) => m.key === mover.key)) MOVERS.push(mover);
}

const FILLABLE = ["firstName", "lastName", "companyName", "source", "ownerMembershipId", "preferredChannel", "preferredCurrency"] as const;

const MARKETING_RANK: Record<string, number> = { unknown: 0, subscribed: 1, unsubscribed: 2 };

export async function mergeCustomers(ctx: OrgContext, survivorId: string, mergedId: string) {
  requirePerm(ctx, "customers.merge");
  if (survivorId === mergedId) throw new ValidationError("Pick two different customers.");
  return withTenant(ctx, async (tx) => {
    // Lock in a stable order to avoid deadlocks between concurrent merges.
    const [first, second] = survivorId < mergedId ? [survivorId, mergedId] : [mergedId, survivorId];
    const lockedFirst = await loadForWrite(tx, ctx, first);
    const lockedSecond = await loadForWrite(tx, ctx, second);
    const survivor = lockedFirst.id === survivorId ? lockedFirst : lockedSecond;
    const merged = lockedFirst.id === mergedId ? lockedFirst : lockedSecond;

    const snapshot: MergeSnapshot = { moved: {}, filledFields: {}, survivorTagsAdded: [], mergedPrevStatus: merged.status };
    for (const mover of MOVERS) snapshot.moved[mover.key] = await mover.move(tx, ctx.orgId, merged.id, survivor.id);

    // Fill only empty survivor fields — never overwrite what's already there.
    const patch: Record<string, unknown> = {};
    for (const f of FILLABLE) {
      if ((survivor[f] === null || survivor[f] === "") && merged[f] !== null && merged[f] !== "") {
        patch[f] = merged[f];
        snapshot.filledFields[f] = merged[f];
      }
    }
    const fillCustom: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(merged.customFields ?? {})) {
      if (survivor.customFields?.[k] === undefined || survivor.customFields?.[k] === null) fillCustom[k] = v;
    }
    if (Object.keys(fillCustom).length) {
      patch.customFields = { ...survivor.customFields, ...fillCustom };
      snapshot.filledFields.customFields = fillCustom;
    }
    // Consent: the most restrictive email marketing status wins.
    if (MARKETING_RANK[merged.emailMarketing] > MARKETING_RANK[survivor.emailMarketing]) {
      patch.emailMarketing = merged.emailMarketing;
      snapshot.filledFields.emailMarketing = { from: survivor.emailMarketing };
    }
    if (survivor.status === "provisional" && merged.status === "active") {
      patch.status = "active";
      snapshot.filledFields.status = { from: "provisional" };
    }

    // Tags: union onto survivor (merged keeps its own for history).
    const survivorTags = (await tx.select({ id: customerTags.tagId }).from(customerTags).where(eq(customerTags.customerId, survivor.id))).map((t) => t.id);
    const mergedTags = (await tx.select({ id: customerTags.tagId }).from(customerTags).where(eq(customerTags.customerId, merged.id))).map((t) => t.id);
    const add = mergedTags.filter((t) => !survivorTags.includes(t));
    if (add.length) await tx.insert(customerTags).values(add.map((tagId) => ({ organizationId: ctx.orgId, customerId: survivor.id, tagId })));
    snapshot.survivorTagsAdded = add;

    await tx.update(customers).set({ ...patch, lastActivityAt: new Date() }).where(eq(customers.id, survivor.id));
    await tx.update(customers).set({ status: "merged", mergedIntoId: survivor.id }).where(eq(customers.id, merged.id));
    const [m] = await tx.insert(customerMerges).values({ organizationId: ctx.orgId, survivorId: survivor.id, mergedId: merged.id, snapshot, mergedByUserId: ctx.userId }).returning({ id: customerMerges.id });

    const meta = { mergeId: m.id, survivor: { id: survivor.id, number: survivor.number }, merged: { id: merged.id, number: merged.number, name: merged.displayName }, moved: Object.fromEntries(Object.entries(snapshot.moved).map(([k, v]) => [k, v.length])) };
    await audit(tx, ctx, { action: "customer.merged_in", entityType: "customer", entityId: survivor.id, metadata: meta });
    await audit(tx, ctx, { action: "customer.merged_into", entityType: "customer", entityId: merged.id, metadata: meta });
    await emit(tx, ctx.orgId, "customer.merged", { survivorId: survivor.id, mergedId: merged.id, mergeId: m.id });
    return { mergeId: m.id, survivorId: survivor.id };
  });
}

/** Reverts a merge using its snapshot. Rows moved since (e.g. re-merged elsewhere) are left where they are. */
export async function unmergeCustomers(ctx: OrgContext, mergeId: string) {
  requirePerm(ctx, "customers.merge");
  return withTenant(ctx, async (tx) => {
    const [m] = await tx.select().from(customerMerges).where(and(eq(customerMerges.organizationId, ctx.orgId), eq(customerMerges.id, mergeId))).for("update");
    if (!m) throw new NotFoundError("Merge not found.");
    if (m.revertedAt) throw new ConflictError("This merge has already been reverted.");
    const [newer] = await tx
      .select({ id: customerMerges.id })
      .from(customerMerges)
      .where(and(eq(customerMerges.organizationId, ctx.orgId), eq(customerMerges.mergedId, m.survivorId), isNull(customerMerges.revertedAt)));
    if (newer) throw new ConflictError("The surviving customer was itself merged afterwards. Revert that merge first.");

    const survivor = await loadForWrite(tx, ctx, m.survivorId);
    await loadForWrite(tx, ctx, m.mergedId, { allowMerged: true });
    const snap = m.snapshot;

    for (const mover of MOVERS) {
      const ids = snap.moved[mover.key] ?? [];
      await mover.restore(tx, ctx.orgId, ids, m.mergedId);
    }

    const patch: Record<string, unknown> = {};
    for (const f of FILLABLE) {
      if (f in snap.filledFields && survivor[f] === snap.filledFields[f]) patch[f] = null;
    }
    if (snap.filledFields.customFields) {
      const cf = { ...survivor.customFields };
      for (const [k, v] of Object.entries(snap.filledFields.customFields as Record<string, unknown>)) {
        if (JSON.stringify(cf[k]) === JSON.stringify(v)) delete cf[k];
      }
      patch.customFields = cf;
    }
    const em = snap.filledFields.emailMarketing as { from: string } | undefined;
    if (em) patch.emailMarketing = em.from;
    const st = snap.filledFields.status as { from: string } | undefined;
    if (st && survivor.status === "active") patch.status = st.from;
    if (Object.keys(patch).length) await tx.update(customers).set(patch).where(eq(customers.id, survivor.id));
    if (snap.survivorTagsAdded.length) {
      await tx.delete(customerTags).where(and(eq(customerTags.customerId, survivor.id), inArray(customerTags.tagId, snap.survivorTagsAdded)));
    }
    await tx.update(customers).set({ status: snap.mergedPrevStatus, mergedIntoId: null }).where(eq(customers.id, m.mergedId));
    await tx.update(customerMerges).set({ revertedAt: new Date(), revertedByUserId: ctx.userId }).where(eq(customerMerges.id, m.id));
    // Don't immediately re-suggest the pair that was just separated.
    const [a, b] = m.survivorId < m.mergedId ? [m.survivorId, m.mergedId] : [m.mergedId, m.survivorId];
    await tx.insert(customerDuplicateDismissals).values({ organizationId: ctx.orgId, customerAId: a, customerBId: b, dismissedByUserId: ctx.userId }).onConflictDoNothing();

    const meta = { mergeId: m.id, survivorId: m.survivorId, mergedId: m.mergedId };
    await audit(tx, ctx, { action: "customer.unmerged", entityType: "customer", entityId: m.survivorId, metadata: meta });
    await audit(tx, ctx, { action: "customer.unmerged", entityType: "customer", entityId: m.mergedId, metadata: meta });
    await emit(tx, ctx.orgId, "customer.unmerged", meta);
    return { survivorId: m.survivorId, restoredId: m.mergedId };
  });
}

export async function getMergeHistory(ctx: OrgContext, customerId: string) {
  requirePerm(ctx, "customers.read");
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(customerMerges)
      .where(and(eq(customerMerges.organizationId, ctx.orgId), sql`${customerMerges.survivorId} = ${customerId} or ${customerMerges.mergedId} = ${customerId}`))
      .orderBy(desc(customerMerges.createdAt)),
  );
}
