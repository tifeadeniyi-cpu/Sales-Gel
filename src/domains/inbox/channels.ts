import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/crypto";
import type { Inbound, InboundFile } from "./ingest";

/**
 * Provider adapters. Each channel: validate credentials on connect, send a text message, and turn a
 * verified webhook body into inbound messages and delivery receipts. API facts re-checked for this
 * phase: Graph API v26.0; Instagram API with Instagram Login on graph.instagram.com; Meta webhooks
 * signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret); Postmark
 * inbound JSON protected with HTTP Basic Auth.
 */
export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const IG_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const POSTMARK = "https://api.postmarkapp.com";

export class ChannelError extends Error {
  constructor(message: string, readonly retryable = false, readonly code?: string) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit & { label: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ChannelError(`${init.label} couldn't be reached. Try again.`, true);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = (json.error as { message?: string; code?: number } | undefined) ?? undefined;
    const msg = err?.message ?? (json.Message as string | undefined) ?? `${init.label} returned ${res.status}`;
    throw new ChannelError(msg.slice(0, 300), res.status >= 500 || res.status === 429, String(err?.code ?? json.ErrorCode ?? res.status));
  }
  return json as T;
}

/* ───────── Meta (WhatsApp, Messenger, Instagram) ───────── */

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(expected, header);
}

