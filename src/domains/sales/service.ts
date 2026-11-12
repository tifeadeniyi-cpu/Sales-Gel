import "server-only";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, max, min, ne, or, sql, type SQL } from "drizzle-orm";
import { customers } from "@/domains/customers/schema";
import { memberships } from "@/domains/identity/schema";
import { auditLogs } from "@/domains/platform/schema";
import { notify } from "@/domains/platform/notifications";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import { canReadRecord, type OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { parseMoney, sumByCurrency, weighted } from "@/lib/money";
import { leadProducts, leads, leadStageHistory, pipelines, pipelineStages } from "./schema";
import {
  DEFAULT_STAGES,
  LEAD_INLINE_FIELDS,
  leadFiltersSchema,
  leadInputSchema,
  lostReasonSchema,
  pipelineNameSchema,
  REQUIRABLE_FIELDS,
  stageInputSchema,
  type LeadFilters,
  type LeadInput,
  type RequirableField,
} from "./validation";

type LeadRow = typeof leads.$inferSelect;
type StageRow = typeof pipelineStages.$inferSelect;

/* ───────────────────────── Permission helpers ───────────────────────── */

function assertCanReadLeads(ctx: OrgContext) {
  if (!ctx.permissions.has("leads.read") && !ctx.permissions.has("leads.read_assigned")) throw new ForbiddenError(undefined, "leads.read");
}
function need(ctx: OrgContext, p: "leads.write" | "pipelines.manage") {
  if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
}
function leadScope(ctx: OrgContext): SQL | undefined {
  if (ctx.permissions.has("leads.read")) return undefined;
  if (ctx.permissions.has("leads.read_assigned")) return eq(leads.ownerMembershipId, ctx.membershipId);
  return sql`false`;
}

async function loadLeadForWrite(tx: Tx, ctx: OrgContext, id: string): Promise<LeadRow> {
  const [l] = await tx.select().from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, id))).for("update");
  if (!l || !canReadRecord(ctx, "leads", { ownerMembershipId: l.ownerMembershipId })) throw new NotFoundError("Lead not found.");
  if (l.archivedAt) throw new ValidationError("This lead is archived. Restore it first.");
  return l;
}

async function assertMember(tx: Tx, ctx: OrgContext, membershipId: string | null | undefined) {
  if (!membershipId) return;
  const [m] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, membershipId)));
  if (!m || m.status !== "active") throw new ValidationError("Choose an active team member.", { ownerMembershipId: ["Choose an active team member."] });
}

/** A lead may only point at a customer the caller can see (and that isn't merged away). */
async function assertCustomer(tx: Tx, ctx: OrgContext, customerId: string | null | undefined) {
  if (!customerId) return null;
  const [c] = await tx
    .select({ id: customers.id, status: customers.status, ownerMembershipId: customers.ownerMembershipId, displayName: customers.displayName, mergedIntoId: customers.mergedIntoId })
    .from(customers)
    .where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, customerId)));
  const canSee = c && (ctx.permissions.has("customers.read") || (ctx.permissions.has("customers.read_assigned") && c.ownerMembershipId === ctx.membershipId));
  if (!c || !canSee) throw new ValidationError("Choose a customer you have access to.", { customerId: ["Choose a customer you have access to."] });
  if (c.status === "merged") throw new ValidationError("That customer was merged into another record.", { customerId: ["That customer was merged; choose the surviving record."] });
  return c;
}

function missingRequired(stage: StageRow, lead: Partial<LeadRow>): RequirableField[] {
  return (stage.requiredFields ?? []).filter((f) => {
    const v = lead[f as keyof LeadRow];
    return v === null || v === undefined || v === "";
  }) as RequirableField[];
}

function requiredError(stage: StageRow, missing: RequirableField[]) {
  return new ValidationError(
    `“${stage.name}” requires: ${missing.map((m) => REQUIRABLE_FIELDS[m]).join(", ")}.`,
    Object.fromEntries(missing.map((m) => [m === "valueAmount" ? "value" : m, [`Required for ${stage.name}`]])),
  );
}

/* ───────────────────────── Pipelines & stages ───────────────────────── */

async function insertPipeline(tx: Tx, orgId: string, name: string, isDefault: boolean) {
  const id = newId();
  const [{ pos }] = await tx.select({ pos: max(pipelines.position) }).from(pipelines).where(eq(pipelines.organizationId, orgId));
  await tx.insert(pipelines).values({ id, organizationId: orgId, name, isDefault, position: (pos ?? -1) + 1 });
  await tx.insert(pipelineStages).values(DEFAULT_STAGES.map((s, i) => ({ organizationId: orgId, pipelineId: id, position: i, ...s })));
  return id;
}

