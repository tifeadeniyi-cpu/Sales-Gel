import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customers } from "@/domains/customers/schema";
import { orders } from "@/domains/commerce/schema";
import { memberships } from "@/domains/identity/schema";
import { leads } from "@/domains/sales/schema";
import { supportTickets } from "@/domains/support/schema";
import { createTicket } from "@/domains/support/service";
import { createTask } from "@/domains/tasks/service";
import { user } from "@/server/auth/schema";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { activeAccount, credsOf, identityFor, subAuth } from "./account";
import { checkDestination } from "./dialing";
import { callEvents, callLegs, callNotes, calls, callVoicemails, phoneAgents, phoneNumbers, phoneQueueMembers, phoneQueues, phoneUsageRecords } from "./schema";
import { deleteRecording, fetchRecordingAudio, TwilioError, voiceAccessToken } from "./twilio";

type Call = typeof calls.$inferSelect;
const PAGE = 50;

const canReadAll = (ctx: OrgContext) => ctx.permissions.has("calls.read");
const canReadSome = (ctx: OrgContext) => canReadAll(ctx) || ctx.permissions.has("calls.read_assigned");
function needRead(ctx: OrgContext) {
  if (!canReadSome(ctx)) throw new ForbiddenError("You can't see calls.");
}
function needMake(ctx: OrgContext) {
  if (!ctx.permissions.has("calls.make")) throw new ForbiddenError("You can't make calls.");
}

/** Reps see calls they handled, plus unhandled calls to queues they belong to (missed calls and voicemails to follow up). */
export function callScope(ctx: OrgContext): SQL | undefined {
  if (canReadAll(ctx)) return undefined;
  return or(
    eq(calls.agentMembershipId, ctx.membershipId),
    and(isNull(calls.agentMembershipId), sql`${calls.queueId} in (select queue_id from phone_queue_members where membership_id = ${ctx.membershipId})`),
    and(isNull(calls.agentMembershipId), sql`${calls.businessNumberId} in (select id from phone_numbers where routing->>'type' = 'agent' and routing->>'membershipId' = ${ctx.membershipId})`),
  );
}

async function loadCall(tx: Tx, ctx: OrgContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Call not found.");
  const [c] = await tx.select().from(calls).where(and(eq(calls.organizationId, ctx.orgId), eq(calls.id, id), callScope(ctx)));
  if (!c) throw new NotFoundError("Call not found.");
  return c;
}

/** Reps who only see their own customers get the number, not another rep's customer's name. */
async function visibleCustomers(tx: Tx, ctx: OrgContext, ids: (string | null)[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter((i): i is string => !!i))];
  if (!list.length) return new Set();
  if (ctx.permissions.has("customers.read")) return new Set(list);
  if (!ctx.permissions.has("customers.read_assigned")) return new Set();
  const rows = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, ctx.orgId), inArray(customers.id, list), eq(customers.ownerMembershipId, ctx.membershipId)));
  return new Set(rows.map((r) => r.id));
}

/* ───────── softphone ───────── */

/** Short-lived browser token: identity is the member, outbound goes through the workspace's TwiML app. */
export async function voiceToken(ctx: OrgContext) {
  needMake(ctx);
  return withTenant(ctx, async (tx) => {
    const a = await activeAccount(tx, ctx.orgId);
    if (!a || a.status !== "active") throw new ConflictError("Phone isn't active for this workspace.");
    const c = credsOf(a);
    const identity = identityFor(ctx.membershipId);
    const ttlSec = 3600;
    await tx.insert(phoneAgents).values({ organizationId: ctx.orgId, membershipId: ctx.membershipId, status: "offline", lastSeenAt: new Date() })
      .onConflictDoUpdate({ target: [phoneAgents.organizationId, phoneAgents.membershipId], set: { lastSeenAt: new Date() } });
    return { token: voiceAccessToken({ accountSid: a.providerAccountSid, apiKeySid: c.apiKeySid, apiKeySecret: c.apiKeySecret, identity, appSid: c.appSid, ttlSec }), identity, expiresAt: Date.now() + ttlSec * 1000 };
  });
}

