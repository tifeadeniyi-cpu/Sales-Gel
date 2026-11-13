import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createCustomer } from "@/domains/customers/service";
import { listNotifications } from "@/domains/platform/notifications";
import { enablePhone, getPhoneSetup, purchaseNumber, saveQueue, setAvailability, updateNumber, updatePhoneSettings } from "@/domains/phone/account";
import {
  addCallNote, createTicketFromCall, deleteVoicemail, getCall, getPhoneStats, linkCall, listCalls, listVoicemails, prepareCall, updateVoicemail, voiceToken, voicemailAudio,
} from "@/domains/phone/calls";
import { callEvents, calls, phoneAgents, phoneUsageRecords } from "@/domains/phone/schema";
import { signatureFor } from "@/domains/phone/twilio";
import { handleDialResult, handleRecording, handleStatus, handleVoice, runUsageFetch, verified } from "@/domains/phone/voice";
import { getTicket } from "@/domains/support/service";
import { appUrl } from "@/server/app-url";
import { withScope } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];
type Responder = (url: string, init: RequestInit) => unknown;
const hex = (n: number) => randomBytes(n).toString("hex");
const randomUs = () => `+1512${String(2_000_000 + Math.floor(Math.random() * 7_999_999))}`;
const CALLEE = "+14158675309";

function stubFetch(routes: Record<string, Responder>) {
  const seen: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({ url, method, body: typeof init.body === "string" ? init.body : "" });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!key) return new Response(JSON.stringify({ message: `unexpected ${method} ${url}` }), { status: 500 });
    const out = routes[key](url, init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return seen;
}

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.TWILIO_ACCOUNT_SID = `AC${hex(16)}`;
  process.env.TWILIO_AUTH_TOKEN = hex(16);
});
afterEach(() => vi.unstubAllGlobals());

/** A workspace with phone enabled on a (stubbed) Twilio subaccount and one bought number. */
async function setup(name = "PhoneCo") {
  const { ctx } = await createOrgWithOwner(name);
  const sub = { sid: `AC${hex(16)}`, token: hex(16) };
  const e164 = randomUs();
  stubFetch({
    "POST https://api.twilio.com/2010-04-01/Accounts.json": () => ({ sid: sub.sid, auth_token: sub.token, status: "active" }),
    "/Keys.json": () => ({ sid: `SK${hex(16)}`, secret: hex(16) }),
    "/Applications.json": () => ({ sid: `AP${hex(16)}` }),
    "/IncomingPhoneNumbers.json": () => ({ sid: `PN${hex(16)}`, phone_number: e164, friendly_name: e164, capabilities: { voice: true, sms: true, mms: false } }),
  });
  const { id: accountId } = await enablePhone(ctx);
  const num = await purchaseNumber(ctx, { e164, label: "Main line" });
  await updatePhoneSettings(ctx, { allowedCountries: ["US", "CA"], blockPremium: true, dailySpendLimitCents: 2000, ringTimeoutSec: 20, voicemailGreeting: "Please leave a message.", afterHours: "voicemail", useBusinessHours: false });
  vi.unstubAllGlobals();
  const account = (await verifiedFor(accountId, sub.token, "voice", {}, { AccountSid: sub.sid }))!;
  return { ctx, sub, accountId, account, e164, numberId: num.id };
}

/** Builds a Twilio-signed webhook and returns the verified account (or null). */
async function verifiedFor(accountId: string, token: string, hook: string, query: Record<string, string>, params: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  const url = `${appUrl()}/api/telephony/${accountId}/${hook}${qs ? `?${qs}` : ""}`;
  return verified(accountId, url, params, signatureFor(token, url, params));
}

type Setup = Awaited<ReturnType<typeof setup>>;
const callSid = () => `CA${hex(16)}`;
const q = (o: Record<string, string>) => new URLSearchParams(o);

async function callRow(orgId: string, providerCallSid: string) {
  return withScope({ orgId }, async (tx) => (await tx.select().from(calls).where(eq(calls.providerCallSid, providerCallSid)))[0]);
}
async function agentRow(orgId: string, membershipId: string) {
  return withScope({ orgId }, async (tx) => (await tx.select().from(phoneAgents).where(and(eq(phoneAgents.organizationId, orgId), eq(phoneAgents.membershipId, membershipId))))[0]);
}