/** Every org gets a default "Sales" pipeline with the standard stages the first time it's needed. */
export async function ensureDefaultPipeline(tx: Tx, orgId: string) {
  const [quick] = await tx.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.organizationId, orgId)).limit(1);
  if (quick) return;
  // Serialize concurrent first-use requests for this org so only one default pipeline is created.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pipelines:${orgId}`}))`);
  const [existing] = await tx.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.organizationId, orgId), isNull(pipelines.archivedAt))).limit(1);
  if (existing) return;
  await insertPipeline(tx, orgId, "Sales", true);
}

export async function listPipelines(ctx: OrgContext, opts: { includeArchivedStages?: boolean } = {}) {
  if (!ctx.permissions.has("pipelines.manage")) assertCanReadLeads(ctx);
  return withTenant(ctx, async (tx) => {
    await ensureDefaultPipeline(tx, ctx.orgId);
    const ps = await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), isNull(pipelines.archivedAt))).orderBy(desc(pipelines.isDefault), asc(pipelines.position));
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.organizationId, ctx.orgId), opts.includeArchivedStages ? undefined : isNull(pipelineStages.archivedAt)))
      .orderBy(asc(pipelineStages.position));
    const counts = await tx
      .select({ stageId: leads.stageId, n: count() })
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.orgId), isNull(leads.archivedAt)))
      .groupBy(leads.stageId);
    return ps.map((p) => ({
      ...p,
      stages: stages.filter((s) => s.pipelineId === p.id).map((s) => ({ ...s, leadCount: counts.find((c) => c.stageId === s.id)?.n ?? 0 })),
    }));
  });
}
export type PipelineWithStages = Awaited<ReturnType<typeof listPipelines>>[number];

export async function createPipeline(ctx: OrgContext, input: { name: string }) {
  need(ctx, "pipelines.manage");
  const { name } = parseInput(pipelineNameSchema, input);
  return withTenant(ctx, async (tx) => {
    await ensureDefaultPipeline(tx, ctx.orgId);
    const id = await insertPipeline(tx, ctx.orgId, name, false);
    await audit(tx, ctx, { action: "pipeline.created", entityType: "pipeline", entityId: id, metadata: { name } });
    return { id };
  });
}

export async function updatePipeline(ctx: OrgContext, id: string, input: { name?: string; isDefault?: boolean }) {
  need(ctx, "pipelines.manage");
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), eq(pipelines.id, id))).for("update");
    if (!p || p.archivedAt) throw new NotFoundError("Pipeline not found.");
    const patch: Partial<typeof p> = {};
    if (input.name !== undefined) patch.name = parseInput(pipelineNameSchema, { name: input.name }).name;
    if (input.isDefault) {
      await tx.update(pipelines).set({ isDefault: false }).where(eq(pipelines.organizationId, ctx.orgId));
      patch.isDefault = true;
    }
    await tx.update(pipelines).set(patch).where(eq(pipelines.id, id));
    await audit(tx, ctx, { action: "pipeline.updated", entityType: "pipeline", entityId: id, changes: diff(p, patch) });
  });
}

export async function archivePipeline(ctx: OrgContext, id: string) {
  need(ctx, "pipelines.manage");
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), eq(pipelines.id, id))).for("update");
    if (!p || p.archivedAt) throw new NotFoundError("Pipeline not found.");
    const [{ n: open }] = await tx.select({ n: count() }).from(leads).where(and(eq(leads.pipelineId, id), eq(leads.status, "open"), isNull(leads.archivedAt)));
    if (open > 0) throw new ConflictError(`Move or close the ${open} open lead(s) in this pipeline first.`);
    const [{ n: active }] = await tx.select({ n: count() }).from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), isNull(pipelines.archivedAt)));
    if (active <= 1) throw new ConflictError("You need at least one pipeline.");
    await tx.update(pipelines).set({ archivedAt: new Date(), isDefault: false }).where(eq(pipelines.id, id));
    if (p.isDefault) {
      const [next] = await tx.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), isNull(pipelines.archivedAt))).orderBy(asc(pipelines.position)).limit(1);
      if (next) await tx.update(pipelines).set({ isDefault: true }).where(eq(pipelines.id, next.id));
    }
    await audit(tx, ctx, { action: "pipeline.archived", entityType: "pipeline", entityId: id, metadata: { name: p.name } });
  });
}

async function loadStage(tx: Tx, ctx: OrgContext, stageId: string) {
  const [s] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.organizationId, ctx.orgId), eq(pipelineStages.id, stageId))).for("update");
  if (!s) throw new NotFoundError("Stage not found.");
  return s;
}