const prepareSchema = z.object({
  to: z.string().trim().min(3, "Enter a number").max(40),
  fromNumberId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  leadId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  ticketId: z.uuid().optional(),
});

/** Checks a number before the browser dials it (the voice webhook checks again; this is for a clear message). */
export async function prepareCall(ctx: OrgContext, input: unknown) {
  needMake(ctx);
  const d = parseInput(prepareSchema, input);
  return withTenant(ctx, async (tx) => {
    const a = await activeAccount(tx, ctx.orgId);
    if (!a || a.status !== "active") throw new ConflictError("Phone isn't active for this workspace.");
    const dest = checkDestination(d.to, a.settings);
    if (!dest.ok) throw new ValidationError(dest.reason, { to: [dest.reason] });
    const [agent] = await tx.select({ activeCallId: phoneAgents.activeCallId }).from(phoneAgents).where(and(eq(phoneAgents.organizationId, ctx.orgId), eq(phoneAgents.membershipId, ctx.membershipId)));
    if (agent?.activeCallId) {
      const [live] = await tx.select({ endedAt: calls.endedAt }).from(calls).where(eq(calls.id, agent.activeCallId));
      if (live && !live.endedAt) throw new ConflictError("You're already on a call.");
    }
    const params: Record<string, string> = { To: dest.e164 };
    if (d.fromNumberId) params.CallerId = d.fromNumberId;
    if (d.customerId) params.CustomerId = d.customerId;
    if (d.leadId) params.LeadId = d.leadId;
    if (d.orderId) params.OrderId = d.orderId;
    if (d.ticketId) params.TicketId = d.ticketId;
    return { e164: dest.e164, country: dest.country, params };
  });
}

/** The call the softphone is on right now, so the UI can show who it is and link to them. */
export async function activeCallInfo(ctx: OrgContext, ref: { callId?: string; callSid?: string }) {
  needMake(ctx);
  return withTenant(ctx, async (tx) => {
    let c: Call | undefined;
    if (ref.callId && /^[0-9a-f-]{36}$/i.test(ref.callId)) [c] = await tx.select().from(calls).where(and(eq(calls.organizationId, ctx.orgId), eq(calls.id, ref.callId)));
    else if (ref.callSid) {
      const [leg] = await tx.select({ callId: callLegs.callId }).from(callLegs).where(and(eq(callLegs.organizationId, ctx.orgId), eq(callLegs.providerCallSid, ref.callSid))).limit(1);
      [c] = await tx.select().from(calls).where(and(eq(calls.organizationId, ctx.orgId), leg ? eq(calls.id, leg.callId) : eq(calls.providerCallSid, ref.callSid))).limit(1);
    }
    // Only the member on the call (or someone who can see all calls) learns who it is.
    if (!c || (c.agentMembershipId && c.agentMembershipId !== ctx.membershipId && !canReadAll(ctx))) return null;
    const visible = (await visibleCustomers(tx, ctx, [c.customerId])).has(c.customerId ?? "");
    const [cust] = c.customerId && visible ? await tx.select({ name: customers.displayName }).from(customers).where(eq(customers.id, c.customerId)) : [];
    return { id: c.id, number: c.number, direction: c.direction, other: c.direction === "inbound" ? c.fromE164 : c.toE164, customerId: visible ? c.customerId : null, customerName: cust?.name ?? null };
  });
}

/* ───────── history ───────── */

