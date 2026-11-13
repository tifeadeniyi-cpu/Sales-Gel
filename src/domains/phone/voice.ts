import "server-only";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { customerPhones, customers } from "@/domains/customers/schema";
import { normalizePhone } from "@/domains/customers/normalize";
import { memberships, organizations } from "@/domains/identity/schema";
import { integrationRoutes } from "@/domains/integrations/schema";
import { notify } from "@/domains/platform/notifications";
import { leads } from "@/domains/sales/schema";
import { orders } from "@/domains/commerce/schema";
import { supportTickets } from "@/domains/support/schema";
import { isWorkingTime } from "@/domains/support/business-time";
import { loadCalendar } from "@/domains/support/sla";
import { audit, emit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { withScope } from "@/server/db/tenant";
import { enqueue } from "@/server/jobs/queue";
import type { JobContext } from "@/server/jobs/registry";
import { logger } from "@/server/logger";
import { newId } from "@/lib/ids";
import { identityFor, membershipFromIdentity, ROUTE_TELEPHONY, subAuth, voiceUrls } from "./account";
import { checkDestination } from "./dialing";
import { callEvents, callLegs, calls, callVoicemails, phoneAgents, phoneNumbers, phoneQueueMembers, phoneQueues, phoneUsageRecords, telecomAccounts } from "./schema";
import { fetchCall, listChildCalls, twiml, verifySignature } from "./twilio";

type Account = typeof telecomAccounts.$inferSelect;
type Call = typeof calls.$inferSelect;
export type Params = Record<string, string>;

/* ───────── entry: resolve + verify ───────── */

export async function accountFor(accountId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const [route] = await withScope({}, (tx) => tx.select().from(integrationRoutes).where(and(eq(integrationRoutes.provider, ROUTE_TELEPHONY), eq(integrationRoutes.externalAccountId, accountId))));
  if (!route) return null;
  const a = await withScope({ orgId: route.organizationId }, async (tx) => (await tx.select().from(telecomAccounts).where(eq(telecomAccounts.id, accountId)))[0]);
  return a && a.status !== "closed" ? a : null;
}

/** Every Twilio callback is signed with the subaccount's auth token; unsigned or wrong-account requests are refused. */
export async function verified(accountId: string, url: string, params: Params, signature: string | null) {
  const a = await accountFor(accountId);
  if (!a) return null;
  if (params.AccountSid && params.AccountSid !== a.providerAccountSid) return null;
  return verifySignature(subAuth(a).token, url, params, signature) ? a : null;
}

const SAY_UNAVAILABLE = "Sorry, this number isn't available right now. Goodbye.";
const xml = (...v: string[]) => twiml.doc(...v);

/* ───────── helpers ───────── */

async function matchCustomer(tx: Tx, orgId: string, phone: string) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  const rows = await tx.select({ id: customers.id }).from(customerPhones).innerJoin(customers, eq(customers.id, customerPhones.customerId))
    .where(and(eq(customerPhones.organizationId, orgId), eq(customerPhones.e164, e164), sql`${customers.status} <> 'merged'`)).limit(2);
  // Only an unambiguous match is linked; two customers with the same number are left for a person to choose.
  return rows.length === 1 ? rows[0].id : null;
}