export async function addStage(ctx: OrgContext, pipelineId: string, input: unknown) {
  need(ctx, "pipelines.manage");
  const data = parseInput(stageInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), eq(pipelines.id, pipelineId)));
    if (!p || p.archivedAt) throw new NotFoundError("Pipeline not found.");
    // New open stages go before the first closed (won/lost) stage.
    const [firstClosed] = await tx
      .select({ pos: min(pipelineStages.position) })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipelineId), ne(pipelineStages.category, "open"), isNull(pipelineStages.archivedAt)));
    const [last] = await tx.select({ pos: max(pipelineStages.position) }).from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId));
    let position = (last?.pos ?? -1) + 1;
    if (data.category === "open" && firstClosed?.pos !== null && firstClosed?.pos !== undefined) {
      position = firstClosed.pos;
      await tx.update(pipelineStages).set({ position: sql`${pipelineStages.position} + 1` }).where(and(eq(pipelineStages.pipelineId, pipelineId), sql`${pipelineStages.position} >= ${position}`));
    }
    const [s] = await tx.insert(pipelineStages).values({ organizationId: ctx.orgId, pipelineId, position, ...data }).returning();
    await audit(tx, ctx, { action: "stage.created", entityType: "pipeline", entityId: pipelineId, metadata: { stage: data.name } });
    return s;
  });
}

export async function updateStage(ctx: OrgContext, stageId: string, input: unknown) {
  need(ctx, "pipelines.manage");
  const data = parseInput(stageInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const s = await loadStage(tx, ctx, stageId);
    if (data.category !== s.category) {
      const [{ n }] = await tx.select({ n: count() }).from(leads).where(and(eq(leads.stageId, stageId), isNull(leads.archivedAt)));
      if (n > 0) throw new ConflictError(`Move the ${n} lead(s) out of “${s.name}” before changing it to a ${data.category} stage.`);
      if (s.category === "open") await assertOtherOpenStage(tx, s);
    }
    await tx.update(pipelineStages).set(data).where(eq(pipelineStages.id, stageId));
    await audit(tx, ctx, { action: "stage.updated", entityType: "pipeline", entityId: s.pipelineId, changes: diff(s, data), metadata: { stage: s.name } });
  });
}

async function assertOtherOpenStage(tx: Tx, s: StageRow) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, s.pipelineId), eq(pipelineStages.category, "open"), isNull(pipelineStages.archivedAt), ne(pipelineStages.id, s.id)));
  if (n === 0) throw new ConflictError("A pipeline needs at least one open stage.");
}

export async function reorderStages(ctx: OrgContext, pipelineId: string, orderedIds: string[]) {
  need(ctx, "pipelines.manage");
  return withTenant(ctx, async (tx) => {
    const current = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.organizationId, ctx.orgId), eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.archivedAt)));
    const ids = new Set(current.map((s) => s.id));
    if (orderedIds.length !== ids.size || orderedIds.some((id) => !ids.has(id))) throw new ValidationError("The stage list changed. Refresh and try again.");
    for (const [i, id] of orderedIds.entries()) await tx.update(pipelineStages).set({ position: i }).where(eq(pipelineStages.id, id));
    await audit(tx, ctx, { action: "stage.reordered", entityType: "pipeline", entityId: pipelineId, metadata: { order: orderedIds.map((id) => current.find((s) => s.id === id)?.name) } });
  });
}

/** Archives a stage after moving its leads to another stage of the same pipeline (history recorded). */
export async function archiveStage(ctx: OrgContext, stageId: string, moveToStageId: string | null) {
  need(ctx, "pipelines.manage");
  return withTenant(ctx, async (tx) => {
    const s = await loadStage(tx, ctx, stageId);
    if (s.archivedAt) return;
    if (s.category === "open") await assertOtherOpenStage(tx, s);
    const inStage = await tx.select().from(leads).where(and(eq(leads.stageId, stageId), isNull(leads.archivedAt))).for("update");
    if (inStage.length) {
      if (!moveToStageId) throw new ValidationError(`Choose where to move the ${inStage.length} lead(s) in “${s.name}”.`, { moveToStageId: ["Choose a stage"] });
      const target = await loadStage(tx, ctx, moveToStageId);
      if (target.pipelineId !== s.pipelineId || target.archivedAt || target.id === s.id) throw new ValidationError("Choose another active stage in the same pipeline.");
      if (target.category !== s.category) throw new ValidationError(`Move leads to another ${s.category} stage so their won/lost status doesn't change silently.`);
      await tx.update(leads).set({ stageId: target.id }).where(and(eq(leads.stageId, stageId), isNull(leads.archivedAt)));
      await tx.insert(leadStageHistory).values(inStage.map((l) => ({ organizationId: ctx.orgId, leadId: l.id, fromStageId: s.id, toStageId: target.id, changedByUserId: ctx.userId })));
    }
    await tx.update(pipelineStages).set({ archivedAt: new Date() }).where(eq(pipelineStages.id, stageId));
    await audit(tx, ctx, { action: "stage.archived", entityType: "pipeline", entityId: s.pipelineId, metadata: { stage: s.name, movedLeads: inStage.length } });
  });
}

