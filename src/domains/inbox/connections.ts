import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { integrationRoutes } from "@/domains/integrations/schema";
import { audit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import { appUrl } from "@/server/app-url";
import { decryptJson, encryptionConfigured, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { ChannelError, checkInstagram, checkMessenger, checkPostmark, checkWhatsApp, setPostmarkInboundHook } from "./channels";
import { channelConnections, type Channel } from "./schema";

export const ROUTE_CONN = "inbox:conn";
export const ROUTE_WEBCHAT = "inbox:webchat";

export const canManageChannels = (ctx: OrgContext) => ctx.permissions.has("integrations.manage");
function needManage(ctx: OrgContext) {
  if (!canManageChannels(ctx)) throw new ForbiddenError("Only workspace admins can connect channels.");
}
function needEncryption() {
  if (!encryptionConfigured()) throw new ConflictError("Channels can't be connected on this server yet (missing encryption key).");
}
const secret = (n = 24) => randomBytes(n).toString("base64url");
export const webhookUrl = (id: string) => `${appUrl()}/api/webhooks/inbox/${id}`;

export interface MetaCreds { accessToken: string; appSecret: string; verifyToken: string }
export interface EmailCreds { serverToken: string; hookUser: string; hookPass: string }
export function credsOf<T>(c: { credentials: string | null }): T {
  if (!c.credentials) throw new ConflictError("This channel is disconnected.");
  return decryptJson<T>(c.credentials);
}

async function insertConnection(tx: Tx, ctx: OrgContext, v: { id?: string; channel: Channel; name: string; externalAccountId?: string | null; credentials?: unknown; settings?: Record<string, unknown>; publicKey?: string | null }) {
  const id = v.id ?? newId();
  await tx.insert(channelConnections).values({
    id, organizationId: ctx.orgId, channel: v.channel, name: v.name, externalAccountId: v.externalAccountId ?? null,
    credentials: v.credentials ? encryptJson(v.credentials) : null, settings: v.settings ?? {}, publicKey: v.publicKey ?? null, createdByUserId: ctx.userId,
  });
  await tx.insert(integrationRoutes).values(v.publicKey
    ? { provider: ROUTE_WEBCHAT, externalAccountId: v.publicKey, connectionId: id, organizationId: ctx.orgId }
    : { provider: ROUTE_CONN, externalAccountId: id, connectionId: id, organizationId: ctx.orgId });
  await audit(tx, ctx, { action: "channel.connected", entityType: "channel", entityId: id, metadata: { channel: v.channel, name: v.name } });
  return id;
}

async function assertNotDuplicate(tx: Tx, ctx: OrgContext, channel: Channel, externalAccountId: string) {
  const [dup] = await tx.select({ id: channelConnections.id }).from(channelConnections)
    .where(and(eq(channelConnections.organizationId, ctx.orgId), eq(channelConnections.channel, channel), eq(channelConnections.externalAccountId, externalAccountId), eq(channelConnections.status, "active")));
  if (dup) throw new ConflictError("That account is already connected.");
}

const wrap = async <T>(fn: () => Promise<T>, field: string) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChannelError) throw new ValidationError(`The provider rejected these details: ${e.message}`, { [field]: [e.message] });
    throw e;
  }
};

/* ───────── web chat ───────── */

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0053ee");
const webchatSchema = z.object({
  name: z.string().trim().min(1, "Name this channel").max(60),
  title: z.string().trim().min(1, "Give the chat a title").max(60),
  greeting: z.string().trim().max(300).default("Hi! How can we help?"),
  color: color.default("#0053ee"),
  askEmail: z.boolean().default(true),
});

export async function connectWebchat(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  const d = parseInput(webchatSchema, input);
  return withTenant(ctx, async (tx) => {
    const publicKey = `wc_${secret(15)}`;
    const id = await insertConnection(tx, ctx, { channel: "webchat", name: d.name, settings: { title: d.title, greeting: d.greeting, color: d.color, askEmail: d.askEmail }, publicKey });
    return { id, publicKey };
  });
}

export async function updateWebchat(ctx: OrgContext, id: string, input: unknown) {
  needManage(ctx);
  const d = parseInput(webchatSchema, input);
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.update(channelConnections).set({ name: d.name, settings: { title: d.title, greeting: d.greeting, color: d.color, askEmail: d.askEmail }, updatedAt: new Date() })
      .where(and(eq(channelConnections.organizationId, ctx.orgId), eq(channelConnections.id, id), eq(channelConnections.channel, "webchat"))).returning({ id: channelConnections.id });
    if (!c) throw new NotFoundError("Channel not found.");
    await audit(tx, ctx, { action: "channel.updated", entityType: "channel", entityId: id, metadata: { name: d.name } });
  });
}

/* ───────── email (Postmark) ───────── */

const emailSchema = z.object({
  name: z.string().trim().min(1, "Name this inbox").max(60),
  serverToken: z.string().trim().min(20, "Paste the server API token").max(200),
  fromEmail: z.string().trim().email("Enter the address customers will see"),
  fromName: z.string().trim().min(1, "Enter a sender name").max(80),
});

