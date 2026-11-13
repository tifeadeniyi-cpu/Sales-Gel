import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { customerEmails, customerIdentities, customerPhones, customers } from "@/domains/customers/schema";
import { normalizeEmail, normalizePhone } from "@/domains/customers/normalize";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { files } from "@/domains/support/schema";
import { emit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { newId } from "@/lib/ids";
import { WINDOWED } from "./labels";
import { channelConnections, conversationAttachments, conversationMessages, conversations, type Channel } from "./schema";

export type Connection = typeof channelConnections.$inferSelect;
export interface InboundFile { filename: string; mimeType: string; data: Buffer }

export interface Inbound {
  handle: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  identity?: { provider: "whatsapp" | "facebook" | "instagram"; externalId: string } | null;
  body: string;
  providerMessageId?: string | null;
  subject?: string | null;
  /** Route straight to this conversation (email reply address, web chat session). */
  conversationId?: string | null;
  threadKey?: string | null;
  attachments?: InboundFile[];
  at?: Date;
  metadata?: Record<string, unknown>;
}

const WINDOW_MS = 24 * 3_600_000;
const MAX_FILE = 10 * 1024 * 1024;
const preview = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 140);

/** Finds an existing customer by the contact's email, phone or channel identity. Never creates one. */
export async function matchCustomer(tx: Tx, orgId: string, c: Pick<Inbound, "email" | "phone" | "identity">) {
  if (c.identity) {
    const [hit] = await tx.select({ id: customers.id }).from(customerIdentities).innerJoin(customers, eq(customers.id, customerIdentities.customerId))
      .where(and(eq(customerIdentities.organizationId, orgId), eq(customerIdentities.provider, c.identity.provider), eq(customerIdentities.externalId, c.identity.externalId), ne(customers.status, "merged"))).limit(1);
    if (hit) return hit.id;
  }
  if (c.email) {
    const [hit] = await tx.select({ id: customers.id }).from(customerEmails).innerJoin(customers, eq(customers.id, customerEmails.customerId))
      .where(and(eq(customerEmails.organizationId, orgId), eq(customerEmails.normalizedEmail, normalizeEmail(c.email)), ne(customers.status, "merged"))).limit(1);
    if (hit) return hit.id;
  }
  const phone = c.phone ? normalizePhone(c.phone.startsWith("+") ? c.phone : `+${c.phone}`) : null;
  if (phone) {
    const [hit] = await tx.select({ id: customers.id }).from(customerPhones).innerJoin(customers, eq(customers.id, customerPhones.customerId))
      .where(and(eq(customerPhones.organizationId, orgId), eq(customerPhones.e164, phone), ne(customers.status, "merged"))).limit(1);
    if (hit) return hit.id;
  }
  return null;
}

async function storeFile(tx: Tx, orgId: string, messageId: string, f: InboundFile) {
  if (!f.data.length || f.data.length > MAX_FILE) return false;
  const fileId = newId();
  await tx.insert(files).values({ id: fileId, organizationId: orgId, filename: f.filename.slice(0, 200) || "attachment", mimeType: f.mimeType || "application/octet-stream", sizeBytes: f.data.length, sha256: createHash("sha256").update(f.data).digest("hex"), storage: "db", content: f.data });
  await tx.insert(conversationAttachments).values({ organizationId: orgId, messageId, fileId });
  return true;
}

/**
 * Records a message from a customer: de-duplicates by provider id, finds (or starts) the
 * conversation, links a matching customer, re-opens pending/closed threads and alerts the assignee.
 */