/* ───────────────────────── Leads ───────────────────────── */

async function resolveStage(tx: Tx, ctx: OrgContext, pipelineId?: string, stageId?: string) {
  await ensureDefaultPipeline(tx, ctx.orgId);
  if (stageId) {
    const [s] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.organizationId, ctx.orgId), eq(pipelineStages.id, stageId), isNull(pipelineStages.archivedAt)));
    if (!s || (pipelineId && s.pipelineId !== pipelineId)) throw new ValidationError("Choose a valid stage.", { stageId: ["Choose a valid stage"] });
    return s;
  }
  const [p] = pipelineId
    ? await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), eq(pipelines.id, pipelineId), isNull(pipelines.archivedAt)))
    : await tx.select().from(pipelines).where(and(eq(pipelines.organizationId, ctx.orgId), isNull(pipelines.archivedAt))).orderBy(desc(pipelines.isDefault), asc(pipelines.position)).limit(1);
  if (!p) throw new ValidationError("Choose a valid pipeline.", { pipelineId: ["Choose a valid pipeline"] });
  const [first] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, p.id), eq(pipelineStages.category, "open"), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position))
    .limit(1);
  if (!first) throw new ConflictError("This pipeline has no open stages.");
  return first;
}

async function endPosition(tx: Tx, stageId: string) {
  const [{ pos }] = await tx.select({ pos: max(leads.position) }).from(leads).where(eq(leads.stageId, stageId));
  return (pos ?? 0) + 1024;
}

async function notifyLeadOwner(tx: Tx, ctx: OrgContext, lead: { id: string; title: string }, membershipId: string) {
  if (membershipId === ctx.membershipId) return;
  const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, membershipId));
  if (m) {
    await notify(tx, { orgId: ctx.orgId, recipientUserId: m.userId, type: "lead.assigned", title: `Lead assigned to you: ${lead.title}`, link: `/o/${ctx.orgSlug}/leads/${lead.id}`, entityType: "lead", entityId: lead.id });
  }
}

export async function createLead(ctx: OrgContext, input: LeadInput) {
  need(ctx, "leads.write");
  assertCanReadLeads(ctx);
  const data = parseInput(leadInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const stage = await resolveStage(tx, ctx, data.pipelineId, data.stageId);
    const customer = await assertCustomer(tx, ctx, data.customerId);
    const ownerMembershipId = ctx.permissions.has("leads.read") ? (data.ownerMembershipId ?? null) : ctx.membershipId;
    await assertMember(tx, ctx, ownerMembershipId);
    const currency = data.currency ?? ctx.defaultCurrency;
    const valueAmount = data.value === null || data.value === undefined || data.value === "" ? null : parseMoney(data.value, currency);
    if (data.value && valueAmount === null) throw new ValidationError("Enter a valid amount.", { value: ["Enter a valid amount, e.g. 1250.00"] });
    if (valueAmount !== null && valueAmount < 0) throw new ValidationError("Amounts can't be negative.", { value: ["Amounts can't be negative"] });
    const draft = { customerId: customer?.id ?? null, valueAmount, ownerMembershipId, expectedCloseDate: data.expectedCloseDate ?? null, source: data.source ?? null };
    const missing = missingRequired(stage, draft);
    if (missing.length) throw requiredError(stage, missing);

    const id = newId();
    const number = await nextNumber(tx, ctx.orgId, "lead");
    const closed = stage.category !== "open";
    await tx.insert(leads).values({
      id,
      organizationId: ctx.orgId,
      number,
      title: data.title,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      status: stage.category,
      currency,
      probability: data.probability ?? null,
      priority: data.priority,
      notes: data.notes,
      position: await endPosition(tx, stage.id),
      closedAt: closed ? new Date() : null,
      createdByUserId: ctx.userId,
      lastActivityAt: new Date(),
      ...draft,
    });
    await tx.insert(leadStageHistory).values({ organizationId: ctx.orgId, leadId: id, fromStageId: null, toStageId: stage.id, changedByUserId: ctx.userId });
    if (data.products.length) await tx.insert(leadProducts).values(data.products.map((p) => ({ organizationId: ctx.orgId, leadId: id, ...p })));
    await audit(tx, ctx, { action: "lead.created", entityType: "lead", entityId: id, metadata: { number, title: data.title, stage: stage.name } });
    if (customer) await audit(tx, ctx, { action: "customer.lead_created", entityType: "customer", entityId: customer.id, metadata: { leadId: id, title: data.title } });
    await emit(tx, ctx.orgId, "lead.created", { leadId: id });
    if (ownerMembershipId) await notifyLeadOwner(tx, ctx, { id, title: data.title }, ownerMembershipId);
    return { id, number };
  });
}