export async function connectEmail(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  needEncryption();
  const d = parseInput(emailSchema, input);
  const server = await wrap(() => checkPostmark(d.serverToken), "serverToken");
  if (!server.InboundAddress) throw new ValidationError("This Postmark server has no inbound address. Enable its inbound stream first.", { serverToken: ["No inbound stream"] });
  const id = newId();
  const creds: EmailCreds = { serverToken: d.serverToken, hookUser: `sg_${secret(6)}`, hookPass: secret(24) };
  const hook = webhookUrl(id).replace("://", `://${creds.hookUser}:${creds.hookPass}@`);
  let hookConfigured = true;
  try { await setPostmarkInboundHook(d.serverToken, hook); } catch { hookConfigured = false; }
  return withTenant(ctx, async (tx) => {
    await assertNotDuplicate(tx, ctx, "email", d.fromEmail.toLowerCase());
    await insertConnection(tx, ctx, {
      id, channel: "email", name: d.name, externalAccountId: d.fromEmail.toLowerCase(), credentials: creds,
      settings: { fromEmail: d.fromEmail, fromName: d.fromName, inboundAddress: server.InboundAddress, serverName: server.Name, hookConfigured },
    });
    return { id, inboundAddress: server.InboundAddress, hookConfigured };
  });
}

/* ───────── Meta channels ───────── */

const appSecret = z.string().trim().regex(/^[0-9a-f]{32}$/i, "The app secret is 32 letters and numbers (App settings → Basic)");
const token = z.string().trim().min(20, "Paste the access token").max(1000);

export async function connectWhatsApp(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  needEncryption();
  const d = parseInput(z.object({ accessToken: token, phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "Use the numeric Phone number ID"), appSecret }), input);
  const info = await wrap(() => checkWhatsApp(d.accessToken, d.phoneNumberId), "accessToken");
  return withTenant(ctx, async (tx) => {
    await assertNotDuplicate(tx, ctx, "whatsapp", d.phoneNumberId);
    const id = await insertConnection(tx, ctx, { channel: "whatsapp", name: info.name, externalAccountId: d.phoneNumberId, credentials: { accessToken: d.accessToken, appSecret: d.appSecret, verifyToken: secret(18) } satisfies MetaCreds, settings: { phone: info.phone } });
    return { id };
  });
}

export async function connectMessenger(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  needEncryption();
  const d = parseInput(z.object({ accessToken: token, appSecret }), input);
  const page = await wrap(() => checkMessenger(d.accessToken), "accessToken");
  return withTenant(ctx, async (tx) => {
    await assertNotDuplicate(tx, ctx, "messenger", page.id);
    const id = await insertConnection(tx, ctx, { channel: "messenger", name: page.name, externalAccountId: page.id, credentials: { accessToken: d.accessToken, appSecret: d.appSecret, verifyToken: secret(18) } satisfies MetaCreds });
    return { id };
  });
}

export async function connectInstagram(ctx: OrgContext, input: unknown) {
  needManage(ctx);
  needEncryption();
  const d = parseInput(z.object({ accessToken: token, appSecret }), input);
  const ig = await wrap(() => checkInstagram(d.accessToken), "accessToken");
  if (!ig.id) throw new ValidationError("Couldn't read the Instagram account ID from this token.", { accessToken: ["Missing account ID"] });
  return withTenant(ctx, async (tx) => {
    await assertNotDuplicate(tx, ctx, "instagram", ig.id);
    const id = await insertConnection(tx, ctx, { channel: "instagram", name: ig.name, externalAccountId: ig.id, credentials: { accessToken: d.accessToken, appSecret: d.appSecret, verifyToken: secret(18) } satisfies MetaCreds });
    return { id };
  });
}

/* ───────── shared ───────── */

export async function disconnectChannel(ctx: OrgContext, id: string) {
  needManage(ctx);
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.update(channelConnections).set({ status: "disconnected", credentials: null, disconnectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(channelConnections.organizationId, ctx.orgId), eq(channelConnections.id, id))).returning();
    if (!c) throw new NotFoundError("Channel not found.");
    await tx.delete(integrationRoutes).where(eq(integrationRoutes.connectionId, id));
    await audit(tx, ctx, { action: "channel.disconnected", entityType: "channel", entityId: id, metadata: { channel: c.channel, name: c.name } });
    return { ok: true };
  });
}

/** Channel list without secrets; Meta verify tokens are shown to managers because they paste them into Meta. */
export async function listChannels(ctx: OrgContext) {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(channelConnections).where(eq(channelConnections.organizationId, ctx.orgId)).orderBy(asc(channelConnections.createdAt));
    const manage = canManageChannels(ctx);
    return rows.map((c) => {
      const meta = ["whatsapp", "messenger", "instagram"].includes(c.channel);
      let verifyToken: string | null = null;
      let inboundHookUrl: string | null = null;
      if (manage && meta && c.credentials) {
        try { verifyToken = decryptJson<MetaCreds>(c.credentials).verifyToken; } catch { verifyToken = null; }
      }
      // Only needed when SalesGel couldn't configure Postmark itself; it embeds the webhook password.
      if (manage && c.channel === "email" && c.credentials && !c.settings.hookConfigured) {
        try { const e = decryptJson<EmailCreds>(c.credentials); inboundHookUrl = webhookUrl(c.id).replace("://", `://${e.hookUser}:${e.hookPass}@`); } catch { inboundHookUrl = null; }
      }
      return {
        id: c.id, channel: c.channel, name: c.name, status: c.status, externalAccountId: c.externalAccountId, settings: c.settings, publicKey: c.publicKey,
        lastError: c.lastError, lastInboundAt: c.lastInboundAt, createdAt: c.createdAt,
        webhookUrl: meta ? webhookUrl(c.id) : null, verifyToken, inboundHookUrl,
      };
    });
  });
}
export type ChannelView = Awaited<ReturnType<typeof listChannels>>[number];

export async function markChannelError(tx: Tx, id: string, message: string | null) {
  await tx.update(channelConnections).set({ lastError: message, status: message ? "error" : "active", updatedAt: new Date() }).where(and(eq(channelConnections.id, id)));
}