export const CALL_OUTCOMES = ["answered", "missed", "voicemail", "no_answer", "busy", "failed", "canceled"] as const;
const filtersSchema = z.object({
  direction: z.enum(["inbound", "outbound"]).optional().catch(undefined),
  outcome: z.enum(CALL_OUTCOMES).optional().catch(undefined),
  agent: z.uuid().optional().catch(undefined),
  customer: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(40).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type CallFilters = z.input<typeof filtersSchema>;

export async function listCalls(ctx: OrgContext, input: CallFilters = {}) {
  needRead(ctx);
  const f = filtersSchema.parse(input);
  return withTenant(ctx, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(calls.organizationId, ctx.orgId), callScope(ctx)];
    if (f.direction) conds.push(eq(calls.direction, f.direction));
    if (f.outcome) conds.push(eq(calls.outcome, f.outcome));
    if (f.agent) conds.push(eq(calls.agentMembershipId, f.agent));
    if (f.customer) conds.push(eq(calls.customerId, f.customer));
    if (f.q) {
      const digits = f.q.replace(/[^\d]/g, "");
      conds.push(or(ilike(customers.displayName, `%${f.q.replace(/[%_]/g, "")}%`), digits.length >= 3 ? or(ilike(calls.fromE164, `%${digits}%`), ilike(calls.toE164, `%${digits}%`)) : undefined));
    }
    const where = and(...conds);
    const rows = await tx
      .select({
        id: calls.id, number: calls.number, direction: calls.direction, status: calls.status, outcome: calls.outcome, fromE164: calls.fromE164, toE164: calls.toE164,
        startedAt: calls.startedAt, durationSec: calls.durationSec, customerId: calls.customerId, customerName: customers.displayName, agentName: user.name, hadVoicemail: calls.hadVoicemail,
        businessNumber: phoneNumbers.e164, businessLabel: phoneNumbers.label,
      })
      .from(calls)
      .leftJoin(customers, eq(customers.id, calls.customerId))
      .leftJoin(memberships, eq(memberships.id, calls.agentMembershipId))
      .leftJoin(user, eq(user.id, memberships.userId))
      .leftJoin(phoneNumbers, eq(phoneNumbers.id, calls.businessNumberId))
      .where(where).orderBy(desc(calls.startedAt)).limit(PAGE + 1).offset((f.page - 1) * PAGE);
    const page = rows.slice(0, PAGE);
    const ok = await visibleCustomers(tx, ctx, page.map((r) => r.customerId));
    return { rows: page.map((r) => (r.customerId && !ok.has(r.customerId) ? { ...r, customerId: null, customerName: null } : r)), hasMore: rows.length > PAGE, page: f.page };
  });
}
export type CallRow = Awaited<ReturnType<typeof listCalls>>["rows"][number];

export async function getCall(ctx: OrgContext, id: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await loadCall(tx, ctx, id);
    const [legs, events, notes, voicemails] = await Promise.all([
      tx.select({ id: callLegs.id, kind: callLegs.kind, target: callLegs.target, status: callLegs.status, answeredAt: callLegs.answeredAt, endedAt: callLegs.endedAt, durationSec: callLegs.durationSec, agentName: user.name })
        .from(callLegs).leftJoin(memberships, eq(memberships.id, callLegs.membershipId)).leftJoin(user, eq(user.id, memberships.userId))
        .where(eq(callLegs.callId, c.id)).orderBy(asc(callLegs.createdAt)),
      tx.select({ kind: callEvents.kind, occurredAt: callEvents.occurredAt, payload: callEvents.payload }).from(callEvents).where(and(eq(callEvents.organizationId, ctx.orgId), eq(callEvents.callId, c.id))).orderBy(asc(callEvents.occurredAt)),
      tx.select({ id: callNotes.id, body: callNotes.body, createdAt: callNotes.createdAt, author: user.name }).from(callNotes).leftJoin(user, eq(user.id, callNotes.authorUserId)).where(eq(callNotes.callId, c.id)).orderBy(asc(callNotes.createdAt)),
      tx.select().from(callVoicemails).where(and(eq(callVoicemails.callId, c.id), isNull(callVoicemails.deletedAt))),
    ]);
    const one = async <T>(q: Promise<T[]>) => (await q)[0] ?? null;
    const [customer, lead, order, ticket, agent, num, queue] = await Promise.all([
      c.customerId ? one(tx.select({ id: customers.id, name: customers.displayName }).from(customers).where(eq(customers.id, c.customerId))) : null,
      c.leadId ? one(tx.select({ id: leads.id, name: leads.title }).from(leads).where(eq(leads.id, c.leadId))) : null,
      c.orderId ? one(tx.select({ id: orders.id, number: orders.number }).from(orders).where(eq(orders.id, c.orderId))) : null,
      c.ticketId ? one(tx.select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject }).from(supportTickets).where(eq(supportTickets.id, c.ticketId))) : null,
      c.agentMembershipId ? one(tx.select({ name: user.name }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.id, c.agentMembershipId))) : null,
      c.businessNumberId ? one(tx.select({ e164: phoneNumbers.e164, label: phoneNumbers.label }).from(phoneNumbers).where(eq(phoneNumbers.id, c.businessNumberId))) : null,
      c.queueId ? one(tx.select({ name: phoneQueues.name }).from(phoneQueues).where(eq(phoneQueues.id, c.queueId))) : null,
    ]);
    const customerOk = (await visibleCustomers(tx, ctx, [c.customerId])).has(c.customerId ?? "");
    return { call: c, legs, events, notes, voicemails, customer: customerOk ? customer : null, lead, order, ticket, agent, businessNumber: num, queue, canEdit: ctx.permissions.has("calls.make") || canReadAll(ctx) };
  });
}
export type CallDetail = Awaited<ReturnType<typeof getCall>>;