export async function updateLeadField(ctx: OrgContext, id: string, field: string, value: unknown) {
  need(ctx, "leads.write");
  if (!(LEAD_INLINE_FIELDS as readonly string[]).includes(field)) throw new ValidationError("This field can't be edited inline.");
  return withTenant(ctx, async (tx) => {
    const before = await loadLeadForWrite(tx, ctx, id);
    const patch: Partial<LeadRow> = {};
    const v = value === "" ? null : value;
    switch (field) {
      case "title":
        patch.title = parseInput(leadInputSchema.shape.title, v);
        break;
      case "customerId":
        patch.customerId = (await assertCustomer(tx, ctx, parseInput(leadInputSchema.shape.customerId, v)))?.id ?? null;
        break;
      case "value": {
        const amount = v === null ? null : parseMoney(v as string, before.currency);
        if (v !== null && (amount === null || amount < 0)) throw new ValidationError("Enter a valid amount.", { value: ["Enter a valid amount, e.g. 1250.00"] });
        patch.valueAmount = amount;
        break;
      }
      case "currency":
        patch.currency = parseInput(leadInputSchema.shape.currency.unwrap(), v);
        break;
      case "source":
        patch.source = parseInput(leadInputSchema.shape.source, v) ?? null;
        break;
      case "probability":
        patch.probability = parseInput(leadInputSchema.shape.probability, v) ?? null;
        break;
      case "priority":
        patch.priority = parseInput(leadInputSchema.shape.priority, v);
        break;
      case "ownerMembershipId": {
        if (!ctx.permissions.has("leads.read")) throw new ForbiddenError("You can only reassign leads if you can see all leads.");
        const m = parseInput(leadInputSchema.shape.ownerMembershipId, v) ?? null;
        await assertMember(tx, ctx, m);
        patch.ownerMembershipId = m;
        break;
      }
      case "expectedCloseDate":
        patch.expectedCloseDate = parseInput(leadInputSchema.shape.expectedCloseDate, v) ?? null;
        break;
      case "notes":
        patch.notes = parseInput(leadInputSchema.shape.notes, v);
        break;
    }
    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, before.stageId));
    const missing = missingRequired(stage, { ...before, ...patch });
    if (missing.length) throw requiredError(stage, missing);
    const [after] = await tx.update(leads).set({ ...patch, lastActivityAt: new Date() }).where(eq(leads.id, id)).returning();
    await audit(tx, ctx, { action: "lead.updated", entityType: "lead", entityId: id, changes: diff(before, patch) });
    if (patch.ownerMembershipId && patch.ownerMembershipId !== before.ownerMembershipId) {
      await notifyLeadOwner(tx, ctx, after, patch.ownerMembershipId);
      await emit(tx, ctx.orgId, "lead.assigned", { leadId: id, ownerMembershipId: patch.ownerMembershipId });
    }
    return after;
  });
}

/**
 * Moves a lead to a stage (optionally placing it before another lead). Enforces the target stage's
 * required fields, requires a reason when losing, and keeps status/closed_at in step with the stage.
 */