export async function ingestInbound(tx: Tx, orgId: string, conn: Connection, m: Inbound) {
  if (m.providerMessageId) {
    const [dup] = await tx.select({ id: conversationMessages.id, conversationId: conversationMessages.conversationId }).from(conversationMessages)
      .where(and(eq(conversationMessages.connectionId, conn.id), eq(conversationMessages.providerMessageId, m.providerMessageId)));
    if (dup) return { conversationId: dup.conversationId, messageId: dup.id, duplicate: true };
  }
  const at = m.at ?? new Date();
  let conv: typeof conversations.$inferSelect | undefined;
  if (m.conversationId) {
    [conv] = await tx.select().from(conversations).where(and(eq(conversations.organizationId, orgId), eq(conversations.id, m.conversationId), eq(conversations.connectionId, conn.id))).for("update");
  }
  if (!conv) {
    // Continue the latest conversation with this contact unless it was closed.
    [conv] = await tx.select().from(conversations).where(and(eq(conversations.organizationId, orgId), eq(conversations.connectionId, conn.id), eq(conversations.contactHandle, m.handle), ne(conversations.status, "closed")))
      .orderBy(desc(conversations.lastMessageAt)).limit(1).for("update");
  }
  let created = false;
  if (!conv) {
    const customerId = await matchCustomer(tx, orgId, m);
    const id = newId();
    const number = await nextNumber(tx, orgId, "conversation");
    [conv] = await tx.insert(conversations).values({
      id, organizationId: orgId, number, channel: conn.channel as Channel, connectionId: conn.id, customerId, contactHandle: m.handle, contactName: m.name ?? null,
      contactEmail: m.email ? m.email.trim().toLowerCase() : null, subject: m.subject ?? null, threadKey: m.threadKey ?? null, lastMessageAt: at,
    }).returning();
    created = true;
  }
  const mid = newId();
  await tx.insert(conversationMessages).values({
    id: mid, organizationId: orgId, conversationId: conv.id, connectionId: conn.id, direction: "inbound", body: m.body.slice(0, 50_000) || "(empty message)",
    providerMessageId: m.providerMessageId ?? null, deliveryStatus: "received", metadata: m.metadata ?? {}, createdAt: at,
  });
  let stored = 0;
  for (const f of m.attachments ?? []) if (await storeFile(tx, orgId, mid, f)) stored++;
  const patch: Partial<typeof conversations.$inferInsert> = {
    lastMessageAt: at, lastInboundAt: at, lastPreview: preview(m.body), updatedAt: new Date(),
    ...(conv.status !== "open" ? { status: "open" } : {}),
    ...(WINDOWED.includes(conv.channel) ? { windowExpiresAt: new Date(at.getTime() + WINDOW_MS) } : {}),
    ...(m.name && !conv.contactName ? { contactName: m.name } : {}),
    ...(m.email && !conv.contactEmail ? { contactEmail: m.email.trim().toLowerCase() } : {}),
    ...(!conv.customerId ? { customerId: (await matchCustomer(tx, orgId, m)) ?? null } : {}),
  };
  await tx.update(conversations).set(patch).where(eq(conversations.id, conv.id));
  await tx.update(channelConnections).set({ lastInboundAt: at }).where(eq(channelConnections.id, conn.id));
  if (patch.customerId ?? conv.customerId) await tx.update(customers).set({ lastActivityAt: at }).where(eq(customers.id, (patch.customerId ?? conv.customerId)!));
  if (conv.assigneeMembershipId) {
    const [mem] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, conv.assigneeMembershipId));
    const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
    if (mem) await notify(tx, { orgId, recipientUserId: mem.userId, type: "conversation.message", title: `New message from ${conv.contactName ?? m.name ?? "a customer"}`, body: preview(m.body), link: `/o/${org.slug}/inbox?c=${conv.id}`, entityType: "conversation", entityId: conv.id });
  }
  await emit(tx, orgId, created ? "conversation.started" : "conversation.message_received", { conversationId: conv.id, messageId: mid, channel: conn.channel });
  return { conversationId: conv.id, messageId: mid, duplicate: false, created, attachments: stored };
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Provider delivery receipts only move forward (sent → delivered → read); failures are final. */
export async function updateDelivery(tx: Tx, connectionId: string, providerMessageId: string, status: "sent" | "delivered" | "read" | "failed", error?: string | null) {
  const [msg] = await tx.select({ id: conversationMessages.id, status: conversationMessages.deliveryStatus }).from(conversationMessages)
    .where(and(eq(conversationMessages.connectionId, connectionId), eq(conversationMessages.providerMessageId, providerMessageId)));
  if (!msg || msg.status === "failed") return false;
  if (status !== "failed" && (RANK[status] ?? 0) <= (RANK[msg.status] ?? 0)) return false;
  await tx.update(conversationMessages).set({ deliveryStatus: status, error: status === "failed" ? (error ?? "Delivery failed").slice(0, 500) : null }).where(eq(conversationMessages.id, msg.id));
  return true;
}

/** Messages Meta reports read up to a watermark (Messenger/Instagram read receipts). */
export async function markReadUpTo(tx: Tx, conn: Connection, handle: string, watermark: Date) {
  const convs = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.connectionId, conn.id), eq(conversations.contactHandle, handle)));
  if (!convs.length) return;
  await tx.update(conversationMessages).set({ deliveryStatus: "read" })
    .where(and(inArray(conversationMessages.conversationId, convs.map((c) => c.id)), eq(conversationMessages.direction, "outbound"), inArray(conversationMessages.deliveryStatus, ["sent", "delivered"]), sql`${conversationMessages.sentAt} <= ${watermark.toISOString()}::timestamptz`));
}