export async function addCallNote(ctx: OrgContext, id: string, input: unknown) {
  needRead(ctx);
  const { body } = parseInput(z.object({ body: z.string().trim().min(1, "Write a note").max(5000) }), input);
  return withTenant(ctx, async (tx) => {
    const c = await loadCall(tx, ctx, id);
    const [n] = await tx.insert(callNotes).values({ organizationId: ctx.orgId, callId: c.id, body, authorUserId: ctx.userId }).returning({ id: callNotes.id });
    await audit(tx, ctx, { action: "call.note_added", entityType: "call", entityId: c.id, metadata: { preview: body.slice(0, 140) } });
    if (c.customerId) await audit(tx, ctx, { action: "customer.call_note", entityType: "customer", entityId: c.customerId, metadata: { callId: c.id, preview: body.slice(0, 140) } });
    return n;
  });
}

const linkSchema = z.object({
  kind: z.enum(["customer", "lead", "order", "ticket"]),
  targetId: z.uuid().nullable(),
});
const LINK_COL = { customer: "customerId", lead: "leadId", order: "orderId", ticket: "ticketId" } as const;

/** Links (or unlinks) the call to a record the caller can see. */
export async function linkCall(ctx: OrgContext, id: string, input: unknown) {
  needRead(ctx);
  const d = parseInput(linkSchema, input);
  return withTenant(ctx, async (tx) => {
    const c = await loadCall(tx, ctx, id);
    if (d.targetId) await assertVisible(tx, ctx, d.kind, d.targetId);
    const col = LINK_COL[d.kind];
    await tx.update(calls).set({ [col]: d.targetId, updatedAt: new Date() }).where(eq(calls.id, c.id));
    await audit(tx, ctx, { action: d.targetId ? "call.linked" : "call.unlinked", entityType: "call", entityId: c.id, changes: { [col]: { from: c[col], to: d.targetId } } });
    if (d.kind === "customer" && d.targetId) {
      await audit(tx, ctx, { action: c.direction === "inbound" ? "customer.call_inbound" : "customer.call_outbound", entityType: "customer", entityId: d.targetId, metadata: { callId: c.id, outcome: c.outcome, durationSec: c.durationSec, preview: `Call #${c.number} linked` } });
    }
  });
}

async function assertVisible(tx: Tx, ctx: OrgContext, kind: "customer" | "lead" | "order" | "ticket", targetId: string) {
  const p = ctx.permissions;
  let ok = false;
  if (kind === "customer") {
    const [r] = await tx.select({ owner: customers.ownerMembershipId, status: customers.status }).from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, targetId)));
    ok = !!r && r.status !== "merged" && (p.has("customers.read") || (p.has("customers.read_assigned") && r.owner === ctx.membershipId));
  } else if (kind === "lead") {
    const [r] = await tx.select({ owner: leads.ownerMembershipId }).from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, targetId)));
    ok = !!r && (p.has("leads.read") || (p.has("leads.read_assigned") && r.owner === ctx.membershipId));
  } else if (kind === "order") {
    const [r] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, targetId)));
    ok = !!r && p.has("orders.read");
  } else {
    const [r] = await tx.select({ assignee: supportTickets.assigneeMembershipId }).from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.id, targetId)));
    ok = !!r && (p.has("tickets.read") || (p.has("tickets.read_assigned") && r.assignee === ctx.membershipId));
  }
  if (!ok) throw new ValidationError(`Choose a ${kind} you have access to.`, { targetId: [`Choose a ${kind} you have access to.`] });
}