export async function moveLead(ctx: OrgContext, id: string, input: { stageId: string; beforeLeadId?: string | null; lostReason?: string | null }) {
  need(ctx, "leads.write");
  return withTenant(ctx, async (tx) => {
    const lead = await loadLeadForWrite(tx, ctx, id);
    const [target] = await tx.select().from(pipelineStages).where(and(eq(pipelineStages.organizationId, ctx.orgId), eq(pipelineStages.id, input.stageId), isNull(pipelineStages.archivedAt)));
    if (!target) throw new ValidationError("Choose a valid stage.");
    const missing = missingRequired(target, lead);
    if (missing.length) throw requiredError(target, missing);
    let lostReason = lead.lostReason;
    if (target.category === "lost") {
      lostReason = parseInput(lostReasonSchema, { reason: input.lostReason ?? lead.lostReason ?? "" }).reason;
    } else lostReason = null;

    // Position: midway between the lead we're placed before and its predecessor.
    let position: number;
    if (input.beforeLeadId) {
      const [before] = await tx.select({ position: leads.position, stageId: leads.stageId }).from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, input.beforeLeadId)));
      if (!before || before.stageId !== target.id) position = await endPosition(tx, target.id);
      else {
        const [prev] = await tx.select({ pos: max(leads.position) }).from(leads).where(and(eq(leads.stageId, target.id), lt(leads.position, before.position), ne(leads.id, id)));
        position = ((prev?.pos ?? before.position - 2048) + before.position) / 2;
      }
    } else position = lead.stageId === target.id ? lead.position : await endPosition(tx, target.id);

    const stageChanged = lead.stageId !== target.id;
    const status = target.category;
    await tx
      .update(leads)
      .set({
        pipelineId: target.pipelineId,
        stageId: target.id,
        position,
        status,
        lostReason,
        closedAt: status === "open" ? null : stageChanged || lead.status === "open" ? new Date() : lead.closedAt,
        lastActivityAt: new Date(),
      })
      .where(eq(leads.id, id));
    if (stageChanged) {
      const [from] = await tx.select({ name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, lead.stageId));
      await tx.insert(leadStageHistory).values({ organizationId: ctx.orgId, leadId: id, fromStageId: lead.stageId, toStageId: target.id, changedByUserId: ctx.userId });
      const action = status === "won" ? "lead.won" : status === "lost" ? "lead.lost" : lead.status !== "open" ? "lead.reopened" : "lead.stage_changed";
      await audit(tx, ctx, { action, entityType: "lead", entityId: id, changes: { stage: { from: from?.name, to: target.name } }, metadata: lostReason ? { lostReason } : undefined });
      if (lead.customerId && status !== "open") {
        await audit(tx, ctx, { action: status === "won" ? "customer.lead_won" : "customer.lead_lost", entityType: "customer", entityId: lead.customerId, metadata: { leadId: id, title: lead.title } });
      }
      await emit(tx, ctx.orgId, action, { leadId: id, fromStageId: lead.stageId, toStageId: target.id });
    }
    return { status, stageId: target.id };
  });
}

/** Shortcut: move to the pipeline's first won/lost stage. Won leads never auto-create orders (see Phase 4). */
export async function closeLead(ctx: OrgContext, id: string, outcome: "won" | "lost", lostReason?: string) {
  const target = await withTenant(ctx, async (tx) => {
    const lead = await loadLeadForWrite(tx, ctx, id);
    const [s] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, lead.pipelineId), eq(pipelineStages.category, outcome), isNull(pipelineStages.archivedAt)))
      .orderBy(asc(pipelineStages.position))
      .limit(1);
    if (!s) throw new ConflictError(`This pipeline has no ${outcome} stage. Add one in pipeline settings.`);
    return s;
  });
  return moveLead(ctx, id, { stageId: target.id, lostReason });
}

export async function setLeadArchived(ctx: OrgContext, id: string, archived: boolean) {
  need(ctx, "leads.write");
  return withTenant(ctx, async (tx) => {
    const [l] = await tx.select().from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, id))).for("update");
    if (!l || !canReadRecord(ctx, "leads", { ownerMembershipId: l.ownerMembershipId })) throw new NotFoundError("Lead not found.");
    if (!!l.archivedAt === archived) return;
    await tx.update(leads).set({ archivedAt: archived ? new Date() : null }).where(eq(leads.id, id));
    await audit(tx, ctx, { action: archived ? "lead.archived" : "lead.restored", entityType: "lead", entityId: id });
  });
}

export async function setLeadProducts(ctx: OrgContext, id: string, products: { name: string; quantity?: number }[]) {
  need(ctx, "leads.write");
  const { products: list } = parseInput(leadInputSchema.pick({ products: true }), { products });
  return withTenant(ctx, async (tx) => {
    await loadLeadForWrite(tx, ctx, id);
    const before = await tx.select({ name: leadProducts.name }).from(leadProducts).where(eq(leadProducts.leadId, id));
    await tx.delete(leadProducts).where(eq(leadProducts.leadId, id));
    if (list.length) await tx.insert(leadProducts).values(list.map((p) => ({ organizationId: ctx.orgId, leadId: id, ...p })));
    await audit(tx, ctx, { action: "lead.products_changed", entityType: "lead", entityId: id, changes: { products: { from: before.map((b) => b.name), to: list.map((p) => p.name) } } });
  });
}

/* ───────────────────────── Reads ───────────────────────── */