function inbound(s: Setup, from = "+12125550100", sid = callSid()) {
  return { sid, p: { CallSid: sid, AccountSid: s.sub.sid, From: from, To: s.e164, CallStatus: "ringing", Direction: "inbound" } };
}

describe("phone setup", () => {
  it("only phone admins enable phone and buy numbers; setup exposes no secrets", async () => {
    const s = await setup();
    const { ctx: rep } = await addMember(s.ctx, "sales_rep");
    await expect(enablePhone(rep)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(purchaseNumber(rep, { e164: randomUs() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(enablePhone(s.ctx)).rejects.toBeInstanceOf(ConflictError);
    const view = await getPhoneSetup(s.ctx);
    expect(view.account?.status).toBe("active");
    expect(view.numbers).toEqual([expect.objectContaining({ e164: s.e164, label: "Main line", routing: { type: "voicemail" } })]);
    expect(JSON.stringify(view)).not.toContain(s.sub.token);
    expect(view.canMake).toBe(true);
  });

  it("refuses to enable without platform credentials", async () => {
    const { ctx } = await createOrgWithOwner("NoTwilio");
    const saved = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      await expect(enablePhone(ctx)).rejects.toThrow(/isn't configured/);
      expect((await getPhoneSetup(ctx)).configured).toBe(false);
    } finally {
      process.env.TWILIO_AUTH_TOKEN = saved;
    }
  });

  it("issues a softphone token only to members who can make calls", async () => {
    const s = await setup();
    const { ctx: viewer } = await addMember(s.ctx, "read_only");
    await expect(voiceToken(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const t = await voiceToken(s.ctx);
    const [, payload] = t.token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.sub).toBe(s.sub.sid);
    expect(claims.grants.identity).toBe(t.identity);
    expect(claims.grants.voice.incoming.allow).toBe(true);
  });
});

describe("webhook verification", () => {
  it("rejects unsigned, wrongly signed and wrong-account requests", async () => {
    const s = await setup();
    const p = { CallSid: callSid(), AccountSid: s.sub.sid, From: "+12125550100", To: s.e164 };
    const url = `${appUrl()}/api/telephony/${s.accountId}/voice`;
    expect(await verified(s.accountId, url, p, null)).toBeNull();
    expect(await verified(s.accountId, url, p, signatureFor("wrong-token", url, p))).toBeNull();
    expect(await verifiedFor(s.accountId, s.sub.token, "voice", {}, { ...p, AccountSid: `AC${hex(16)}` })).toBeNull();
    expect(await verifiedFor(s.accountId, s.sub.token, "voice", {}, p)).not.toBeNull();
    expect(await verified("00000000-0000-0000-0000-000000000000", url, p, signatureFor(s.sub.token, url, p))).toBeNull();
  });
});

describe("inbound calls", () => {
  it("rings every available queue member at once, records the answer, and survives duplicate and out-of-order events", async () => {
    const s = await setup();
    const { ctx: a1 } = await addMember(s.ctx, "support_agent");
    const { ctx: a2 } = await addMember(s.ctx, "support_agent");
    const { ctx: off } = await addMember(s.ctx, "support_agent");
    const { id: queueId } = await saveQueue(s.ctx, null, { name: "Support", strategy: "simultaneous", ringTimeoutSec: 15, fallback: "voicemail", memberIds: [a1.membershipId, a2.membershipId, off.membershipId] });
    await updateNumber(s.ctx, s.numberId, { label: "Main line", routing: { type: "queue", queueId } });
    await setAvailability(a1, "available");
    await setAvailability(a2, "available");
    const cust = await createCustomer(s.ctx, { firstName: "Bisi", phones: [{ phone: "+1 (212) 555-0100" }] });

    const { sid, p } = inbound(s);
    const xml = await handleVoice(s.account, p);
    expect(xml).toContain("<Dial");
    expect(xml).toContain('answerOnBridge="true"');
    expect(xml).toContain(`m${a1.membershipId.replace(/-/g, "")}`);
    expect(xml).toContain(`m${a2.membershipId.replace(/-/g, "")}`);
    expect(xml).not.toContain(`m${off.membershipId.replace(/-/g, "")}`); // offline agents aren't rung
    // Twilio retrying the same webhook doesn't create a second call
    await handleVoice(s.account, p);
    const c = await callRow(s.ctx.orgId, sid);
    expect(c).toMatchObject({ direction: "inbound", status: "ringing", customerId: cust.id, queueId });
    expect((await listCalls(s.ctx)).rows).toHaveLength(1);

    const legSid = callSid();
    const agentLeg = (status: string, seq: string) => handleStatus(s.account, { CallSid: legSid, ParentCallSid: sid, CallStatus: status, SequenceNumber: seq, To: `client:m${a1.membershipId.replace(/-/g, "")}`, Timestamp: new Date().toUTCString() }, q({ call: c.id, leg: "agent", m: a1.membershipId }));
    await agentLeg("ringing", "1");
    await agentLeg("in-progress", "2");
    expect(await agentLeg("in-progress", "2")).toMatchObject({ duplicate: true });
    let now = await callRow(s.ctx.orgId, sid);
    expect(now).toMatchObject({ status: "in_progress", agentMembershipId: a1.membershipId });
    expect((await agentRow(s.ctx.orgId, a1.membershipId)).activeCallId).toBe(c.id);

    await handleStatus(s.account, { CallSid: sid, CallStatus: "completed", CallDuration: "42", SequenceNumber: "3" }, q({}));
    await agentLeg("completed", "3");
    await agentLeg("ringing", "1b"); // late, out of order: must not reopen the call
    now = await callRow(s.ctx.orgId, sid);
    expect(now).toMatchObject({ status: "completed", outcome: "answered" });
    expect(now.endedAt).not.toBeNull();
    expect((await agentRow(s.ctx.orgId, a1.membershipId)).activeCallId).toBeNull();
    const detail = await getCall(s.ctx, c.id);
    expect(detail.legs.find((l) => l.kind === "agent")!.status).toBe("completed");
    expect(detail.customer?.id).toBe(cust.id);
  });

  it("goes to voicemail when no one is available, stores the recording and notifies the queue", async () => {
    const s = await setup();
    const { ctx: a1, member } = await addMember(s.ctx, "support_agent");
    const { id: queueId } = await saveQueue(s.ctx, null, { name: "Sales", strategy: "simultaneous", ringTimeoutSec: 15, fallback: "voicemail", memberIds: [a1.membershipId] });
    await updateNumber(s.ctx, s.numberId, { label: "Main line", routing: { type: "queue", queueId } });
    const { sid, p } = inbound(s, "+13125550111");
    const xml = await handleVoice(s.account, p);
    expect(xml).toContain("Please leave a message.");
    expect(xml).toContain("<Record");
    const c = await callRow(s.ctx.orgId, sid);
    const rec = { RecordingSid: `RE${hex(16)}`, RecordingStatus: "completed", RecordingDuration: "17", CallSid: sid };
    await handleRecording(s.account, rec, q({ call: c.id }));
    expect(await handleRecording(s.account, rec, q({ call: c.id }))).toMatchObject({ duplicate: true });
    await handleStatus(s.account, { CallSid: sid, CallStatus: "completed", SequenceNumber: "2" }, q({}));
    expect(await callRow(s.ctx.orgId, sid)).toMatchObject({ outcome: "voicemail", hadVoicemail: 1 });
    const vms = await listVoicemails(a1);
    expect(vms).toEqual([expect.objectContaining({ callId: c.id, durationSec: 17, from: "+13125550111" })]);
    const notes = await listNotifications({ ...a1, userId: member.id });
    expect(notes.some((n) => n.type === "call.voicemail")).toBe(true);

    stubFetch({ [`/Recordings/${rec.RecordingSid}.mp3`]: () => new Response(Buffer.from("ID3audio"), { status: 200 }), [`DELETE https://api.twilio.com/2010-04-01/Accounts/${s.sub.sid}/Recordings/${rec.RecordingSid}.json`]: () => new Response(null, { status: 204 }) });
    expect((await voicemailAudio(a1, vms[0].id)).toString()).toBe("ID3audio");
    await updateVoicemail(a1, vms[0].id, { status: "reviewed" });
    expect(await listVoicemails(a1, "new")).toHaveLength(0);
    await expect(deleteVoicemail(a1, vms[0].id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteVoicemail(s.ctx, vms[0].id);
    expect(await listVoicemails(s.ctx, "reviewed")).toHaveLength(0);
  });

  it("round robin offers one agent at a time, then falls back", async () => {
    const s = await setup();
    const { ctx: a1 } = await addMember(s.ctx, "support_agent");
    const { ctx: a2 } = await addMember(s.ctx, "support_agent");
    const { id: queueId } = await saveQueue(s.ctx, null, { name: "RR", strategy: "round_robin", ringTimeoutSec: 10, fallback: "hangup", memberIds: [a1.membershipId, a2.membershipId] });
    await updateNumber(s.ctx, s.numberId, { label: "Main line", routing: { type: "queue", queueId } });
    await setAvailability(a1, "available");
    await setAvailability(a2, "available");
    const { sid, p } = inbound(s);
    const first = await handleVoice(s.account, p);
    const c = await callRow(s.ctx.orgId, sid);
    const id = (x: Ctx) => `m${x.membershipId.replace(/-/g, "")}`;
    const firstAgent = first.includes(id(a1)) ? a1 : a2;
    const secondAgent = firstAgent === a1 ? a2 : a1;
    expect(first).not.toContain(id(secondAgent));
    const second = await handleDialResult(s.account, { CallSid: sid, DialCallStatus: "no-answer" }, q({ call: c.id, attempt: "0" }));
    expect(second).toContain(id(secondAgent));
    expect(second).not.toContain(id(firstAgent));
    const third = await handleDialResult(s.account, { CallSid: sid, DialCallStatus: "no-answer" }, q({ call: c.id, attempt: "1" }));
    expect(third).toContain("no one is available");
    await handleStatus(s.account, { CallSid: sid, CallStatus: "completed", SequenceNumber: "9" }, q({}));
    expect(await callRow(s.ctx.orgId, sid)).toMatchObject({ outcome: "missed", status: "no_answer" });
  });

  it("missed calls notify the routed agent; unknown numbers are refused politely", async () => {
    const s = await setup();
    const { ctx: a1, member } = await addMember(s.ctx, "sales_rep");
    await updateNumber(s.ctx, s.numberId, { label: "Main line", routing: { type: "agent", membershipId: a1.membershipId } });
    await setAvailability(a1, "available");
    const { sid, p } = inbound(s);
    expect(await handleVoice(s.account, p)).toContain(`m${a1.membershipId.replace(/-/g, "")}`);
    const c = await callRow(s.ctx.orgId, sid);
    expect(await handleDialResult(s.account, { CallSid: sid, DialCallStatus: "no-answer" }, q({ call: c.id }))).toContain("<Record");
    await handleStatus(s.account, { CallSid: sid, CallStatus: "completed", SequenceNumber: "4" }, q({}));
    expect((await callRow(s.ctx.orgId, sid)).outcome).toBe("missed");
    expect((await listNotifications({ ...a1, userId: member.id })).some((n) => n.type === "call.missed")).toBe(true);
    expect(await handleVoice(s.account, { ...p, CallSid: callSid(), To: "+15125550000" })).toContain("available right now");
  });
});

describe("outbound calls", () => {
  const client = (x: Ctx) => `client:m${x.membershipId.replace(/-/g, "")}`;

  it("dials allowed numbers with the business caller ID and links the customer", async () => {
    const s = await setup();
    const cust = await createCustomer(s.ctx, { firstName: "Tolu", phones: [{ phone: CALLEE }] });
    const prepared = await prepareCall(s.ctx, { to: "(415) 867-5309", customerId: cust.id });
    expect(prepared.e164).toBe(CALLEE);
    const sid = callSid();
    const xml = await handleVoice(s.account, { CallSid: sid, From: client(s.ctx), To: prepared.e164, CustomerId: cust.id });
    expect(xml).toContain(`callerId="${s.e164}"`);
    expect(xml).toContain(`<Number`);
    expect(xml).toContain(CALLEE);
    const c = await callRow(s.ctx.orgId, sid);
    expect(c).toMatchObject({ direction: "outbound", customerId: cust.id, agentMembershipId: s.ctx.membershipId, toE164: CALLEE, fromE164: s.e164 });
    await expect(prepareCall(s.ctx, { to: CALLEE })).rejects.toThrow(/already on a call/);
    // the callee picks up, then the call ends
    const pstn = callSid();
    await handleStatus(s.account, { CallSid: pstn, ParentCallSid: sid, CallStatus: "in-progress", SequenceNumber: "2" }, q({ call: c.id, leg: "pstn" }));
    await handleStatus(s.account, { CallSid: pstn, ParentCallSid: sid, CallStatus: "completed", SequenceNumber: "3", CallDuration: "30" }, q({ call: c.id, leg: "pstn" }));
    await handleStatus(s.account, { CallSid: sid, CallStatus: "completed", SequenceNumber: "4" }, q({}));
    expect(await callRow(s.ctx.orgId, sid)).toMatchObject({ status: "completed", outcome: "answered" });
    expect((await agentRow(s.ctx.orgId, s.ctx.membershipId)).activeCallId).toBeNull();

    // usage: Twilio's billed prices are recorded once priced
    stubFetch({
      [`/Calls/${sid}.json`]: () => ({ sid, price: "-0.0140", price_unit: "USD", status: "completed", duration: "31", direction: "inbound", start_time: new Date().toUTCString() }),
      [`/Calls.json?ParentCallSid=${sid}`]: () => ({ calls: [{ sid: pstn, price: "-0.0130", price_unit: "USD", status: "completed", direction: "outbound-dial", start_time: new Date().toUTCString() }] }),
    });
    await runUsageFetch({ orgId: s.ctx.orgId, jobId: "j", attempt: 1, payload: { callId: c.id } });
    await runUsageFetch({ orgId: s.ctx.orgId, jobId: "j", attempt: 2, payload: { callId: c.id } }); // retried job: no double counting
    const usage = await withScope({ orgId: s.ctx.orgId }, (tx) => tx.select().from(phoneUsageRecords).where(eq(phoneUsageRecords.callId, c.id)));
    expect(usage.map((u) => u.priceMicros).sort()).toEqual([13_000, 14_000]);
    expect((await callRow(s.ctx.orgId, sid)).priceMicros).toBe(27_000);
  });

  it("blocks emergency, premium and disallowed-country numbers, members who can't call, and calls over the spend limit", async () => {
    const s = await setup();
    const say = (to: string, from = client(s.ctx)) => handleVoice(s.account, { CallSid: callSid(), From: from, To: to });
    expect(await say("911")).toContain("<Hangup");
    expect(await say("911")).not.toContain("<Dial");
    expect(await say("+19005550199")).not.toContain("<Dial");
    expect(await say("+442071838750")).not.toContain("<Dial");
    await expect(prepareCall(s.ctx, { to: "+442071838750" })).rejects.toBeInstanceOf(ValidationError);
    const { ctx: viewer } = await addMember(s.ctx, "read_only");
    expect(await say(CALLEE, client(viewer))).toContain("not allowed");
    await expect(prepareCall(viewer, { to: CALLEE })).rejects.toBeInstanceOf(ForbiddenError);
    // 20.00 limit reached by provider-reported usage
    await withScope({ orgId: s.ctx.orgId }, (tx) => tx.insert(phoneUsageRecords).values({ organizationId: s.ctx.orgId, providerSid: `CA${hex(16)}`, category: "voice_outbound", priceMicros: 20_000_000, currency: "USD", recordedAt: new Date() }));
    expect(await say(CALLEE)).toContain("limit");
  });
});

describe("call history, permissions and isolation", () => {
  it("reps see only their own calls; managers see all; another workspace sees nothing", async () => {
    const s = await setup();
    const { ctx: rep1 } = await addMember(s.ctx, "sales_rep");
    const { ctx: rep2 } = await addMember(s.ctx, "sales_rep");
    const sid = callSid();
    await handleVoice(s.account, { CallSid: sid, From: `client:m${rep1.membershipId.replace(/-/g, "")}`, To: CALLEE });
    const c = await callRow(s.ctx.orgId, sid);
    expect((await listCalls(rep1)).rows.map((r) => r.id)).toEqual([c.id]);
    expect((await listCalls(rep2)).rows).toHaveLength(0);
    await expect(getCall(rep2, c.id)).rejects.toBeInstanceOf(NotFoundError);
    const { ctx: mgr } = await addMember(s.ctx, "sales_manager");
    expect((await listCalls(mgr)).rows).toHaveLength(1);
    const { ctx: viewer } = await addMember(s.ctx, "read_only");
    await expect(listCalls(viewer)).rejects.toBeInstanceOf(ForbiddenError);

    // a rep calling another rep's customer sees the number, not that customer's name
    const owned = await createCustomer(s.ctx, { firstName: "Private", phones: [{ phone: "+12025550147" }] });
    const sid2 = callSid();
    await handleVoice(s.account, { CallSid: sid2, From: `client:m${rep1.membershipId.replace(/-/g, "")}`, To: "+12025550147" });
    // (no system role is limited to its own customers, so build that permission set from rep1's)
    const assignedOnly = { ...rep1, permissions: new Set([...rep1.permissions].filter((p) => p !== "customers.read").concat("customers.read_assigned")) } as Ctx;
    const masked = (await listCalls(assignedOnly)).rows.find((r) => r.toE164 === "+12025550147")!;
    expect(masked).toMatchObject({ customerId: null, customerName: null });
    expect((await listCalls(rep1)).rows.find((r) => r.toE164 === "+12025550147")!.customerId).toBe(owned.id);
    expect((await listCalls(mgr)).rows.find((r) => r.toE164 === "+12025550147")!.customerId).toBe(owned.id);

    const other = await setup("OtherCo");
    expect((await listCalls(other.ctx)).rows).toHaveLength(0);
    await expect(getCall(other.ctx, c.id)).rejects.toBeInstanceOf(NotFoundError);
    // a webhook for workspace A's call can't touch it through workspace B's account
    expect(await handleStatus(other.account, { CallSid: sid, CallStatus: "completed", SequenceNumber: "1" }, q({ call: c.id }))).toMatchObject({ ignored: true });
    const evs = await withScope({ orgId: s.ctx.orgId }, (tx) => tx.select().from(callEvents).where(eq(callEvents.callId, c.id)));
    expect(evs).toHaveLength(0);
  });

  it("notes, links and a phone-channel ticket from the call", async () => {
    const s = await setup();
    const sid = callSid();
    await handleVoice(s.account, { CallSid: sid, From: `client:m${s.ctx.membershipId.replace(/-/g, "")}`, To: CALLEE });
    const c = await callRow(s.ctx.orgId, sid);
    await addCallNote(s.ctx, c.id, { body: "Wants a refund for order 1001" });
    const cust = await createCustomer(s.ctx, { firstName: "Ngozi" });
    await linkCall(s.ctx, c.id, { kind: "customer", targetId: cust.id });
    await expect(linkCall(s.ctx, c.id, { kind: "lead", targetId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(ValidationError);
    const t = await createTicketFromCall(s.ctx, c.id, { subject: "Refund request" });
    await expect(createTicketFromCall(s.ctx, c.id, { subject: "Again" })).rejects.toBeInstanceOf(ConflictError);
    const d = await getCall(s.ctx, c.id);
    expect(d.notes.map((n) => n.body)).toEqual(["Wants a refund for order 1001"]);
    expect(d.customer?.id).toBe(cust.id);
    expect(d.ticket?.id).toBe(t.id);
    const ticket = await getTicket(s.ctx, t.id);
    expect(ticket).toMatchObject({ channel: "phone", customerId: cust.id });
    const stats = await getPhoneStats(s.ctx);
    expect(stats.outbound).toBe(1);
    expect(stats.live).toHaveLength(1);
  });

  it("call events and usage records are append-only for the app role", async () => {
    const s = await setup();
    await expect(withScope({ orgId: s.ctx.orgId }, (tx) => tx.delete(phoneUsageRecords).where(eq(phoneUsageRecords.organizationId, s.ctx.orgId)))).rejects.toThrow();
    await expect(withScope({ orgId: s.ctx.orgId }, (tx) => tx.update(callEvents).set({ kind: "x" }).where(eq(callEvents.organizationId, s.ctx.orgId)))).rejects.toThrow();
  });
});