const other = (c: Call) => (c.direction === "inbound" ? c.fromE164 : c.toE164);

/** Follow-up task linked to the call's customer (and lead). */
export async function createTaskFromCall(ctx: OrgContext, id: string, input: unknown) {
  needRead(ctx);
  const d = parseInput(z.object({ title: z.string().trim().min(2, "Give the task a title").max(200), dueAt: z.string().optional() }), input);
  const c = await withTenant(ctx, (tx) => loadCall(tx, ctx, id));
  const relations = [...(c.customerId ? [{ type: "customer" as const, id: c.customerId }] : []), ...(c.leadId ? [{ type: "lead" as const, id: c.leadId }] : [])];
  const t = await createTask(ctx, { title: d.title, description: `Follow-up from call #${c.number} (${c.direction} · ${other(c)})`, dueAt: d.dueAt || undefined, relations });
  await withTenant(ctx, (tx) => audit(tx, ctx, { action: "call.task_created", entityType: "call", entityId: c.id, metadata: { taskId: t.id } }));
  return t;
}

/** Support ticket from the call (phone channel), linked back to it. */
export async function createTicketFromCall(ctx: OrgContext, id: string, input: unknown) {
  needRead(ctx);
  const d = parseInput(z.object({ subject: z.string().trim().min(1, "Enter a subject").max(200), description: z.string().trim().max(20_000).optional() }), input);
  const c = await withTenant(ctx, (tx) => loadCall(tx, ctx, id));
  if (c.ticketId) throw new ConflictError("This call already has a ticket.");
  const t = await createTicket(ctx, { subject: d.subject, description: d.description || `Created from call #${c.number} (${c.direction} · ${other(c)}).`, channel: "phone", customerId: c.customerId ?? undefined, contactPhone: other(c), orderId: c.orderId ?? undefined, leadId: c.leadId ?? undefined });
  await withTenant(ctx, async (tx) => {
    await tx.update(calls).set({ ticketId: t.id, updatedAt: new Date() }).where(and(eq(calls.organizationId, ctx.orgId), eq(calls.id, c.id)));
    await audit(tx, ctx, { action: "call.ticket_created", entityType: "call", entityId: c.id, metadata: { ticketId: t.id } });
  });
  return t;
}

/** Calls with a customer, for their profile. */
export async function customerCalls(ctx: OrgContext, customerId: string, limit = 10) {
  if (!canReadSome(ctx)) return [];
  return withTenant(ctx, (tx) => tx.select({ id: calls.id, number: calls.number, direction: calls.direction, outcome: calls.outcome, startedAt: calls.startedAt, durationSec: calls.durationSec })
    .from(calls).where(and(eq(calls.organizationId, ctx.orgId), eq(calls.customerId, customerId), callScope(ctx))).orderBy(desc(calls.startedAt)).limit(limit));
}

/* ───────── voicemail ───────── */

const vmScope = (ctx: OrgContext) => (canReadAll(ctx) ? undefined : or(eq(callVoicemails.assignedMembershipId, ctx.membershipId), callScope(ctx)));

export async function listVoicemails(ctx: OrgContext, status: "new" | "reviewed" | "archived" = "new") {
  needRead(ctx);
  return withTenant(ctx, (tx) => tx
    .select({ id: callVoicemails.id, callId: callVoicemails.callId, durationSec: callVoicemails.durationSec, status: callVoicemails.status, createdAt: callVoicemails.createdAt, assignedMembershipId: callVoicemails.assignedMembershipId,
      from: calls.fromE164, callNumber: calls.number, customerId: calls.customerId, customerName: customers.displayName, reviewedAt: callVoicemails.reviewedAt })
    .from(callVoicemails).innerJoin(calls, eq(calls.id, callVoicemails.callId)).leftJoin(customers, eq(customers.id, calls.customerId))
    .where(and(eq(callVoicemails.organizationId, ctx.orgId), isNull(callVoicemails.deletedAt), eq(callVoicemails.status, status), vmScope(ctx)))
    .orderBy(desc(callVoicemails.createdAt)).limit(200)
    .then(async (rows) => {
      const ok = await visibleCustomers(tx, ctx, rows.map((r) => r.customerId));
      return rows.map((r) => (r.customerId && !ok.has(r.customerId) ? { ...r, customerId: null, customerName: null } : r));
    }));
}