const leadSelect = {
  id: leads.id,
  number: leads.number,
  title: leads.title,
  status: leads.status,
  pipelineId: leads.pipelineId,
  stageId: leads.stageId,
  valueAmount: leads.valueAmount,
  currency: leads.currency,
  probability: leads.probability,
  priority: leads.priority,
  source: leads.source,
  expectedCloseDate: leads.expectedCloseDate,
  position: leads.position,
  closedAt: leads.closedAt,
  lostReason: leads.lostReason,
  lastActivityAt: leads.lastActivityAt,
  createdAt: leads.createdAt,
  customerId: leads.customerId,
  customerName: customers.displayName,
  ownerMembershipId: leads.ownerMembershipId,
  ownerName: user.name,
};

function leadWhere(ctx: OrgContext, f: ReturnType<typeof leadFiltersSchema.parse>) {
  const conds: (SQL | undefined)[] = [eq(leads.organizationId, ctx.orgId), isNull(leads.archivedAt), leadScope(ctx)];
  if (f.pipeline) conds.push(eq(leads.pipelineId, f.pipeline));
  if (f.status !== "all") conds.push(eq(leads.status, f.status));
  if (f.owner === "me") conds.push(eq(leads.ownerMembershipId, ctx.membershipId));
  else if (f.owner === "unassigned") conds.push(isNull(leads.ownerMembershipId));
  else if (f.owner && /^[0-9a-f-]{36}$/i.test(f.owner)) conds.push(eq(leads.ownerMembershipId, f.owner));
  if (f.customer) conds.push(eq(leads.customerId, f.customer));
  if (f.priority) conds.push(eq(leads.priority, f.priority));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const num = f.q.match(/^(?:lead-)?(\d+)$/i);
    conds.push(or(ilike(leads.title, like), ilike(customers.displayName, like), num ? eq(leads.number, Number(num[1])) : undefined));
  }
  return and(...conds)!;
}

function baseLeadQuery(tx: Tx) {
  return tx
    .select(leadSelect)
    .from(leads)
    .leftJoin(customers, and(eq(customers.organizationId, leads.organizationId), eq(customers.id, leads.customerId)))
    .leftJoin(memberships, and(eq(memberships.organizationId, leads.organizationId), eq(memberships.id, leads.ownerMembershipId)))
    .leftJoin(user, eq(user.id, memberships.userId));
}

/** Customer names on leads are hidden when the caller can't see that customer. */
function maskCustomer<T extends { customerId: string | null; customerName: string | null }>(ctx: OrgContext, rows: T[], visible: Set<string> | null): T[] {
  if (visible === null) return rows;
  return rows.map((r) => (r.customerId && !visible.has(r.customerId) ? { ...r, customerName: "Restricted customer" } : r));
}

async function visibleCustomerIds(tx: Tx, ctx: OrgContext, ids: string[]): Promise<Set<string> | null> {
  if (ctx.permissions.has("customers.read")) return null;
  if (!ids.length || !ctx.permissions.has("customers.read_assigned")) return new Set();
  const rows = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, ids), eq(customers.ownerMembershipId, ctx.membershipId)));
  return new Set(rows.map((r) => r.id));
}

/** Kanban data: stages of one pipeline with their leads and per-currency totals. */
export async function getBoard(ctx: OrgContext, filters: LeadFilters = {}) {
  assertCanReadLeads(ctx);
  const f = parseInput(leadFiltersSchema, { ...filters, status: filters.status ?? "all" });
  const all = await listPipelines(ctx);
  const pipeline = all.find((p) => p.id === f.pipeline) ?? all[0];
  return withTenant(ctx, async (tx) => {
    const rows = await baseLeadQuery(tx).where(leadWhere(ctx, { ...f, pipeline: pipeline.id })).orderBy(asc(leads.position), asc(leads.createdAt)).limit(2000);
    const visible = await visibleCustomerIds(tx, ctx, rows.map((r) => r.customerId).filter((x): x is string => !!x));
    const masked = maskCustomer(ctx, rows, visible);
    const stages = pipeline.stages.map((s) => {
      const items = masked.filter((l) => l.stageId === s.id);
      const totals = sumByCurrency(items.map((l) => ({ amount: l.valueAmount, currency: l.currency })));
      const weightedTotals = sumByCurrency(items.map((l) => ({ amount: l.valueAmount === null ? null : weighted(l.valueAmount, l.probability ?? s.probability), currency: l.currency })));
      return { ...s, leads: items, totals, weightedTotals };
    });
    return { pipelines: all.map(({ id, name, isDefault }) => ({ id, name, isDefault })), pipeline: { id: pipeline.id, name: pipeline.name }, stages, filters: f };
  });
}