async function memberCanCall(tx: Tx, orgId: string, membershipId: string) {
  const [m] = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from memberships m join role_permissions rp on rp.role_id = m.role_id
      where m.organization_id = ${orgId} and m.id = ${membershipId} and m.status = 'active' and rp.permission_key = 'calls.make') as ok`);
  return !!m?.ok;
}

/** Spend so far today (UTC), in micros of the account currency, from provider-reported usage. */
async function spentToday(tx: Tx, orgId: string) {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const [r] = await tx.select({ s: sql<number>`coalesce(sum(${phoneUsageRecords.priceMicros}), 0)::bigint` }).from(phoneUsageRecords).where(and(eq(phoneUsageRecords.organizationId, orgId), gte(phoneUsageRecords.recordedAt, start)));
  return Number(r.s);
}

async function availableAgents(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await tx.select({ membershipId: phoneAgents.membershipId }).from(phoneAgents)
    .where(and(eq(phoneAgents.organizationId, orgId), inArray(phoneAgents.membershipId, ids), eq(phoneAgents.status, "available"), isNull(phoneAgents.activeCallId)));
  const ok: string[] = [];
  for (const r of rows) if (await memberCanCall(tx, orgId, r.membershipId)) ok.push(r.membershipId);
  return ids.filter((i) => ok.includes(i));
}

function voicemail(a: Account, call: { id: string }) {
  const u = voiceUrls(a.id);
  return xml(
    twiml.say(a.settings.voicemailGreeting),
    twiml.record({ maxLength: 120, playBeep: true, trim: "trim-silence", action: `${u.base}/voicemail-done?call=${call.id}`, recordingStatusCallback: `${u.base}/recording?call=${call.id}`, recordingStatusCallbackEvent: "completed", recordingStatusCallbackMethod: "POST" }),
    twiml.say("We didn't get a message. Goodbye."), twiml.hangup(),
  );
}

function ringAgents(a: Account, call: { id: string }, ids: string[], timeout: number, attempt: number | null) {
  const u = voiceUrls(a.id);
  const action = `${u.base}/dial-result?call=${call.id}${attempt !== null ? `&attempt=${attempt}` : ""}`;
  return xml(twiml.dial({ timeout, action, method: "POST", answerOnBridge: true },
    ...ids.map((m) => twiml.client({ statusCallback: `${u.status}?call=${call.id}&leg=agent&m=${m}`, statusCallbackEvent: "initiated ringing answered completed", statusCallbackMethod: "POST" }, identityFor(m), { callId: call.id }))));
}

/* ───────── voice URL: outbound from the softphone, or inbound to a business number ───────── */

export async function handleVoice(a: Account, p: Params): Promise<string> {
  const orgId = a.organizationId;
  return withScope({ orgId }, async (tx) => {
    const sid = p.CallSid;
    // Re-delivery of the same webhook: answer consistently without creating a second call.
    const [already] = await tx.select().from(calls).where(and(eq(calls.accountId, a.id), eq(calls.providerCallSid, sid)));
    if (p.From?.startsWith("client:")) return outbound(tx, a, p, already);
    return inbound(tx, a, p, already);
  });
}

async function outbound(tx: Tx, a: Account, p: Params, already: Call | undefined): Promise<string> {
  const orgId = a.organizationId;
  const membershipId = membershipFromIdentity(p.From.slice(7));
  if (!membershipId || !(await memberCanCall(tx, orgId, membershipId))) return xml(twiml.say("You're not allowed to make calls from this workspace."), twiml.hangup());
  if (a.status !== "active") return xml(twiml.say("Calling is paused for this workspace."), twiml.hangup());
  const dest = checkDestination(p.To ?? "", a.settings);
  if (!dest.ok) return xml(twiml.say(dest.reason), twiml.hangup());
  if (a.settings.dailySpendLimitCents !== null && (await spentToday(tx, orgId)) >= a.settings.dailySpendLimitCents * 10_000) {
    return xml(twiml.say("Today's calling limit for this workspace has been reached."), twiml.hangup());
  }
  const numbers = await tx.select().from(phoneNumbers).where(and(eq(phoneNumbers.organizationId, orgId), eq(phoneNumbers.status, "active"))).orderBy(asc(phoneNumbers.createdAt));
  const from = numbers.find((n) => n.id === p.CallerId) ?? numbers[0];
  if (!from) return xml(twiml.say("This workspace has no phone number to call from."), twiml.hangup());
  let call = already;
  if (!call) {
    const id = newId();
    const link = async <T extends { id: unknown }>(table: typeof leads | typeof orders | typeof supportTickets, v: string | undefined) => {
      if (!v || !/^[0-9a-f-]{36}$/i.test(v)) return null;
      const [r] = await tx.select({ id: table.id }).from(table).where(and(eq(table.organizationId, orgId), eq(table.id, v)));
      return (r as T | undefined)?.id as string | null ?? null;
    };
    let customerId: string | null = null;
    if (p.CustomerId && /^[0-9a-f-]{36}$/i.test(p.CustomerId)) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, orgId), eq(customers.id, p.CustomerId)));
      customerId = c?.id ?? null;
    }
    customerId ??= await matchCustomer(tx, orgId, dest.e164);
    [call] = await tx.insert(calls).values({
      id, organizationId: orgId, number: await nextNumber(tx, orgId, "call"), accountId: a.id, direction: "outbound", providerCallSid: p.CallSid, fromE164: from.e164, toE164: dest.e164,
      businessNumberId: from.id, customerId, agentMembershipId: membershipId, status: "ringing",
      leadId: await link(leads, p.LeadId), orderId: await link(orders, p.OrderId), ticketId: await link(supportTickets, p.TicketId),
    }).returning();
    await tx.insert(callLegs).values({ organizationId: orgId, callId: call.id, providerCallSid: p.CallSid, kind: "agent", target: p.From, membershipId, status: "in_progress" }).onConflictDoNothing();
    await tx.insert(phoneAgents).values({ organizationId: orgId, membershipId, status: "busy", activeCallId: call.id }).onConflictDoUpdate({ target: [phoneAgents.organizationId, phoneAgents.membershipId], set: { activeCallId: call.id, updatedAt: new Date() } });
    await emit(tx, orgId, "call.started", { callId: call.id, direction: "outbound" });
  }
  const u = voiceUrls(a.id);
  return xml(twiml.dial({ callerId: from.e164, answerOnBridge: true, timeLimit: 14_400, action: `${u.base}/dial-result?call=${call.id}`, method: "POST" },
    twiml.number({ statusCallback: `${u.status}?call=${call.id}&leg=pstn`, statusCallbackEvent: "initiated ringing answered completed", statusCallbackMethod: "POST" }, dest.e164)));
}

async function inbound(tx: Tx, a: Account, p: Params, already: Call | undefined): Promise<string> {
  const orgId = a.organizationId;
  const [num] = await tx.select().from(phoneNumbers).where(and(eq(phoneNumbers.organizationId, orgId), eq(phoneNumbers.accountId, a.id), eq(phoneNumbers.e164, p.To ?? ""), eq(phoneNumbers.status, "active")));
  if (!num || a.status !== "active") return xml(twiml.say(SAY_UNAVAILABLE), twiml.hangup());
  let call = already;
  if (!call) {
    [call] = await tx.insert(calls).values({
      id: newId(), organizationId: orgId, number: await nextNumber(tx, orgId, "call"), accountId: a.id, direction: "inbound", providerCallSid: p.CallSid,
      fromE164: normalizePhone(p.From ?? "") ?? (p.From || "unknown"), toE164: num.e164, businessNumberId: num.id, customerId: p.From ? await matchCustomer(tx, orgId, p.From) : null, status: "ringing",
      queueId: num.routing.type === "queue" ? num.routing.queueId ?? null : null,
    }).returning();
    await tx.insert(callLegs).values({ organizationId: orgId, callId: call.id, providerCallSid: p.CallSid, kind: "customer", target: call.fromE164, status: "ringing" }).onConflictDoNothing();
    await emit(tx, orgId, "call.started", { callId: call.id, direction: "inbound" });
  }
  // Business hours (shared with support SLAs) decide after-hours handling.
  if (a.settings.useBusinessHours && a.settings.afterHours === "voicemail" && !isWorkingTime(new Date(), await loadCalendar(tx, orgId))) return voicemail(a, call);
  return route(tx, a, call, num.routing, 0);
}

/** Rings the number's destination; `attempt` walks a round-robin queue one member at a time. */
async function route(tx: Tx, a: Account, call: Call, routing: { type: string; queueId?: string | null; membershipId?: string | null }, attempt: number): Promise<string> {
  const orgId = a.organizationId;
  if (routing.type === "agent" && routing.membershipId) {
    const ok = await availableAgents(tx, orgId, [routing.membershipId]);
    return ok.length && attempt === 0 ? ringAgents(a, call, ok, a.settings.ringTimeoutSec, null) : voicemail(a, call);
  }
  if (routing.type === "queue" && routing.queueId) {
    const [q] = await tx.select().from(phoneQueues).where(and(eq(phoneQueues.organizationId, orgId), eq(phoneQueues.id, routing.queueId)));
    if (!q) return voicemail(a, call);
    const members = await tx.select().from(phoneQueueMembers).where(eq(phoneQueueMembers.queueId, q.id)).orderBy(sql`${phoneQueueMembers.lastOfferedAt} asc nulls first`, asc(phoneQueueMembers.position));
    const ready = await availableAgents(tx, orgId, members.map((m) => m.membershipId));
    const fallback = () => (q.fallback === "voicemail" ? voicemail(a, call) : xml(twiml.say("Sorry, no one is available to take your call. Please try again later."), twiml.hangup()));
    if (q.strategy === "simultaneous") return attempt === 0 && ready.length ? ringAgents(a, call, ready, q.ringTimeoutSec, null) : fallback();
    // Round robin: least recently offered first, one at a time, up to everyone available once.
    // Offering someone moves them to the back of the order, so the head is always the next person.
    const next = ready[0];
    if (!next || attempt >= ready.length) return fallback();
    await tx.update(phoneQueueMembers).set({ lastOfferedAt: new Date() }).where(and(eq(phoneQueueMembers.queueId, q.id), eq(phoneQueueMembers.membershipId, next)));
    return ringAgents(a, call, [next], q.ringTimeoutSec, attempt);
  }
  return voicemail(a, call);
}

/** <Dial action>: what happens after ringing ends. Unanswered inbound calls move on (next agent, or voicemail). */
export async function handleDialResult(a: Account, p: Params, q: URLSearchParams): Promise<string> {
  const orgId = a.organizationId;
  return withScope({ orgId }, async (tx) => {
    const [call] = await tx.select().from(calls).where(and(eq(calls.organizationId, orgId), eq(calls.id, q.get("call") ?? "")));
    if (!call) return xml(twiml.hangup());
    const answered = p.DialCallStatus === "completed" || p.DialCallStatus === "answered";
    if (answered || call.direction === "outbound") {
      if (call.direction === "outbound" && !answered) {
        const st = p.DialCallStatus === "busy" ? "busy" : p.DialCallStatus === "no-answer" ? "no_answer" : p.DialCallStatus === "canceled" ? "canceled" : "failed";
        await tx.update(calls).set({ outcome: st === "no_answer" ? "no_answer" : st, updatedAt: new Date() }).where(eq(calls.id, call.id));
      }
      return xml(twiml.hangup());
    }
    const [num] = call.businessNumberId ? await tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, call.businessNumberId)) : [];
    const attempt = Number(q.get("attempt") ?? "-1");
    return route(tx, a, call, attempt >= 0 ? (num?.routing ?? { type: "voicemail" }) : { type: "voicemail" }, attempt >= 0 ? attempt + 1 : 1);
  });
}

export function voicemailDone() {
  return xml(twiml.say("Thank you. We'll get back to you soon. Goodbye."), twiml.hangup());
}

/* ───────── status callbacks ───────── */

const RANK: Record<string, number> = { queued: 0, initiated: 1, ringing: 2, "in-progress": 3, answered: 3, completed: 4, busy: 4, "no-answer": 4, failed: 4, canceled: 4 };
const CANON: Record<string, Call["status"]> = { queued: "queued", initiated: "queued", ringing: "ringing", "in-progress": "in_progress", answered: "in_progress", completed: "completed", busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "canceled" };
const FINAL = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

/**
 * Status callback for any leg. Idempotent (unique event key) and order-safe: a leg's status only
 * moves forward, and the overall call is finalised from the parent leg.
 */
export async function handleStatus(a: Account, p: Params, q: URLSearchParams) {
  const orgId = a.organizationId;
  const status = p.CallStatus ?? p.DialCallStatus;
  if (!p.CallSid || !status) return { ok: false };
  return withScope({ orgId }, async (tx) => {
    let call: Call | undefined;
    const qCall = q.get("call");
    if (qCall) [call] = await tx.select().from(calls).where(and(eq(calls.organizationId, orgId), eq(calls.id, qCall)));
    call ??= (await tx.select().from(calls).where(and(eq(calls.accountId, a.id), eq(calls.providerCallSid, p.ParentCallSid || p.CallSid))))[0];
    if (!call) return { ok: true, ignored: true };
    const seq = /^\d{1,9}$/.test(p.SequenceNumber ?? "") ? p.SequenceNumber : "";
    const seqNum = seq ? Number(seq) : 0;
    const at = p.Timestamp && !Number.isNaN(Date.parse(p.Timestamp)) ? new Date(p.Timestamp) : new Date();
    const inserted = await tx.insert(callEvents).values({ organizationId: orgId, callId: call.id, eventKey: `${p.CallSid}:${status}:${seq}`, kind: status, payload: pick(p), occurredAt: at }).onConflictDoNothing().returning({ id: callEvents.id });
    if (!inserted.length) return { ok: true, duplicate: true };

    const isParent = p.CallSid === call.providerCallSid;
    const legKind = isParent ? (call.direction === "inbound" ? "customer" : "agent") : (q.get("leg") === "agent" ? "agent" : "pstn");
    const membershipId = q.get("m") && /^[0-9a-f-]{36}$/i.test(q.get("m")!) ? q.get("m") : null;
    await tx.insert(callLegs).values({ organizationId: orgId, callId: call.id, providerCallSid: p.CallSid, kind: legKind, target: p.To ?? "", membershipId, status: CANON[status] ?? "queued", lastSequence: seqNum })
      .onConflictDoNothing();
    const [leg] = await tx.select().from(callLegs).where(and(eq(callLegs.callId, call.id), eq(callLegs.providerCallSid, p.CallSid))).for("update");
    const prevRank = RANK[Object.entries(CANON).find(([, v]) => v === leg.status)?.[0] ?? "queued"] ?? 0;
    if ((RANK[status] ?? 0) >= prevRank) {
      await tx.update(callLegs).set({
        status: CANON[status] ?? leg.status, lastSequence: Math.max(leg.lastSequence, seqNum),
        ...(status === "in-progress" || status === "answered" ? { answeredAt: leg.answeredAt ?? at } : {}),
        ...(FINAL.has(status) ? { endedAt: at, durationSec: p.CallDuration ? Number(p.CallDuration) : leg.durationSec } : {}),
      }).where(eq(callLegs.id, leg.id));
    }

    const patch: Partial<typeof calls.$inferInsert> = { lastEventAt: at, updatedAt: new Date() };
    const answeredNow = status === "in-progress" || status === "answered";
    // The customer is actually talking to someone when the agent leg (inbound) or the PSTN leg (outbound) answers.
    if (answeredNow && ((call.direction === "inbound" && legKind === "agent") || (call.direction === "outbound" && legKind === "pstn"))) {
      patch.answeredAt = call.answeredAt ?? at;
      patch.status = "in_progress";
      if (call.direction === "inbound" && membershipId) {
        patch.agentMembershipId = membershipId;
        await tx.insert(phoneAgents).values({ organizationId: orgId, membershipId, status: "busy", activeCallId: call.id }).onConflictDoUpdate({ target: [phoneAgents.organizationId, phoneAgents.membershipId], set: { activeCallId: call.id, updatedAt: new Date() } });
      }
    }
    if (call.direction === "outbound" && legKind === "pstn" && FINAL.has(status) && status !== "completed") patch.outcome = CANON[status];
    if (isParent && FINAL.has(status) && !call.endedAt) {
      const answered = !!(patch.answeredAt ?? call.answeredAt);
      patch.endedAt = at;
      patch.durationSec = answered && (patch.answeredAt ?? call.answeredAt) ? Math.max(0, Math.round((at.getTime() - (patch.answeredAt ?? call.answeredAt)!.getTime()) / 1000)) : 0;
      patch.status = answered ? "completed" : call.direction === "outbound" ? ((patch.outcome ?? call.outcome) as Call["status"] | null) ?? CANON[status] : CANON[status] === "completed" ? "no_answer" : CANON[status];
      if (!["queued", "ringing", "in_progress", "completed", "busy", "no_answer", "failed", "canceled"].includes(patch.status!)) patch.status = "failed";
      patch.outcome = call.outcome ?? (answered ? "answered" : call.hadVoicemail ? "voicemail" : call.direction === "inbound" ? "missed" : (patch.outcome ?? "no_answer"));
      await tx.update(phoneAgents).set({ activeCallId: null, updatedAt: new Date() }).where(and(eq(phoneAgents.organizationId, orgId), eq(phoneAgents.activeCallId, call.id)));
      await enqueue(tx, orgId, "phone.usage", { callId: call.id }, { runAt: new Date(Date.now() + 90_000), idempotencyKey: `phone-usage:${call.id}` });
    }
    // An agent whose own leg ended (declined, timed out, hung up) is free again even if the call continues.
    if (!isParent && legKind === "agent" && FINAL.has(status) && membershipId) {
      await tx.update(phoneAgents).set({ activeCallId: null, updatedAt: new Date() }).where(and(eq(phoneAgents.organizationId, orgId), eq(phoneAgents.membershipId, membershipId), eq(phoneAgents.activeCallId, call.id)));
    }
    await tx.update(calls).set(patch).where(eq(calls.id, call.id));
    if (patch.endedAt) await afterCall(tx, orgId, { ...call, ...patch } as Call);
    return { ok: true };
  });
}

const KEEP = ["CallSid", "ParentCallSid", "CallStatus", "DialCallStatus", "Direction", "From", "To", "CallDuration", "SequenceNumber", "Timestamp", "AnsweredBy", "ErrorCode", "SipResponseCode"];
const pick = (p: Params) => Object.fromEntries(KEEP.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));

async function targetsFor(tx: Tx, call: Call) {
  if (call.queueId) return (await tx.select({ m: phoneQueueMembers.membershipId }).from(phoneQueueMembers).where(eq(phoneQueueMembers.queueId, call.queueId))).map((r) => r.m);
  if (call.businessNumberId) {
    const [n] = await tx.select({ routing: phoneNumbers.routing }).from(phoneNumbers).where(eq(phoneNumbers.id, call.businessNumberId));
    if (n?.routing.type === "agent" && n.routing.membershipId) return [n.routing.membershipId];
  }
  return [];
}

async function notifyMembers(tx: Tx, orgId: string, ids: string[], n: { type: string; title: string; body?: string; link: string; entityId: string }) {
  if (!ids.length) return;
  const rows = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, orgId), inArray(memberships.id, ids), eq(memberships.status, "active")));
  for (const r of rows) await notify(tx, { orgId, recipientUserId: r.userId, type: n.type, title: n.title, body: n.body, link: n.link, entityType: "call", entityId: n.entityId });
}

async function afterCall(tx: Tx, orgId: string, call: Call) {
  const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  const link = `/o/${org.slug}/phone/calls/${call.id}`;
  if (call.customerId) {
    await audit(tx, { orgId, userId: null }, { action: call.direction === "inbound" ? "customer.call_inbound" : "customer.call_outbound", entityType: "customer", entityId: call.customerId, metadata: { callId: call.id, outcome: call.outcome, durationSec: call.durationSec, preview: `${call.direction === "inbound" ? "Call from" : "Call to"} ${call.direction === "inbound" ? call.fromE164 : call.toE164} · ${call.outcome}` } });
  }
  if (call.direction === "inbound" && call.outcome === "missed") {
    await notifyMembers(tx, orgId, await targetsFor(tx, call), { type: "call.missed", title: `Missed call from ${call.fromE164}`, link, entityId: call.id });
  }
  await emit(tx, orgId, call.outcome === "missed" ? "call.missed" : "call.completed", { callId: call.id, outcome: call.outcome });
}

/** recordingStatusCallback for voicemail. */
export async function handleRecording(a: Account, p: Params, q: URLSearchParams) {
  const orgId = a.organizationId;
  if (p.RecordingStatus && p.RecordingStatus !== "completed") return { ok: true };
  return withScope({ orgId }, async (tx) => {
    const [call] = await tx.select().from(calls).where(and(eq(calls.organizationId, orgId), eq(calls.id, q.get("call") ?? "")));
    if (!call || !p.RecordingSid) return { ok: true, ignored: true };
    const ins = await tx.insert(callVoicemails).values({ organizationId: orgId, callId: call.id, recordingSid: p.RecordingSid, durationSec: p.RecordingDuration ? Number(p.RecordingDuration) : null }).onConflictDoNothing().returning({ id: callVoicemails.id });
    if (!ins.length) return { ok: true, duplicate: true };
    await tx.update(calls).set({ hadVoicemail: 1, outcome: "voicemail", updatedAt: new Date() }).where(eq(calls.id, call.id));
    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
    await notifyMembers(tx, orgId, await targetsFor(tx, call), { type: "call.voicemail", title: `New voicemail from ${call.fromE164}`, body: p.RecordingDuration ? `${p.RecordingDuration}s` : undefined, link: `/o/${org.slug}/phone/voicemail`, entityId: call.id });
    await emit(tx, orgId, "call.voicemail", { callId: call.id, voicemailId: ins[0].id });
    return { ok: true };
  });
}

/* ───────── usage (job) ───────── */

const micros = (price: string | null) => (price ? Math.round(Math.abs(Number(price)) * 1_000_000) : null);

/** After a call ends, records Twilio's billed price for each leg (Twilio prices calls shortly after completion). */
export async function runUsageFetch(job: JobContext) {
  const { callId } = job.payload as { callId: string };
  const [a, call] = await withScope({ orgId: job.orgId }, async (tx) => {
    const [c] = await tx.select().from(calls).where(and(eq(calls.organizationId, job.orgId), eq(calls.id, callId)));
    const [acct] = c ? await tx.select().from(telecomAccounts).where(eq(telecomAccounts.id, c.accountId)) : [];
    return [acct, c] as const;
  });
  if (!a || !call) return;
  const auth = subAuth(a);
  const parent = await fetchCall(auth, call.providerCallSid);
  const children = await listChildCalls(auth, call.providerCallSid);
  const legs = [parent, ...children];
  if (legs.some((l) => l.price === null && FINAL.has(l.status))) {
    // Not priced yet: try again later (bounded by job attempts).
    throw new Error("Twilio hasn't priced this call yet");
  }
  await withScope({ orgId: job.orgId }, async (tx) => {
    let total = 0;
    let currency = "USD";
    for (const l of legs) {
      const m = micros(l.price);
      if (m === null) continue;
      total += m;
      currency = (l.price_unit ?? "USD").toUpperCase();
      const category = l.direction?.startsWith("outbound") ? (l.sid === call.providerCallSid ? "client" : "voice_outbound") : "voice_inbound";
      await tx.insert(phoneUsageRecords).values({ organizationId: job.orgId, callId: call.id, providerSid: l.sid, category, priceMicros: m, currency, recordedAt: l.start_time ? new Date(l.start_time) : new Date() }).onConflictDoNothing();
    }
    await tx.update(calls).set({ priceMicros: total, priceCurrency: currency }).where(eq(calls.id, call.id));
  });
  logger.info({ callId, legs: legs.length }, "phone usage recorded");
}