async function loadVoicemail(tx: Tx, ctx: OrgContext, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Voicemail not found.");
  const [v] = await tx.select({ vm: callVoicemails }).from(callVoicemails).innerJoin(calls, eq(calls.id, callVoicemails.callId))
    .where(and(eq(callVoicemails.organizationId, ctx.orgId), eq(callVoicemails.id, id), isNull(callVoicemails.deletedAt), vmScope(ctx)));
  if (!v) throw new NotFoundError("Voicemail not found.");
  return v.vm;
}

/** Streams the recording through the app: the browser never gets Twilio credentials or URLs. */
export async function voicemailAudio(ctx: OrgContext, id: string) {
  needRead(ctx);
  const { vm, a } = await withTenant(ctx, async (tx) => ({ vm: await loadVoicemail(tx, ctx, id), a: await activeAccount(tx, ctx.orgId) }));
  if (!a) throw new NotFoundError("Voicemail not found.");
  try {
    return await fetchRecordingAudio(subAuth(a), vm.recordingSid);
  } catch (e) {
    if (e instanceof TwilioError) throw new NotFoundError("This recording is no longer available.");
    throw e;
  }
}

export async function updateVoicemail(ctx: OrgContext, id: string, input: unknown) {
  needRead(ctx);
  const d = parseInput(z.object({ status: z.enum(["new", "reviewed", "archived"]).optional(), assignedMembershipId: z.uuid().nullable().optional() }), input);
  return withTenant(ctx, async (tx) => {
    const vm = await loadVoicemail(tx, ctx, id);
    if (d.assignedMembershipId) {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, d.assignedMembershipId), eq(memberships.status, "active")));
      if (!m) throw new ValidationError("Choose an active team member.", { assignedMembershipId: ["Choose an active team member."] });
    }
    const patch: Partial<typeof callVoicemails.$inferInsert> = {};
    if (d.status) Object.assign(patch, { status: d.status, ...(d.status !== "new" ? { reviewedByUserId: ctx.userId, reviewedAt: new Date() } : { reviewedByUserId: null, reviewedAt: null }) });
    if (d.assignedMembershipId !== undefined) patch.assignedMembershipId = d.assignedMembershipId;
    if (!Object.keys(patch).length) return;
    await tx.update(callVoicemails).set(patch).where(eq(callVoicemails.id, vm.id));
    await audit(tx, ctx, { action: "call.voicemail_updated", entityType: "call", entityId: vm.callId, changes: { ...(d.status ? { status: { from: vm.status, to: d.status } } : {}), ...(d.assignedMembershipId !== undefined ? { assignee: { from: vm.assignedMembershipId, to: d.assignedMembershipId } } : {}) } });
  });
}

/** Deletes the recording at Twilio and hides the voicemail (the call record stays). */
export async function deleteVoicemail(ctx: OrgContext, id: string) {
  needRead(ctx);
  if (!canReadAll(ctx) && !ctx.permissions.has("phone.manage")) throw new ForbiddenError("Only managers can delete voicemail.");
  const { vm, a } = await withTenant(ctx, async (tx) => ({ vm: await loadVoicemail(tx, ctx, id), a: await activeAccount(tx, ctx.orgId) }));
  if (a) {
    try {
      await deleteRecording(subAuth(a), vm.recordingSid);
    } catch (e) {
      if (!(e instanceof TwilioError && e.status === 404)) throw new ConflictError("Twilio couldn't delete the recording. Try again.");
    }
  }
  await withTenant(ctx, async (tx) => {
    await tx.update(callVoicemails).set({ deletedAt: new Date() }).where(eq(callVoicemails.id, vm.id));
    await audit(tx, ctx, { action: "call.voicemail_deleted", entityType: "call", entityId: vm.callId, metadata: { recordingSid: vm.recordingSid } });
  });
}