export async function checkWhatsApp(token: string, phoneNumberId: string) {
  const r = await call<{ id: string; display_phone_number?: string; verified_name?: string }>(`${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, { label: "WhatsApp", headers: { Authorization: `Bearer ${token}` } });
  return { id: r.id, name: r.verified_name ?? r.display_phone_number ?? phoneNumberId, phone: r.display_phone_number ?? null };
}
export async function checkMessenger(pageToken: string) {
  const r = await call<{ id: string; name: string }>(`${GRAPH}/me?fields=id,name`, { label: "Facebook", headers: { Authorization: `Bearer ${pageToken}` } });
  return { id: r.id, name: r.name };
}
export async function checkInstagram(token: string) {
  const r = await call<{ user_id?: string; id?: string; username?: string }>(`${IG_GRAPH}/me?fields=user_id,username`, { label: "Instagram", headers: { Authorization: `Bearer ${token}` } });
  return { id: r.user_id ?? r.id ?? "", name: r.username ? `@${r.username}` : "Instagram" };
}

export async function sendWhatsApp(token: string, phoneNumberId: string, to: string, body: string) {
  const r = await call<{ messages?: { id: string }[] }>(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
    label: "WhatsApp", method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  });
  return r.messages?.[0]?.id ?? null;
}
export async function sendMessenger(pageToken: string, psid: string, body: string) {
  const r = await call<{ message_id?: string }>(`${GRAPH}/me/messages`, {
    label: "Messenger", method: "POST", headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: body } }),
  });
  return r.message_id ?? null;
}
export async function sendInstagram(token: string, igsid: string, body: string) {
  const r = await call<{ message_id?: string }>(`${IG_GRAPH}/me/messages`, {
    label: "Instagram", method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: body } }),
  });
  return r.message_id ?? null;
}

/** Downloads WhatsApp media (two steps: media URL, then bytes with the same token). Fails soft. */
async function whatsappMedia(token: string, mediaId: string, fallbackName: string): Promise<InboundFile | null> {
  try {
    const meta = await call<{ url: string; mime_type: string; file_size?: number }>(`${GRAPH}/${encodeURIComponent(mediaId)}`, { label: "WhatsApp", headers: { Authorization: `Bearer ${token}` } });
    if (meta.file_size && meta.file_size > 10 * 1024 * 1024) return null;
    const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return { filename: fallbackName, mimeType: meta.mime_type, data: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}

type WaMessage = { from: string; id: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }; image?: { id: string; caption?: string }; document?: { id: string; filename?: string; caption?: string }; audio?: { id: string }; video?: { id: string; caption?: string }; location?: { latitude: number; longitude: number; name?: string } };
type WaStatus = { id: string; status: "sent" | "delivered" | "read" | "failed"; errors?: { title?: string; message?: string }[] };

export interface Parsed { messages: Inbound[]; receipts: { providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error?: string }[]; reads: { handle: string; watermark: Date }[] }

export async function parseWhatsApp(payload: unknown, phoneNumberId: string, token: string): Promise<Parsed> {
  const out: Parsed = { messages: [], receipts: [], reads: [] };
  const p = payload as { object?: string; entry?: { changes?: { field: string; value: { metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[]; statuses?: WaStatus[] } }[] }[] };
  if (p.object !== "whatsapp_business_account") return out;
  for (const e of p.entry ?? []) for (const ch of e.changes ?? []) {
    const v = ch.value;
    if (ch.field !== "messages" || v.metadata?.phone_number_id !== phoneNumberId) continue;
    for (const m of v.messages ?? []) {
      const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
      const attachments: InboundFile[] = [];
      let body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
      const media = m.image ?? m.document ?? m.audio ?? m.video;
      if (media) {
        const f = await whatsappMedia(token, media.id, m.document?.filename ?? `${m.type}-${m.id.slice(-8)}`);
        if (f) attachments.push(f);
        const caption = "caption" in media && typeof media.caption === "string" ? media.caption : "";
        body ||= caption || `[${m.type}${f ? "" : " — couldn't be downloaded"}]`;
      }
      if (m.location) body ||= `📍 ${m.location.name ? `${m.location.name} ` : ""}https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`;
      out.messages.push({
        handle: m.from, name, phone: m.from, identity: { provider: "whatsapp", externalId: m.from }, body: body || `[${m.type} message]`,
        providerMessageId: m.id, at: new Date(Number(m.timestamp) * 1000), attachments, metadata: { type: m.type },
      });
    }
    for (const s of v.statuses ?? []) out.receipts.push({ providerMessageId: s.id, status: s.status, error: s.errors?.[0]?.message ?? s.errors?.[0]?.title });
  }
  return out;
}

type FbEvent = { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: { mid: string; text?: string; is_echo?: boolean; attachments?: { type: string; payload?: { url?: string } }[] }; delivery?: { mids?: string[] }; read?: { watermark: number } };

/** Messenger (`object: page`) and Instagram (`object: instagram`) share the messaging event shape. */
export function parseMetaMessaging(payload: unknown, object: "page" | "instagram", accountId: string, provider: "facebook" | "instagram"): Parsed {
  const out: Parsed = { messages: [], receipts: [], reads: [] };
  const p = payload as { object?: string; entry?: { id: string; messaging?: FbEvent[] }[] };
  if (p.object !== object) return out;
  for (const e of p.entry ?? []) {
    if (e.id !== accountId) continue;
    for (const ev of e.messaging ?? []) {
      if (ev.message && !ev.message.is_echo && ev.sender.id !== accountId) {
        const links = (ev.message.attachments ?? []).map((a) => (a.payload?.url ? `[${a.type}] ${a.payload.url}` : `[${a.type}]`));
        out.messages.push({
          handle: ev.sender.id, identity: { provider, externalId: ev.sender.id }, body: [ev.message.text, ...links].filter(Boolean).join("\n") || "[attachment]",
          providerMessageId: ev.message.mid, at: new Date(ev.timestamp),
        });
      }
      for (const mid of ev.delivery?.mids ?? []) out.receipts.push({ providerMessageId: mid, status: "delivered" });
      if (ev.read) out.reads.push({ handle: ev.sender.id, watermark: new Date(ev.read.watermark) });
    }
  }
  return out;
}

/** Best-effort profile name lookup for Messenger/Instagram contacts. */
export async function metaProfileName(channel: "messenger" | "instagram", token: string, id: string) {
  try {
    if (channel === "messenger") {
      const r = await call<{ first_name?: string; last_name?: string; name?: string }>(`${GRAPH}/${encodeURIComponent(id)}?fields=first_name,last_name`, { label: "Facebook", headers: { Authorization: `Bearer ${token}` } });
      return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.name || null;
    }
    const r = await call<{ name?: string; username?: string }>(`${IG_GRAPH}/${encodeURIComponent(id)}?fields=name,username`, { label: "Instagram", headers: { Authorization: `Bearer ${token}` } });
    return r.name || (r.username ? `@${r.username}` : null);
  } catch {
    return null;
  }
}

/* ───────── Email via Postmark ───────── */

export async function checkPostmark(serverToken: string) {
  return call<{ ID: number; Name: string; InboundAddress?: string; InboundHookUrl?: string }>(`${POSTMARK}/server`, { label: "Postmark", headers: { Accept: "application/json", "X-Postmark-Server-Token": serverToken } });
}
/** Points the server's inbound stream at SalesGel so new email arrives without manual setup. */
export async function setPostmarkInboundHook(serverToken: string, url: string) {
  await call(`${POSTMARK}/server`, { label: "Postmark", method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": serverToken }, body: JSON.stringify({ InboundHookUrl: url }) });
}

export async function sendPostmark(serverToken: string, m: { from: string; to: string; subject: string; text: string; replyTo?: string; inReplyTo?: string | null; references?: string[] }) {
  const headers = [
    ...(m.inReplyTo ? [{ Name: "In-Reply-To", Value: m.inReplyTo }] : []),
    ...(m.references?.length ? [{ Name: "References", Value: m.references.join(" ") }] : []),
  ];
  const r = await call<{ MessageID?: string; ErrorCode?: number; Message?: string }>(`${POSTMARK}/email`, {
    label: "Postmark", method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": serverToken },
    body: JSON.stringify({ From: m.from, To: m.to, Subject: m.subject, TextBody: m.text, ReplyTo: m.replyTo, Headers: headers, MessageStream: "outbound" }),
  });
  if (r.ErrorCode) throw new ChannelError(r.Message ?? "Postmark refused the message", false, String(r.ErrorCode));
  return r.MessageID ?? null;
}

export function checkBasicAuth(header: string | null, user: string, pass: string) {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return safeEqual(decoded, `${user}:${pass}`);
}

type PmInbound = {
  FromName?: string; From?: string; FromFull?: { Email: string; Name?: string }; Subject?: string; MessageID?: string; MailboxHash?: string;
  TextBody?: string; StrippedTextReply?: string; HtmlBody?: string; Date?: string;
  Headers?: { Name: string; Value: string }[]; Attachments?: { Name: string; Content: string; ContentType: string; ContentLength: number }[];
};

/** Strips HTML to readable text (only used when an email has no plain-text part). */
function htmlToText(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}

export function parsePostmark(payload: unknown): Inbound & { replyToken: string | null; rfcMessageId: string | null; references: string[] } {
  const p = payload as PmInbound;
  const header = (n: string) => p.Headers?.find((h) => h.Name.toLowerCase() === n.toLowerCase())?.Value ?? null;
  const email = (p.FromFull?.Email ?? p.From ?? "").trim().toLowerCase();
  if (!email) throw new ChannelError("Email without a sender");
  const rfc = header("Message-ID");
  const refs = [header("In-Reply-To"), ...(header("References")?.split(/\s+/) ?? [])].filter((x): x is string => !!x);
  const text = (p.StrippedTextReply?.trim() || p.TextBody?.trim() || (p.HtmlBody ? htmlToText(p.HtmlBody) : "")).slice(0, 50_000);
  return {
    handle: email, email, name: p.FromFull?.Name || p.FromName || null, subject: p.Subject?.slice(0, 300) ?? null, body: text || "(no text content)",
    providerMessageId: p.MessageID ?? rfc, at: p.Date && !Number.isNaN(Date.parse(p.Date)) ? new Date(p.Date) : undefined,
    attachments: (p.Attachments ?? []).filter((a) => a.ContentLength <= 10 * 1024 * 1024).map((a) => ({ filename: a.Name, mimeType: a.ContentType, data: Buffer.from(a.Content, "base64") })),
    metadata: { rfcMessageId: rfc, references: refs }, replyToken: p.MailboxHash?.trim() || null, rfcMessageId: rfc, references: refs, threadKey: refs[refs.length - 1] ?? rfc,
  };
}

/** Builds the per-conversation reply address: inbound+<token>@domain (Postmark returns <token> as MailboxHash). */
export function replyAddress(inbound: string, conversationId: string) {
  const [local, domain] = inbound.split("@");
  if (!local || !domain) return inbound;
  return `${local.split("+")[0]}+c${conversationId.replace(/-/g, "")}@${domain}`;
}
export function conversationIdFromToken(token: string | null) {
  const m = token ? /^c([0-9a-f]{32})$/i.exec(token) : null;
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
