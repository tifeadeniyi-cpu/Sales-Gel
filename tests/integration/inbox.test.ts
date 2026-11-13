import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createCustomer, getCustomer } from "@/domains/customers/service";
import {
  connectEmail, connectInstagram, connectMessenger, connectWebchat, connectWhatsApp, disconnectChannel, listChannels, updateWebchat,
} from "@/domains/inbox/connections";
import {
  addNote, archiveSavedReply, assignConversation, convertToTicket, createCustomerFromConversation, createSavedReply, getConversation, inboxCounts,
  linkConversationCustomer, listConversations, listSavedReplies, markConversationRead, retryMessage, sendReply, setConversationStatus,
} from "@/domains/inbox/service";
import { receiveInboxWebhook, verifyInboxWebhook } from "@/domains/inbox/webhooks";
import { getWidgetConfig, startChat, visitorMessages, visitorSend } from "@/domains/inbox/webchat";
import { channelConnections, conversationMessages, conversations } from "@/domains/inbox/schema";
import { getTicket } from "@/domains/support/service";
import { listNotifications } from "@/domains/platform/notifications";
import { isPermissionDenied } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];
type Responder = (url: string, init: RequestInit) => unknown;
const APP_SECRET = "0123456789abcdef0123456789abcdef";

function stubFetch(routes: Record<string, Responder>) {
  const calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: typeof init.body === "string" ? init.body : "", headers: Object.fromEntries(new Headers(init.headers).entries()) });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!key) return new Response(JSON.stringify({ error: { message: `unexpected ${method} ${url}` } }), { status: 500 });
    const out = routes[key](url, init);
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}
const signed = (body: object) => {
  const raw = JSON.stringify(body);
  return { raw, headers: new Headers({ "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` }) };
};
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});
afterEach(() => vi.unstubAllGlobals());

async function convOf(ctx: Ctx, n = 0) {
  return (await listConversations(ctx, { view: "all" })).rows[n];
}

describe("web chat", () => {
  async function setup(askEmail = true) {
    const { ctx } = await createOrgWithOwner("ChatCo");
    const { id, publicKey } = await connectWebchat(ctx, { name: "Website", title: "Chat with ChatCo", greeting: "Hi there!", color: "#0053ee", askEmail });
    return { ctx, id, publicKey };
  }

  it("visitor starts a chat; the team sees it unread, replies, and the visitor gets the reply but never notes", async () => {
    const { ctx, publicKey } = await setup();
    expect(await getWidgetConfig(publicKey)).toMatchObject({ title: "Chat with ChatCo", greeting: "Hi there!", color: "#0053ee" });
    await expect(startChat(publicKey, { message: "Hello" }, { ip: ip() })).rejects.toThrow(/email/);
    const existing = await createCustomer(ctx, { firstName: "Amaka", emails: [{ email: "amaka@example.com" }] });
    const { token } = await startChat(publicKey, { name: "Amaka", email: "Amaka@Example.com", message: "Do you deliver to Plano?" }, { ip: ip(), page: "https://shop.example/delivery" });
    const row = await convOf(ctx);
    expect(row).toMatchObject({ channel: "webchat", status: "open", unread: true, customerId: existing.id, title: "Amaka" });
    expect((await inboxCounts(ctx))!.unread).toBe(1);
    await markConversationRead(ctx, row.id);
    expect((await convOf(ctx)).unread).toBe(false);

    await addNote(ctx, row.id, { body: "INTERNAL: VIP" });
    const sent = await sendReply(ctx, row.id, { body: "Yes! Plano is in our zone." });
    expect(sent.status).toBe("sent");
    const view = await visitorMessages(publicKey, token);
    expect(view!.messages.map((m) => [m.from, m.body])).toEqual([["you", "Do you deliver to Plano?"], ["team", "Yes! Plano is in our zone."]]);
    expect(JSON.stringify(view)).not.toContain("INTERNAL");
    const detail = await getConversation(ctx, row.id);
    expect(detail.messages.find((m) => m.direction === "outbound")!.deliveryStatus).toBe("delivered"); // fetched by the widget
    expect(detail.assigneeMembershipId).toBe(ctx.membershipId); // replying claims it

    await setConversationStatus(ctx, row.id, "pending");
    await visitorSend(publicKey, token, { body: "Great, thanks!" }, { ip: ip() });
    expect((await getConversation(ctx, row.id)).status).toBe("open");
    expect((await convOf(ctx)).unread).toBe(true);
    expect(await visitorMessages(publicKey, "x".repeat(30))).toBeNull();
  });

  it("honours the email setting, rate limits, and disconnect", async () => {
    const { ctx, id, publicKey } = await setup(false);
    const addr = ip();
    for (let i = 0; i < 5; i++) await startChat(publicKey, { message: `hi ${i}` }, { ip: addr });
    await expect(startChat(publicKey, { message: "again" }, { ip: addr })).rejects.toThrow(/Too many/);
    expect((await convOf(ctx)).title).toBe("Website visitor");
    await updateWebchat(ctx, id, { name: "Website", title: "New title", greeting: "Yo", color: "#112233", askEmail: false });
    expect((await getWidgetConfig(publicKey))!.title).toBe("New title");
    await disconnectChannel(ctx, id);
    expect(await getWidgetConfig(publicKey)).toBeNull();
    const c = await convOf(ctx);
    expect((await getConversation(ctx, c.id)).reply.canReply).toBe(false);
    await expect(sendReply(ctx, c.id, { body: "hello?" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("email (Postmark)", () => {
  async function connected() {
    const { ctx } = await createOrgWithOwner("MailCo");
    const calls = stubFetch({
      "GET https://api.postmarkapp.com/server": () => ({ ID: 1, Name: "MailCo", InboundAddress: "abc123@inbound.postmarkapp.com" }),
      "PUT https://api.postmarkapp.com/server": () => ({ ID: 1 }),
    });
    const res = await connectEmail(ctx, { name: "Support", serverToken: "pm-server-token-0000000000000", fromEmail: "help@mailco.com", fromName: "MailCo Support" });
    const hookPut = calls.find((c) => c.method === "PUT")!;
    const hookUrl = new URL(JSON.parse(hookPut.body).InboundHookUrl);
    const auth = `Basic ${Buffer.from(`${decodeURIComponent(hookUrl.username)}:${decodeURIComponent(hookUrl.password)}`).toString("base64")}`;
    return { ctx, id: res.id, auth, res };
  }
  const mail = (o: Record<string, unknown> = {}) => ({
    FromFull: { Email: "chidi@example.com", Name: "Chidi Obi" }, Subject: "Order 1042", MessageID: `pm-${randomBytes(4).toString("hex")}`,
    TextBody: "Hi, my order hasn't arrived.\n\nOn Mon... wrote:\n> old", StrippedTextReply: "Hi, my order hasn't arrived.", Headers: [{ Name: "Message-ID", Value: "<orig@mail.example.com>" }], Attachments: [], ...o,
  });

  it("connects, receives email, replies with threading headers and a reply address, and threads the answer", async () => {
    const { ctx, id, auth, res } = await connected();
    expect(res).toMatchObject({ inboundAddress: "abc123@inbound.postmarkapp.com", hookConfigured: true });
    const first = mail({ Attachments: [{ Name: "photo.jpg", Content: Buffer.from("fakejpeg").toString("base64"), ContentType: "image/jpeg", ContentLength: 8 }] });
    expect((await receiveInboxWebhook(id, JSON.stringify(first), new Headers({ authorization: "Basic bm9wZTpub3Bl" }))).status).toBe(401);
    expect((await receiveInboxWebhook(id, JSON.stringify(first), new Headers({ authorization: auth }))).processed).toBe(1);
    expect((await receiveInboxWebhook(id, JSON.stringify(first), new Headers({ authorization: auth }))).processed).toBe(0); // dedupe
    const row = await convOf(ctx);
    expect(row).toMatchObject({ channel: "email", subject: "Order 1042", title: "Chidi Obi", contactEmail: "chidi@example.com" });
    const detail = await getConversation(ctx, row.id);
    expect(detail.messages[0]).toMatchObject({ body: "Hi, my order hasn't arrived." });
    expect(detail.messages[0].attachments).toHaveLength(1);

    const calls = stubFetch({ "POST https://api.postmarkapp.com/email": () => ({ MessageID: "pm-out-1", ErrorCode: 0 }) });
    expect((await sendReply(ctx, row.id, { body: "Sorry Chidi — it ships today." })).status).toBe("sent");
    const out = JSON.parse(calls[0].body);
    expect(out).toMatchObject({ From: "MailCo Support <help@mailco.com>", To: "chidi@example.com", Subject: "Re: Order 1042", MessageStream: "outbound", TextBody: "Sorry Chidi — it ships today." });
    expect(out.ReplyTo).toBe(`abc123+c${row.id.replace(/-/g, "")}@inbound.postmarkapp.com`);
    expect(out.Headers).toEqual(expect.arrayContaining([{ Name: "In-Reply-To", Value: "<orig@mail.example.com>" }]));
    expect(calls[0].headers["x-postmark-server-token"]).toBe("pm-server-token-0000000000000");

    // Customer replies to the reply address with a changed subject: still the same conversation.
    await receiveInboxWebhook(id, JSON.stringify(mail({ Subject: "Totally different", MailboxHash: `c${row.id.replace(/-/g, "")}`, StrippedTextReply: "Thank you!" })), new Headers({ authorization: auth }));
    expect((await listConversations(ctx, { view: "all" })).total).toBe(1);
    // Mail from our own sending address (bounces/auto-replies) is ignored.
    expect((await receiveInboxWebhook(id, JSON.stringify(mail({ FromFull: { Email: "help@mailco.com" } })), new Headers({ authorization: auth }))).processed).toBe(0);
  });

  it("records provider refusals as failed, flags bad credentials, and retries", async () => {
    const { ctx, id, auth } = await connected();
    await receiveInboxWebhook(id, JSON.stringify(mail()), new Headers({ authorization: auth }));
    const row = await convOf(ctx);
    stubFetch({ "POST https://api.postmarkapp.com/email": () => new Response(JSON.stringify({ ErrorCode: 10, Message: "Bad or missing Server API token." }), { status: 401 }) });
    const r = await sendReply(ctx, row.id, { body: "Hello?" });
    expect(r).toMatchObject({ status: "failed", error: "Bad or missing Server API token." });
    const [conn] = await withTenant(ctx, (tx) => tx.select().from(channelConnections).where(eq(channelConnections.id, id)));
    expect(conn.status).toBe("error");
    stubFetch({ "POST https://api.postmarkapp.com/email": () => ({ MessageID: "pm-out-2", ErrorCode: 0 }) });
    expect((await retryMessage(ctx, r.id)).status).toBe("sent");
    const [after] = await withTenant(ctx, (tx) => tx.select().from(channelConnections).where(eq(channelConnections.id, id)));
    expect(after.status).toBe("active");
    await expect(retryMessage(ctx, r.id)).rejects.toThrow(/Only failed/);
  });

  it("rejects a token Postmark doesn't accept", async () => {
    const { ctx } = await createOrgWithOwner("MailBad");
    stubFetch({ "GET https://api.postmarkapp.com/server": () => new Response(JSON.stringify({ ErrorCode: 10, Message: "Invalid token" }), { status: 401 }) });
    await expect(connectEmail(ctx, { name: "S", serverToken: "x".repeat(30), fromEmail: "a@b.com", fromName: "A" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("WhatsApp", () => {
  async function connected() {
    const { ctx } = await createOrgWithOwner("WaCo");
    stubFetch({ "GET https://graph.facebook.com/v26.0/1234567890?fields": () => ({ id: "1234567890", display_phone_number: "+1 555 0100", verified_name: "WaCo Foods" }) });
    const { id } = await connectWhatsApp(ctx, { accessToken: "EAAG" + "x".repeat(40), phoneNumberId: "1234567890", appSecret: APP_SECRET });
    return { ctx, id };
  }
  const inbound = (o: { id?: string; from?: string; body?: string; phoneId?: string; ts?: number } = {}) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: o.phoneId ?? "1234567890" }, contacts: [{ wa_id: o.from ?? "2348031234567", profile: { name: "Ngozi" } }],
      messages: [{ from: o.from ?? "2348031234567", id: o.id ?? `wamid.${randomBytes(4).toString("hex")}`, timestamp: String(o.ts ?? Math.floor(Date.now() / 1000)), type: "text", text: { body: o.body ?? "Is egusi in stock?" } }],
    } }] }],
  });

  it("verifies the subscription, ingests signed messages, matches the customer by phone, and replies in the window", async () => {
    const { ctx, id } = await connected();
    const [ch] = await listChannels(ctx);
    expect(ch).toMatchObject({ channel: "whatsapp", name: "WaCo Foods", webhookUrl: `http://localhost:3000/api/webhooks/inbox/${id}` });
    expect(await verifyInboxWebhook(id, new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" }))).toBeNull();
    expect(await verifyInboxWebhook(id, new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": ch.verifyToken!, "hub.challenge": "42" }))).toBe("42");

    const cust = await createCustomer(ctx, { firstName: "Ngozi", phones: [{ phone: "+2348031234567" }] });
    const bad = JSON.stringify(inbound());
    expect((await receiveInboxWebhook(id, bad, new Headers({ "x-hub-signature-256": "sha256=deadbeef" }))).status).toBe(401);
    const s = signed(inbound({ id: "wamid.A1" }));
    expect((await receiveInboxWebhook(id, s.raw, s.headers)).processed).toBe(1);
    expect((await receiveInboxWebhook(id, s.raw, s.headers)).processed).toBe(0);
    const other = signed(inbound({ phoneId: "999" }));
    expect((await receiveInboxWebhook(id, other.raw, other.headers)).processed).toBe(0); // another number on the same app
    const row = await convOf(ctx);
    expect(row).toMatchObject({ channel: "whatsapp", customerId: cust.id, contactHandle: "2348031234567" });
    expect((await getConversation(ctx, row.id)).reply.canReply).toBe(true);

    const calls = stubFetch({ "POST https://graph.facebook.com/v26.0/1234567890/messages": () => ({ messaging_product: "whatsapp", messages: [{ id: "wamid.OUT1" }] }) });
    expect((await sendReply(ctx, row.id, { body: "Yes, 20 bags left!" })).status).toBe("sent");
    expect(JSON.parse(calls[0].body)).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "2348031234567", type: "text", text: { preview_url: false, body: "Yes, 20 bags left!" } });
    expect(calls[0].headers.authorization).toMatch(/^Bearer EAAG/);

    // Receipts only move forward.
    const status = (st: string) => signed({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.OUT1", status: st }] } }] }] });
    for (const st of ["delivered", "read", "delivered"]) { const x = status(st); await receiveInboxWebhook(id, x.raw, x.headers); }
    expect((await getConversation(ctx, row.id)).messages.find((m) => m.providerMessageId === "wamid.OUT1")!.deliveryStatus).toBe("read");
  });

  it("blocks free-form replies outside the 24-hour window", async () => {
    const { ctx, id } = await connected();
    const s = signed(inbound({ ts: Math.floor(Date.now() / 1000) - 25 * 3600 }));
    await receiveInboxWebhook(id, s.raw, s.headers);
    const row = await convOf(ctx);
    const d = await getConversation(ctx, row.id);
    expect(d.reply).toMatchObject({ canReply: false });
    await expect(sendReply(ctx, row.id, { body: "hello" })).rejects.toThrow(/24 hours/);
  });

  it("creates a customer from a conversation and remembers the number for next time", async () => {
    const { ctx, id } = await connected();
    let s = signed(inbound({ from: "2348099999999" }));
    await receiveInboxWebhook(id, s.raw, s.headers);
    const row = await convOf(ctx);
    expect(row.customerId).toBeNull();
    const c = await createCustomerFromConversation(ctx, row.id);
    const cust = await getCustomer(ctx, c.id);
    expect(cust!.phones.map((p) => p.e164)).toContain("+2348099999999");
    await setConversationStatus(ctx, row.id, "closed");
    s = signed(inbound({ from: "2348099999999", body: "Back again" }));
    await receiveInboxWebhook(id, s.raw, s.headers);
    const rows = (await listConversations(ctx, { view: "all" })).rows;
    expect(rows).toHaveLength(2); // closed conversations aren't reused
    expect(rows[0].customerId).toBe(c.id);
  });
});

describe("Messenger and Instagram", () => {
  it("Messenger: ingests messages, ignores echoes, records delivery and reads, sends RESPONSE messages", async () => {
    const { ctx } = await createOrgWithOwner("FbCo");
    stubFetch({ "GET https://graph.facebook.com/v26.0/me?fields": () => ({ id: "PAGE1", name: "FbCo Page" }) });
    const { id } = await connectMessenger(ctx, { accessToken: "EAAP" + "y".repeat(40), appSecret: APP_SECRET });
    stubFetch({ "GET https://graph.facebook.com/v26.0/PSID9?fields": () => ({ first_name: "Tola", last_name: "Ade" }) });
    const ev = (m: object) => signed({ object: "page", entry: [{ id: "PAGE1", time: Date.now(), messaging: [{ sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: Date.now(), ...m }] }] });
    let s = ev({ message: { mid: "m_1", text: "Hi from Messenger" } });
    expect((await receiveInboxWebhook(id, s.raw, s.headers)).processed).toBe(1);
    s = ev({ message: { mid: "m_echo", text: "our own", is_echo: true } });
    expect((await receiveInboxWebhook(id, s.raw, s.headers)).processed).toBe(0);
    const row = await convOf(ctx);
    expect(row.title).toBe("Tola Ade");
    const calls = stubFetch({ "POST https://graph.facebook.com/v26.0/me/messages": () => ({ recipient_id: "PSID9", message_id: "m_out" }) });
    await sendReply(ctx, row.id, { body: "Hello Tola" });
    expect(JSON.parse(calls[0].body)).toEqual({ recipient: { id: "PSID9" }, messaging_type: "RESPONSE", message: { text: "Hello Tola" } });
    s = ev({ delivery: { mids: ["m_out"], watermark: Date.now() } });
    await receiveInboxWebhook(id, s.raw, s.headers);
    expect((await getConversation(ctx, row.id)).messages.find((m) => m.providerMessageId === "m_out")!.deliveryStatus).toBe("delivered");
    s = ev({ read: { watermark: Date.now() + 1000 } });
    await receiveInboxWebhook(id, s.raw, s.headers);
    expect((await getConversation(ctx, row.id)).messages.find((m) => m.providerMessageId === "m_out")!.deliveryStatus).toBe("read");
  });

  it("Instagram: uses graph.instagram.com and the instagram object", async () => {
    const { ctx } = await createOrgWithOwner("IgCo");
    stubFetch({ "GET https://graph.instagram.com/v26.0/me?fields": () => ({ user_id: "IG1", username: "igco" }) });
    const { id } = await connectInstagram(ctx, { accessToken: "IGAA" + "z".repeat(40), appSecret: APP_SECRET });
    stubFetch({ "GET https://graph.instagram.com/v26.0/IGSID5?fields": () => ({ username: "buyer" }) });
    const s = signed({ object: "instagram", entry: [{ id: "IG1", time: Date.now(), messaging: [{ sender: { id: "IGSID5" }, recipient: { id: "IG1" }, timestamp: Date.now(), message: { mid: "ig_1", text: "Price?" } }] }] });
    await receiveInboxWebhook(id, s.raw, s.headers);
    const row = await convOf(ctx);
    expect(row).toMatchObject({ channel: "instagram", title: "@buyer" });
    const calls = stubFetch({ "POST https://graph.instagram.com/v26.0/me/messages": () => ({ message_id: "ig_out" }) });
    await sendReply(ctx, row.id, { body: "$12" });
    expect(calls[0].url).toBe("https://graph.instagram.com/v26.0/me/messages");
  });
});

describe("triage, tickets and isolation", () => {
  it("agents only see conversations assigned to them; assignment and new messages notify", async () => {
    const { ctx } = await createOrgWithOwner("TriageCo");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    const { publicKey } = await connectWebchat(ctx, { name: "Site", title: "Chat", askEmail: false });
    const { token } = await startChat(publicKey, { name: "Femi", message: "Help please" }, { ip: ip() });
    expect((await listConversations(agent, { view: "all" })).total).toBe(0);
    const row = await convOf(ctx);
    await expect(getConversation(agent, row.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignConversation(agent, row.id, agent.membershipId)).rejects.toBeInstanceOf(ForbiddenError);
    await assignConversation(ctx, row.id, agent.membershipId);
    expect((await listConversations(agent, { view: "mine" })).total).toBe(1);
    await visitorSend(publicKey, token, { body: "Are you there?" }, { ip: ip() });
    const notes = await listNotifications(agent);
    expect(notes.map((n) => n.type)).toEqual(expect.arrayContaining(["conversation.assigned", "conversation.message"]));
  });

  it("turns a conversation into a ticket with the transcript, once", async () => {
    const { ctx } = await createOrgWithOwner("TicketCo");
    const { publicKey } = await connectWebchat(ctx, { name: "Site", title: "Chat", askEmail: false });
    await startChat(publicKey, { name: "Yemi", message: "My parcel is damaged" }, { ip: ip() });
    const row = await convOf(ctx);
    await sendReply(ctx, row.id, { body: "Sorry to hear that!" });
    const t = await convertToTicket(ctx, row.id);
    const ticket = await getTicket(ctx, t.id);
    expect(ticket!.subject).toBe("My parcel is damaged");
    expect(ticket!.channel).toBe("web_form");
    expect(ticket!.description).toContain("Sorry to hear that!");
    expect((await getConversation(ctx, row.id)).ticket?.number).toBe(t.number);
    await expect(convertToTicket(ctx, row.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("links customers, keeps message history append-only, and isolates workspaces", async () => {
    const a = await createOrgWithOwner("IsoInboxA");
    const b = await createOrgWithOwner("IsoInboxB");
    const { publicKey } = await connectWebchat(a.ctx, { name: "Site", title: "Chat", askEmail: false });
    await startChat(publicKey, { message: "hello" }, { ip: ip() });
    const row = await convOf(a.ctx);
    const cu = await createCustomer(a.ctx, { firstName: "Linked" });
    await linkConversationCustomer(a.ctx, row.id, cu.id);
    expect((await getConversation(a.ctx, row.id)).customer?.id).toBe(cu.id);
    const foreign = await createCustomer(b.ctx, { firstName: "Foreign" });
    await expect(linkConversationCustomer(a.ctx, row.id, foreign.id)).rejects.toBeInstanceOf(ValidationError);
    const err = await withTenant(a.ctx, (tx) => tx.update(conversationMessages).set({ body: "rewritten" }).where(eq(conversationMessages.conversationId, row.id))).catch((e) => e);
    expect(isPermissionDenied(err)).toBe(true);
    expect((await listConversations(b.ctx, { view: "all" })).total).toBe(0);
    expect(await withTenant(b.ctx, (tx) => tx.select().from(conversations))).toHaveLength(0);
    await expect(getConversation(b.ctx, row.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await receiveInboxWebhook(randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"), "{}", new Headers())).status).toBe(404);
  });

  it("saved replies", async () => {
    const { ctx } = await createOrgWithOwner("SavedCo");
    const r = await createSavedReply(ctx, { title: "Delivery times", body: "We deliver in 2–3 days." });
    await expect(createSavedReply(ctx, { title: "delivery times", body: "dup" })).rejects.toBeInstanceOf(ValidationError);
    expect((await listSavedReplies(ctx)).map((x) => x.title)).toEqual(["Delivery times"]);
    await archiveSavedReply(ctx, r.id);
    expect(await listSavedReplies(ctx)).toHaveLength(0);
  });
});
