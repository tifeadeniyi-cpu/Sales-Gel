import "server-only";
import { and, eq } from "drizzle-orm";
import { integrationRoutes } from "@/domains/integrations/schema";
import { decryptJson, safeEqual } from "@/server/crypto";
import { withScope } from "@/server/db/tenant";
import { logger } from "@/server/logger";
import { checkBasicAuth, conversationIdFromToken, metaProfileName, parseMetaMessaging, parsePostmark, parseWhatsApp, verifyMetaSignature, type Parsed } from "./channels";
import { ROUTE_CONN, type EmailCreds, type MetaCreds } from "./connections";
import { ingestInbound, markReadUpTo, updateDelivery, type Connection } from "./ingest";
import { channelConnections } from "./schema";

async function connectionFor(connectionId: string): Promise<{ orgId: string; conn: Connection } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const [route] = await withScope({}, (tx) => tx.select().from(integrationRoutes).where(and(eq(integrationRoutes.provider, ROUTE_CONN), eq(integrationRoutes.externalAccountId, connectionId))));
  if (!route) return null;
  const conn = await withScope({ orgId: route.organizationId }, async (tx) => (await tx.select().from(channelConnections).where(eq(channelConnections.id, connectionId)))[0]);
  return conn && conn.status !== "disconnected" && conn.credentials ? { orgId: route.organizationId, conn } : null;
}

/** Meta's one-time subscription check: echo hub.challenge when the verify token matches. */
export async function verifyInboxWebhook(connectionId: string, params: URLSearchParams) {
  const hit = await connectionFor(connectionId);
  if (!hit || !["whatsapp", "messenger", "instagram"].includes(hit.conn.channel)) return null;
  const creds = decryptJson<MetaCreds>(hit.conn.credentials!);
  const token = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !safeEqual(token, creds.verifyToken)) return null;
  await withScope({ orgId: hit.orgId }, (tx) => tx.update(channelConnections).set({ settings: { ...hit.conn.settings, webhookVerifiedAt: new Date().toISOString() }, lastError: null }).where(eq(channelConnections.id, connectionId)));
  return params.get("hub.challenge") ?? "";
}

/**
 * Inbound delivery from a provider. Authenticates first (Meta signature / Postmark Basic Auth),
 * then records messages and receipts. Duplicate deliveries are no-ops.
 */
export async function receiveInboxWebhook(connectionId: string, raw: string, headers: Headers): Promise<{ status: number; body?: string; processed?: number }> {
  const hit = await connectionFor(connectionId);
  if (!hit) return { status: 404 };
  const { orgId, conn } = hit;
  let payload: unknown;
  if (conn.channel === "email") {
    const cr = decryptJson<EmailCreds>(conn.credentials!);
    if (!checkBasicAuth(headers.get("authorization"), cr.hookUser, cr.hookPass)) return { status: 401 };
  } else {
    const cr = decryptJson<MetaCreds>(conn.credentials!);
    if (!verifyMetaSignature(raw, headers.get("x-hub-signature-256"), cr.appSecret)) return { status: 401 };
  }
  try { payload = JSON.parse(raw); } catch { return { status: 400 }; }

  if (conn.channel === "email") {
    let mail: ReturnType<typeof parsePostmark>;
    try { mail = parsePostmark(payload); } catch { return { status: 200, processed: 0 } ; }
    // Bounces and auto-replies to our own sending address are not customer messages.
    if (mail.email === String(conn.settings.fromEmail ?? "").toLowerCase()) return { status: 200, processed: 0 };
    const r = await withScope({ orgId }, (tx) => ingestInbound(tx, orgId, conn, { ...mail, conversationId: conversationIdFromToken(mail.replyToken) }));
    return { status: 200, processed: r.duplicate ? 0 : 1 };
  }

  const cr = decryptJson<MetaCreds>(conn.credentials!);
  let parsed: Parsed;
  if (conn.channel === "whatsapp") parsed = await parseWhatsApp(payload, conn.externalAccountId!, cr.accessToken);
  else if (conn.channel === "messenger") parsed = parseMetaMessaging(payload, "page", conn.externalAccountId!, "facebook");
  else parsed = parseMetaMessaging(payload, "instagram", conn.externalAccountId!, "instagram");
  // Profile names for new Messenger/Instagram contacts (best effort, outside the transaction).
  if (conn.channel !== "whatsapp") {
    for (const m of parsed.messages) m.name ??= await metaProfileName(conn.channel as "messenger" | "instagram", cr.accessToken, m.handle);
  }
  let processed = 0;
  await withScope({ orgId }, async (tx) => {
    for (const m of parsed.messages) if (!(await ingestInbound(tx, orgId, conn, m)).duplicate) processed++;
    for (const r of parsed.receipts) await updateDelivery(tx, conn.id, r.providerMessageId, r.status, r.error);
    for (const r of parsed.reads) await markReadUpTo(tx, conn, r.handle, r.watermark);
  });
  if (parsed.messages.length + parsed.receipts.length === 0) logger.info({ connectionId, channel: conn.channel }, "inbox webhook had nothing for this connection");
  return { status: 200, processed };
}
