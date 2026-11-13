import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { organizations } from "@/domains/identity/schema";
import { integrationRoutes } from "@/domains/integrations/schema";
import { portalSubmissions } from "@/domains/support/schema";
import type { Tx } from "@/server/db/client";
import { withScope } from "@/server/db/tenant";
import { ConflictError, NotFoundError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { ROUTE_WEBCHAT } from "./connections";
import { ingestInbound, type Connection } from "./ingest";
import { channelConnections, conversationMessages, conversations } from "./schema";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const LIMITS = { chat_start: 5, chat_message: 60 };

async function widget(publicKey: string): Promise<{ orgId: string; conn: Connection; orgName: string } | null> {
  if (!/^wc_[A-Za-z0-9_-]{10,40}$/.test(publicKey)) return null;
  const [route] = await withScope({}, (tx) => tx.select().from(integrationRoutes).where(and(eq(integrationRoutes.provider, ROUTE_WEBCHAT), eq(integrationRoutes.externalAccountId, publicKey))));
  if (!route) return null;
  return withScope({ orgId: route.organizationId }, async (tx) => {
    const [conn] = await tx.select().from(channelConnections).where(and(eq(channelConnections.id, route.connectionId), eq(channelConnections.status, "active")));
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, route.organizationId));
    return conn ? { orgId: route.organizationId, conn, orgName: org.name } : null;
  });
}

export async function getWidgetConfig(publicKey: string) {
  const w = await widget(publicKey);
  if (!w) return null;
  const s = w.conn.settings as { title?: string; greeting?: string; color?: string; askEmail?: boolean };
  return { title: s.title ?? w.orgName, greeting: s.greeting ?? "Hi! How can we help?", color: s.color ?? "#0053ee", askEmail: s.askEmail ?? true, orgName: w.orgName };
}

async function limit(tx: Tx, orgId: string, kind: keyof typeof LIMITS, ip: string) {
  const h = sha(`${process.env.BETTER_AUTH_SECRET ?? ""}:${ip}`);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(portalSubmissions)
    .where(and(eq(portalSubmissions.organizationId, orgId), eq(portalSubmissions.kind, kind), eq(portalSubmissions.ipHash, h), gt(portalSubmissions.createdAt, new Date(Date.now() - 3_600_000))));
  if (n >= LIMITS[kind]) throw new ConflictError("Too many messages. Please wait a little and try again.");
  await tx.insert(portalSubmissions).values({ organizationId: orgId, ipHash: h, email: "-", kind });
}

const startSchema = z.object({
  name: z.string().trim().max(120).optional().transform((v) => v || null),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email").max(200)]).optional().transform((v) => v || null),
  message: z.string().trim().min(1, "Type a message").max(4000),
  website: z.string().max(0).optional(),
});

/** A visitor opens a chat. Returns the secret their browser keeps to continue it. */
export async function startChat(publicKey: string, input: unknown, meta: { ip: string; page?: string | null }) {
  const w = await widget(publicKey);
  if (!w) throw new NotFoundError("This chat isn't available.");
  const d = parseInput(startSchema, input);
  if ((w.conn.settings as { askEmail?: boolean }).askEmail && !d.email) throw new ConflictError("Please add your email so we can reply if you leave.");
  const secret = randomBytes(24).toString("base64url");
  return withScope({ orgId: w.orgId }, async (tx) => {
    await limit(tx, w.orgId, "chat_start", meta.ip);
    const visitorId = `visitor:${randomBytes(9).toString("base64url")}`;
    const r = await ingestInbound(tx, w.orgId, w.conn, { handle: visitorId, name: d.name, email: d.email, body: d.message, metadata: { page: meta.page?.slice(0, 500) ?? null } });
    await tx.update(conversations).set({ visitorTokenHash: sha(secret) }).where(eq(conversations.id, r.conversationId));
    return { token: secret };
  });
}

async function chatFor(tx: Tx, connId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [c] = await tx.select().from(conversations).where(and(eq(conversations.connectionId, connId), eq(conversations.visitorTokenHash, sha(token))));
  return c ?? null;
}

/** The visitor's view: their messages and the team's replies (never internal notes). */
export async function visitorMessages(publicKey: string, token: string) {
  const w = await widget(publicKey);
  if (!w) return null;
  return withScope({ orgId: w.orgId }, async (tx) => {
    const c = await chatFor(tx, w.conn.id, token);
    if (!c) return null;
    const rows = await tx.select({ id: conversationMessages.id, direction: conversationMessages.direction, body: conversationMessages.body, createdAt: conversationMessages.createdAt, status: conversationMessages.deliveryStatus })
      .from(conversationMessages).where(and(eq(conversationMessages.conversationId, c.id), ne(conversationMessages.direction, "note"))).orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
    // A reply counts as delivered once the visitor's widget has fetched it.
    await tx.update(conversationMessages).set({ deliveryStatus: "delivered" }).where(and(eq(conversationMessages.conversationId, c.id), eq(conversationMessages.direction, "outbound"), eq(conversationMessages.deliveryStatus, "sent")));
    return { closed: c.status === "closed", messages: rows.filter((r) => r.direction === "inbound" || r.status !== "queued").map((r) => ({ id: r.id, from: r.direction === "inbound" ? ("you" as const) : ("team" as const), body: r.body, createdAt: r.createdAt })) };
  });
}

export async function visitorSend(publicKey: string, token: string, input: unknown, meta: { ip: string }) {
  const w = await widget(publicKey);
  if (!w) throw new NotFoundError("This chat isn't available.");
  const { body } = parseInput(z.object({ body: z.string().trim().min(1, "Type a message").max(4000) }), input);
  return withScope({ orgId: w.orgId }, async (tx) => {
    const c = await chatFor(tx, w.conn.id, token);
    if (!c) throw new NotFoundError("This chat has ended. Start a new one.");
    await limit(tx, w.orgId, "chat_message", meta.ip);
    const r = await ingestInbound(tx, w.orgId, w.conn, { handle: c.contactHandle, body, conversationId: c.id });
    return { id: r.messageId };
  });
}