export async function listLeads(ctx: OrgContext, filters: LeadFilters = {}, limit = 500) {
  assertCanReadLeads(ctx);
  const f = parseInput(leadFiltersSchema, filters);
  return withTenant(ctx, async (tx) => {
    const rows = await baseLeadQuery(tx)
      .where(leadWhere(ctx, f))
      .orderBy(desc(leads.createdAt))
      .limit(Math.min(limit, 2000));
    const stageRows = rows.length ? await tx.select({ id: pipelineStages.id, name: pipelineStages.name, color: pipelineStages.color }).from(pipelineStages).where(inArray(pipelineStages.id, [...new Set(rows.map((r) => r.stageId))])) : [];
    const visible = await visibleCustomerIds(tx, ctx, rows.map((r) => r.customerId).filter((x): x is string => !!x));
    return maskCustomer(ctx, rows, visible).map((r) => ({ ...r, stage: stageRows.find((s) => s.id === r.stageId) ?? null }));
  });
}

export async function getLead(ctx: OrgContext, id: string) {
  assertCanReadLeads(ctx);
  return withTenant(ctx, async (tx) => {
    const [l] = await baseLeadQuery(tx).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, id)));
    if (!l || !canReadRecord(ctx, "leads", { ownerMembershipId: l.ownerMembershipId })) return null;
    const [full] = await tx.select({ notes: leads.notes, archivedAt: leads.archivedAt, createdByUserId: leads.createdByUserId }).from(leads).where(eq(leads.id, id));
    const [stages, history, products] = await Promise.all([
      tx.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, l.pipelineId), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position)),
      tx
        .select({ id: leadStageHistory.id, fromStageId: leadStageHistory.fromStageId, toStageId: leadStageHistory.toStageId, createdAt: leadStageHistory.createdAt, by: user.name })
        .from(leadStageHistory)
        .leftJoin(user, eq(user.id, leadStageHistory.changedByUserId))
        .where(eq(leadStageHistory.leadId, id))
        .orderBy(desc(leadStageHistory.createdAt)),
      tx.select().from(leadProducts).where(eq(leadProducts.leadId, id)).orderBy(asc(leadProducts.createdAt)),
    ]);
    const allStageNames = await tx.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.organizationId, ctx.orgId));
    const name = (sid: string | null) => (sid ? allStageNames.find((s) => s.id === sid)?.name ?? "Archived stage" : null);
    const [pipeline] = await tx.select({ name: pipelines.name }).from(pipelines).where(eq(pipelines.id, l.pipelineId));
    const visible = await visibleCustomerIds(tx, ctx, l.customerId ? [l.customerId] : []);
    const [masked] = maskCustomer(ctx, [l], visible);
    return {
      ...masked,
      ...full,
      customerVisible: !l.customerId || visible === null || visible.has(l.customerId),
      pipelineName: pipeline?.name ?? "",
      stages,
      history: history.map((h) => ({ ...h, fromName: name(h.fromStageId), toName: name(h.toStageId) })),
      products,
    };
  });
}
export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export async function getLeadTimeline(ctx: OrgContext, id: string) {
  const l = await getLead(ctx, id);
  if (!l) throw new NotFoundError("Lead not found.");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, changes: auditLogs.changes, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actorName: user.name })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "lead"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  );
}

/** Headline numbers. Pipeline value is reported per currency and never summed across currencies. */
export async function getLeadStats(ctx: OrgContext) {
  if (!ctx.permissions.has("leads.read") && !ctx.permissions.has("leads.read_assigned")) return null;
  return withTenant(ctx, async (tx) => {
    const scope = leadScope(ctx);
    const open = await tx
      .select({ amount: leads.valueAmount, currency: leads.currency, probability: leads.probability, stageProbability: pipelineStages.probability })
      .from(leads)
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(and(eq(leads.organizationId, ctx.orgId), eq(leads.status, "open"), isNull(leads.archivedAt), scope));
    const [closed] = await tx
      .select({
        won: sql<number>`count(*) filter (where ${leads.status} = 'won')::int`,
        lost: sql<number>`count(*) filter (where ${leads.status} = 'lost')::int`,
      })
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.orgId), isNull(leads.archivedAt), gt(leads.closedAt, sql`now() - interval '90 days'`), scope));
    const decided = closed.won + closed.lost;
    return {
      active: open.length,
      pipelineValue: sumByCurrency(open.map((o) => ({ amount: o.amount, currency: o.currency }))),
      weightedValue: sumByCurrency(open.map((o) => ({ amount: o.amount === null ? null : weighted(o.amount, o.probability ?? o.stageProbability), currency: o.currency }))),
      winRate90: decided ? Math.round((closed.won / decided) * 100) : null,
      won90: closed.won,
      lost90: closed.lost,
    };
  });
}