export async function countNewVoicemails(ctx: OrgContext) {
  if (!canReadSome(ctx)) return 0;
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select({ n: count() }).from(callVoicemails).innerJoin(calls, eq(calls.id, callVoicemails.callId))
      .where(and(eq(callVoicemails.organizationId, ctx.orgId), eq(callVoicemails.status, "new"), isNull(callVoicemails.deletedAt), vmScope(ctx)));
    return Number(r.n);
  });
}

/* ───────── dashboard ───────── */

export async function getPhoneStats(ctx: OrgContext, days = 7) {
  needRead(ctx);
  const since = new Date(Date.now() - days * 86_400_000);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return withTenant(ctx, async (tx) => {
    const base = and(eq(calls.organizationId, ctx.orgId), gte(calls.startedAt, since), callScope(ctx));
    const [t] = await tx.select({
      total: count(),
      inbound: sql<number>`count(*) filter (where ${calls.direction} = 'inbound')::int`,
      outbound: sql<number>`count(*) filter (where ${calls.direction} = 'outbound')::int`,
      answered: sql<number>`count(*) filter (where ${calls.answeredAt} is not null)::int`,
      missed: sql<number>`count(*) filter (where ${calls.outcome} = 'missed')::int`,
      voicemail: sql<number>`count(*) filter (where ${calls.outcome} = 'voicemail')::int`,
      inboundAnswered: sql<number>`count(*) filter (where ${calls.direction} = 'inbound' and ${calls.answeredAt} is not null)::int`,
      avgTalk: sql<number>`coalesce(avg(${calls.durationSec}) filter (where ${calls.answeredAt} is not null), 0)::int`,
      avgWait: sql<number>`coalesce(avg(extract(epoch from (${calls.answeredAt} - ${calls.startedAt}))) filter (where ${calls.direction} = 'inbound' and ${calls.answeredAt} is not null), 0)::int`,
    }).from(calls).where(base);
    const byAgent = await tx.select({ name: user.name, calls: count(), talk: sql<number>`coalesce(sum(${calls.durationSec}), 0)::int` })
      .from(calls).innerJoin(memberships, eq(memberships.id, calls.agentMembershipId)).innerJoin(user, eq(user.id, memberships.userId))
      .where(and(base, sql`${calls.answeredAt} is not null`)).groupBy(user.name).orderBy(desc(count())).limit(10);
    const spend = canReadAll(ctx) ? (await tx.select({ s: sql<number>`coalesce(sum(${phoneUsageRecords.priceMicros}), 0)::bigint`, cur: sql<string | null>`max(${phoneUsageRecords.currency})` })
      .from(phoneUsageRecords).where(and(eq(phoneUsageRecords.organizationId, ctx.orgId), gte(phoneUsageRecords.recordedAt, today))))[0] : null;
    const live = await tx.select({ id: calls.id, number: calls.number, direction: calls.direction, other: sql<string>`case when ${calls.direction} = 'inbound' then ${calls.fromE164} else ${calls.toE164} end`, status: calls.status, startedAt: calls.startedAt, agentName: user.name })
      .from(calls).leftJoin(memberships, eq(memberships.id, calls.agentMembershipId)).leftJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(calls.organizationId, ctx.orgId), isNull(calls.endedAt), inArray(calls.status, ["queued", "ringing", "in_progress"]), gte(calls.startedAt, new Date(Date.now() - 4 * 3_600_000)), callScope(ctx)))
      .orderBy(desc(calls.startedAt)).limit(20);
    return {
      days, ...t, total: Number(t.total),
      answerRate: t.inbound ? Math.round((t.inboundAnswered / t.inbound) * 100) : null,
      byAgent: byAgent.map((r) => ({ ...r, calls: Number(r.calls) })),
      spendToday: spend ? { micros: Number(spend.s), currency: spend.cur ?? "USD" } : null,
      live,
    };
  });
}

export async function queueMembershipsFor(ctx: OrgContext) {
  return withTenant(ctx, (tx) => tx.select({ queueId: phoneQueueMembers.queueId }).from(phoneQueueMembers).where(and(eq(phoneQueueMembers.organizationId, ctx.orgId), eq(phoneQueueMembers.membershipId, ctx.membershipId))));
}
