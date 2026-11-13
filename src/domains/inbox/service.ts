import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customerEmails, customerIdentities, customerPhones, customers } from "@/domains/customers/schema";
import { deriveDisplayName, normalizeEmail, normalizePhone } from "@/domains/customers/normalize";
import { memberships } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { files, supportTickets } from "@/domains/support/schema";
import { createTicket } from "@/domains/support/service";
import { user } from "@/server/auth/schema";
import { audit, emit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { nextNumber } from "@/server/db/sequences";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { ChannelError, conversationIdFromToken, replyAddress, sendInstagram, sendMessenger, sendPostmark, sendWhatsApp } from "./channels";
import { credsOf, markChannelError, type EmailCreds, type MetaCreds } from "./connections";
import { CHANNEL_LABELS, INBOX_VIEWS, WINDOWED } from "./labels";
import { channelConnections, conversationAttachments, conversationMessages, conversationReads, conversations, savedReplies } from "./schema";

type Conv = typeof conversations.$inferSelect;
type Conn = typeof channelConnections.$inferSelect;

/* ───────── visibility ───────── */

const readAll = (ctx: OrgContext) => ctx.permissions.has("conversations.read");
export const canUseInbox = (ctx: OrgContext) => readAll(ctx) || ctx.permissions.has("conversations.read_assigned");
function needRead(ctx: OrgContext) {
  if (!canUseInbox(ctx)) throw new ForbiddenError("You don't have access to conversations.");
}
function need(ctx: OrgContext, p: "conversations.reply" | "conversations.assign") {
  if (!ctx.permissions.has(p)) throw new ForbiddenError("You don't have permission to do that.");
}
const scope = (ctx: OrgContext): SQL | undefined => (readAll(ctx) ? undefined : eq(conversations.assigneeMembershipId, ctx.membershipId));
const visible = (ctx: OrgContext, c: { assigneeMembershipId: string | null }) => readAll(ctx) || c.assigneeMembershipId === ctx.membershipId;

async function load(tx: Tx, ctx: OrgContext, id: string, lock = false) {
  const q = tx.select().from(conversations).where(and(eq(conversations.organizationId, ctx.orgId), eq(conversations.id, id)));
  const [c] = lock ? await q.for("update") : await q;
  if (!c || !visible(ctx, c)) throw new NotFoundError("Conversation not found.");
  return c;
}

/* ───────── listing ───────── */

const filtersSchema = z.object({
  view: z.enum(INBOX_VIEWS).catch("open"),
  channel: z.string().optional().catch(undefined),
  q: z.string().trim().max(120).optional().transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).catch(1),
});
export type InboxFilters = { view?: string; channel?: string; q?: string; page?: number | string };

function viewWhere(ctx: OrgContext, view: string) {
  switch (view) {
    case "mine": return and(eq(conversations.assigneeMembershipId, ctx.membershipId), ne(conversations.status, "closed"));
    case "unassigned": return and(isNull(conversations.assigneeMembershipId), ne(conversations.status, "closed"));
    case "open": return eq(conversations.status, "open");
    case "pending": return eq(conversations.status, "pending");
    case "closed": return eq(conversations.status, "closed");
    default: return undefined;
  }
}

const PAGE = 40;

export async function listConversations(ctx: OrgContext, filters: InboxFilters = {}) {
  needRead(ctx);
  const f = parseInput(filtersSchema, filters);
  return withTenant(ctx, async (tx) => {
    const conds: (SQL | undefined)[] = [eq(conversations.organizationId, ctx.orgId), scope(ctx), viewWhere(ctx, f.view)];
    if (f.channel && f.channel in CHANNEL_LABELS) conds.push(eq(conversations.channel, f.channel as Conv["channel"]));
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(conversations.contactName, like), ilike(conversations.contactHandle, like), ilike(conversations.contactEmail, like), ilike(conversations.subject, like), ilike(customers.displayName, like), ilike(conversations.lastPreview, like)));
    }
    const where = and(...conds);
    const [{ total }] = await tx.select({ total: count() }).from(conversations).leftJoin(customers, eq(customers.id, conversations.customerId)).where(where);
    const rows = await tx
      .select({
        id: conversations.id, number: conversations.number, channel: conversations.channel, status: conversations.status, contactName: conversations.contactName,
        contactHandle: conversations.contactHandle, contactEmail: conversations.contactEmail, subject: conversations.subject, lastPreview: conversations.lastPreview, lastMessageAt: conversations.lastMessageAt,
        lastInboundAt: conversations.lastInboundAt, customerId: conversations.customerId, customerName: customers.displayName, assigneeMembershipId: conversations.assigneeMembershipId, assigneeName: user.name,
        readAt: conversationReads.lastReadAt,
      })
      .from(conversations)
      .leftJoin(customers, and(eq(customers.organizationId, conversations.organizationId), eq(customers.id, conversations.customerId)))
      .leftJoin(memberships, and(eq(memberships.organizationId, conversations.organizationId), eq(memberships.id, conversations.assigneeMembershipId)))
      .leftJoin(user, eq(user.id, memberships.userId))
      .leftJoin(conversationReads, and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.membershipId, ctx.membershipId)))
      .where(where)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(PAGE)
      .offset((f.page - 1) * PAGE);
    return {
      rows: rows.map(({ readAt, ...r }) => ({ ...r, unread: !!r.lastInboundAt && (!readAt || readAt < r.lastInboundAt), title: displayName(r) })),
      total, page: f.page, pageCount: Math.max(1, Math.ceil(total / PAGE)), filters: f,
    };
  });
}
export type ConversationRow = Awaited<ReturnType<typeof listConversations>>["rows"][number];

export function displayName(c: { customerName?: string | null; contactName: string | null; contactEmail: string | null; contactHandle: string; channel: string }) {
  if (c.customerName) return c.customerName;
  if (c.contactName) return c.contactName;
  if (c.contactEmail) return c.contactEmail;
  if (c.channel === "webchat") return "Website visitor";
  if (c.channel === "whatsapp") return `+${c.contactHandle}`;
  return `${CHANNEL_LABELS[c.channel as Conv["channel"]] ?? "Contact"} user`;
}

/** Counts for the sidebar badge: unread conversations visible to me that are open. */
export async function inboxCounts(ctx: OrgContext) {
  if (!canUseInbox(ctx)) return null;
  return withTenant(ctx, async (tx) => {
    const [r] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
        unread: sql<number>`count(*) filter (where ${conversations.status} <> 'closed' and ${conversations.lastInboundAt} is not null and (${conversationReads.lastReadAt} is null or ${conversationReads.lastReadAt} < ${conversations.lastInboundAt}))::int`,
        mine: sql<number>`count(*) filter (where ${conversations.status} <> 'closed' and ${conversations.assigneeMembershipId} = ${ctx.membershipId})::int`,
        unassigned: sql<number>`count(*) filter (where ${conversations.status} <> 'closed' and ${conversations.assigneeMembershipId} is null)::int`,
      })
      .from(conversations)
      .leftJoin(conversationReads, and(eq(conversationReads.conversationId, conversations.id), eq(conversationReads.membershipId, ctx.membershipId)))
      .where(and(eq(conversations.organizationId, ctx.orgId), scope(ctx)));
    return r;
  });
}

/* ───────── one conversation ───────── */

export function replyState(c: Pick<Conv, "channel" | "windowExpiresAt" | "status">, conn: Pick<Conn, "status">, now = new Date()) {
  if (conn.status === "disconnected") return { canReply: false, reason: "This channel was disconnected. Reconnect it to reply." };
  if (WINDOWED.includes(c.channel) && (!c.windowExpiresAt || c.windowExpiresAt < now)) {
    return { canReply: false, reason: `${CHANNEL_LABELS[c.channel]} only allows free-form replies within 24 hours of the customer's last message. Wait for them to message again, or reach them another way.` };
  }
  return { canReply: true, reason: null as string | null };
}

export async function getConversation(ctx: OrgContext, id: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id);
    const [conn] = await tx.select({ id: channelConnections.id, name: channelConnections.name, status: channelConnections.status, settings: channelConnections.settings }).from(channelConnections).where(eq(channelConnections.id, c.connectionId));
    const author = user;
    const msgs = await tx.select({ m: conversationMessages, authorName: author.name }).from(conversationMessages).leftJoin(author, eq(author.id, conversationMessages.authorUserId))
      .where(eq(conversationMessages.conversationId, id)).orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
    const atts = msgs.length ? await tx.select({ id: conversationAttachments.id, messageId: conversationAttachments.messageId, filename: files.filename, mimeType: files.mimeType, size: files.sizeBytes })
      .from(conversationAttachments).innerJoin(files, eq(files.id, conversationAttachments.fileId)).where(inArray(conversationAttachments.messageId, msgs.map((x) => x.m.id))) : [];
    const [cust] = c.customerId ? await tx.select({ id: customers.id, name: customers.displayName, number: customers.number }).from(customers).where(eq(customers.id, c.customerId)) : [];
    const [assignee] = c.assigneeMembershipId ? await tx.select({ name: user.name }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).where(eq(memberships.id, c.assigneeMembershipId)) : [];
    const [ticket] = c.ticketId ? await tx.select({ id: supportTickets.id, number: supportTickets.number }).from(supportTickets).where(eq(supportTickets.id, c.ticketId)) : [];
    const canSeeCustomer = ctx.permissions.has("customers.read") || ctx.permissions.has("customers.read_assigned");
    return {
      ...c,
      title: displayName({ customerName: canSeeCustomer ? cust?.name : null, ...c }),
      connection: conn ?? null,
      reply: replyState(c, conn ?? { status: "disconnected" }),
      customer: cust && canSeeCustomer ? cust : null,
      assigneeName: assignee?.name ?? null,
      ticket: ticket ?? null,
      messages: msgs.map((x) => ({ ...x.m, authorName: x.authorName, attachments: atts.filter((a) => a.messageId === x.m.id) })),
    };
  });
}
export type ConversationDetail = Awaited<ReturnType<typeof getConversation>>;

export async function markConversationRead(ctx: OrgContext, id: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    await load(tx, ctx, id);
    await tx.insert(conversationReads).values({ organizationId: ctx.orgId, conversationId: id, membershipId: ctx.membershipId, lastReadAt: new Date() })
      .onConflictDoUpdate({ target: [conversationReads.conversationId, conversationReads.membershipId], set: { lastReadAt: new Date() } });
  });
}

export async function getConversationAttachment(ctx: OrgContext, attachmentId: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    const [a] = await tx.select({ conversationId: conversationMessages.conversationId, filename: files.filename, mimeType: files.mimeType, content: files.content })
      .from(conversationAttachments).innerJoin(conversationMessages, eq(conversationMessages.id, conversationAttachments.messageId)).innerJoin(files, eq(files.id, conversationAttachments.fileId))
      .where(and(eq(conversationAttachments.organizationId, ctx.orgId), eq(conversationAttachments.id, attachmentId)));
    if (!a) return null;
    await load(tx, ctx, a.conversationId);
    return a;
  });
}

/* ───────── replying ───────── */

const bodySchema = z.object({ body: z.string().trim().min(1, "Write a message").max(4096, "Keep messages under 4,096 characters") });

/** Hands a reply to the provider. Returns the provider's message id (web chat has none). */
async function deliver(conn: Conn, c: Conv, body: string, lastInbound: { metadata: Record<string, unknown> } | null) {
  switch (c.channel) {
    case "webchat":
      return null; // the visitor's widget fetches it
    case "email": {
      const cr = credsOf<EmailCreds>(conn);
      const s = conn.settings as { fromEmail: string; fromName: string; inboundAddress: string };
      const subject = c.subject ? (/^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`) : `Re: your message`;
      const rfc = (lastInbound?.metadata.rfcMessageId as string | undefined) ?? null;
      const refs = [...new Set([...(((lastInbound?.metadata.references as string[] | undefined) ?? [])), ...(rfc ? [rfc] : [])])].slice(-10);
      return sendPostmark(cr.serverToken, { from: `${s.fromName.replace(/[<>"]/g, "")} <${s.fromEmail}>`, to: c.contactEmail ?? c.contactHandle, subject, text: body, replyTo: replyAddress(s.inboundAddress, c.id), inReplyTo: rfc, references: refs });
    }
    case "whatsapp": {
      const cr = credsOf<MetaCreds>(conn);
      return sendWhatsApp(cr.accessToken, conn.externalAccountId!, c.contactHandle, body);
    }
    case "messenger":
      return sendMessenger(credsOf<MetaCreds>(conn).accessToken, c.contactHandle, body);
    case "instagram":
      return sendInstagram(credsOf<MetaCreds>(conn).accessToken, c.contactHandle, body);
  }
}

const AUTH_CODES = new Set(["190", "10", "401", "403"]);

async function attempt(ctx: OrgContext, messageId: string) {
  const prep = await withTenant(ctx, async (tx) => {
    const [m] = await tx.select().from(conversationMessages).where(and(eq(conversationMessages.organizationId, ctx.orgId), eq(conversationMessages.id, messageId)));
    const c = await load(tx, ctx, m.conversationId);
    const [conn] = await tx.select().from(channelConnections).where(eq(channelConnections.id, c.connectionId));
    const [last] = await tx.select({ metadata: conversationMessages.metadata }).from(conversationMessages).where(and(eq(conversationMessages.conversationId, c.id), eq(conversationMessages.direction, "inbound"))).orderBy(desc(conversationMessages.createdAt)).limit(1);
    return { m, c, conn, last: last ?? null };
  });
  let providerId: string | null = null;
  let error: string | null = null;
  let authFailed = false;
  try {
    providerId = await deliver(prep.conn, prep.c, prep.m.body, prep.last);
  } catch (e) {
    error = e instanceof ChannelError || e instanceof ConflictError ? e.message : "Sending failed. Try again.";
    authFailed = e instanceof ChannelError && AUTH_CODES.has(e.code ?? "");
  }
  await withTenant(ctx, async (tx) => {
    await tx.update(conversationMessages).set(error ? { deliveryStatus: "failed", error: error.slice(0, 500) } : { deliveryStatus: "sent", providerMessageId: providerId, sentAt: new Date(), error: null }).where(eq(conversationMessages.id, messageId));
    if (authFailed) await markChannelError(tx, prep.conn.id, `The provider rejected SalesGel's credentials: ${error}`);
    else if (!error && prep.conn.status === "error") await markChannelError(tx, prep.conn.id, null);
  });
  return { id: messageId, status: error ? ("failed" as const) : ("sent" as const), error };
}

export async function sendReply(ctx: OrgContext, id: string, input: unknown) {
  need(ctx, "conversations.reply");
  const { body } = parseInput(bodySchema, input);
  const mid = await withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id, true);
    const [conn] = await tx.select().from(channelConnections).where(eq(channelConnections.id, c.connectionId));
    const state = replyState(c, conn);
    if (!state.canReply) throw new ConflictError(state.reason!);
    const mid = newId();
    const now = new Date();
    await tx.insert(conversationMessages).values({ id: mid, organizationId: ctx.orgId, conversationId: c.id, connectionId: c.connectionId, direction: "outbound", body, authorUserId: ctx.userId, deliveryStatus: "queued" });
    await tx.update(conversations).set({
      lastMessageAt: now, lastOutboundAt: now, lastPreview: body.replace(/\s+/g, " ").slice(0, 140), updatedAt: now,
      ...(c.assigneeMembershipId ? {} : { assigneeMembershipId: ctx.membershipId }), // replying claims an unassigned conversation
    }).where(eq(conversations.id, c.id));
    await audit(tx, ctx, { action: "conversation.replied", entityType: "conversation", entityId: c.id, metadata: { messageId: mid, channel: c.channel } });
    if (c.customerId) await audit(tx, ctx, { action: "customer.message_sent", entityType: "customer", entityId: c.customerId, metadata: { conversationId: c.id, preview: `${CHANNEL_LABELS[c.channel]} · ${body.slice(0, 80)}` } });
    await emit(tx, ctx.orgId, "conversation.replied", { conversationId: c.id, messageId: mid });
    return mid;
  });
  return attempt(ctx, mid);
}

export async function retryMessage(ctx: OrgContext, messageId: string) {
  need(ctx, "conversations.reply");
  await withTenant(ctx, async (tx) => {
    const [m] = await tx.select().from(conversationMessages).where(and(eq(conversationMessages.organizationId, ctx.orgId), eq(conversationMessages.id, messageId)));
    if (!m || m.direction !== "outbound") throw new NotFoundError("Message not found.");
    if (m.deliveryStatus !== "failed") throw new ConflictError("Only failed messages can be retried.");
    const c = await load(tx, ctx, m.conversationId);
    const [conn] = await tx.select().from(channelConnections).where(eq(channelConnections.id, c.connectionId));
    const state = replyState(c, conn);
    if (!state.canReply) throw new ConflictError(state.reason!);
    await tx.update(conversationMessages).set({ deliveryStatus: "queued", error: null }).where(eq(conversationMessages.id, messageId));
  });
  return attempt(ctx, messageId);
}

export async function addNote(ctx: OrgContext, id: string, input: unknown) {
  need(ctx, "conversations.reply");
  const { body } = parseInput(bodySchema, input);
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id);
    const mid = newId();
    await tx.insert(conversationMessages).values({ id: mid, organizationId: ctx.orgId, conversationId: c.id, connectionId: c.connectionId, direction: "note", body, authorUserId: ctx.userId, deliveryStatus: "received" });
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, c.id));
    await audit(tx, ctx, { action: "conversation.note_added", entityType: "conversation", entityId: c.id, metadata: { messageId: mid } });
    return { id: mid };
  });
}

/* ───────── triage ───────── */

export async function assignConversation(ctx: OrgContext, id: string, membershipId: string | null) {
  need(ctx, "conversations.assign");
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id, true);
    if (c.assigneeMembershipId === membershipId) return;
    if (membershipId) {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, membershipId), eq(memberships.status, "active")));
      if (!m) throw new ValidationError("Choose an active team member.", { membershipId: ["Unknown member"] });
      if (membershipId !== ctx.membershipId) await notify(tx, { orgId: ctx.orgId, recipientUserId: m.userId, type: "conversation.assigned", title: `${displayName(c)} was assigned to you`, body: c.lastPreview ?? undefined, link: `/o/${ctx.orgSlug}/inbox?c=${c.id}`, entityType: "conversation", entityId: c.id });
    }
    await tx.update(conversations).set({ assigneeMembershipId: membershipId, updatedAt: new Date() }).where(eq(conversations.id, id));
    await audit(tx, ctx, { action: "conversation.assigned", entityType: "conversation", entityId: id, changes: { assigneeMembershipId: { from: c.assigneeMembershipId, to: membershipId } } });
    await emit(tx, ctx.orgId, "conversation.assigned", { conversationId: id, membershipId });
  });
}

export async function setConversationStatus(ctx: OrgContext, id: string, status: "open" | "pending" | "closed") {
  need(ctx, "conversations.reply");
  if (!["open", "pending", "closed"].includes(status)) throw new ValidationError("Choose a status.");
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id, true);
    if (c.status === status) return;
    await tx.update(conversations).set({ status, updatedAt: new Date() }).where(eq(conversations.id, id));
    await audit(tx, ctx, { action: status === "closed" ? "conversation.closed" : status === "open" ? "conversation.reopened" : "conversation.pending", entityType: "conversation", entityId: id, metadata: { from: c.status, to: status } });
  });
}

/* ───────── customers & tickets ───────── */

export async function linkConversationCustomer(ctx: OrgContext, id: string, customerId: string | null) {
  need(ctx, "conversations.reply");
  if (!ctx.permissions.has("customers.read") && !ctx.permissions.has("customers.read_assigned")) throw new ForbiddenError("You can't link customers.");
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id, true);
    if (customerId) {
      const [cu] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, customerId), ne(customers.status, "merged")));
      if (!cu) throw new ValidationError("Choose a customer.", { customerId: ["Unknown customer"] });
      await rememberIdentity(tx, ctx.orgId, customerId, c);
    }
    await tx.update(conversations).set({ customerId, updatedAt: new Date() }).where(eq(conversations.id, id));
    await audit(tx, ctx, { action: "conversation.customer_linked", entityType: "conversation", entityId: id, changes: { customerId: { from: c.customerId, to: customerId } } });
  });
}

/** Saves the channel identity on the customer so future messages match automatically. */
async function rememberIdentity(tx: Tx, orgId: string, customerId: string, c: Conv) {
  if (c.channel === "email" || (c.channel === "webchat" && c.contactEmail)) {
    const email = c.contactEmail ?? c.contactHandle;
    const norm = normalizeEmail(email);
    const [has] = await tx.select({ id: customerEmails.id }).from(customerEmails).where(and(eq(customerEmails.customerId, customerId), eq(customerEmails.normalizedEmail, norm)));
    if (!has) {
      const [any] = await tx.select({ id: customerEmails.id }).from(customerEmails).where(eq(customerEmails.customerId, customerId)).limit(1);
      await tx.insert(customerEmails).values({ organizationId: orgId, customerId, email, normalizedEmail: norm, isPrimary: !any }).onConflictDoNothing();
    }
  }
  if (c.channel === "whatsapp") {
    const e164 = normalizePhone(`+${c.contactHandle}`);
    if (e164) {
      const [has] = await tx.select({ id: customerPhones.id }).from(customerPhones).where(and(eq(customerPhones.customerId, customerId), eq(customerPhones.e164, e164)));
      if (!has) {
        const [any] = await tx.select({ id: customerPhones.id }).from(customerPhones).where(eq(customerPhones.customerId, customerId)).limit(1);
        await tx.insert(customerPhones).values({ organizationId: orgId, customerId, phone: e164, e164, isPrimary: !any }).onConflictDoNothing();
      }
    }
  }
  const provider = c.channel === "whatsapp" ? "whatsapp" : c.channel === "messenger" ? "facebook" : c.channel === "instagram" ? "instagram" : null;
  if (provider) {
    await tx.insert(customerIdentities).values({ organizationId: orgId, customerId, provider, externalId: c.contactHandle, handle: c.contactName, providerAccountId: c.connectionId }).onConflictDoNothing();
  }
}

export async function createCustomerFromConversation(ctx: OrgContext, id: string) {
  need(ctx, "conversations.reply");
  if (!ctx.permissions.has("customers.write")) throw new ForbiddenError("You can't create customers.");
  return withTenant(ctx, async (tx) => {
    const c = await load(tx, ctx, id, true);
    if (c.customerId) throw new ConflictError("This conversation already has a customer.");
    const [first, ...rest] = (c.contactName ?? "").trim().split(/\s+/).filter(Boolean);
    const cid = newId();
    const number = await nextNumber(tx, ctx.orgId, "customer");
    const source = c.channel === "webchat" ? "website" : c.channel === "messenger" ? "facebook" : c.channel === "email" ? "other" : c.channel;
    await tx.insert(customers).values({
      id: cid, organizationId: ctx.orgId, number, type: "person", status: "active", source, firstName: first ?? null, lastName: rest.join(" ") || null,
      displayName: deriveDisplayName({ firstName: first ?? null, lastName: rest.join(" ") || null, email: c.contactEmail ?? (c.channel === "email" ? c.contactHandle : null), phone: c.channel === "whatsapp" ? `+${c.contactHandle}` : null }) || displayName(c),
      ownerMembershipId: ctx.membershipId,
    } as typeof customers.$inferInsert);
    await rememberIdentity(tx, ctx.orgId, cid, c);
    await tx.update(conversations).set({ customerId: cid, updatedAt: new Date() }).where(eq(conversations.id, id));
    await audit(tx, ctx, { action: "customer.created", entityType: "customer", entityId: cid, metadata: { source: `inbox:${c.channel}` } });
    return { id: cid };
  });
}

const TICKET_CHANNEL: Record<Conv["channel"], string> = { webchat: "web_form", email: "email", whatsapp: "whatsapp", messenger: "facebook", instagram: "instagram" };

/** Opens a support ticket from a conversation, carrying the customer's messages as its description. */
export async function convertToTicket(ctx: OrgContext, id: string, input: { subject?: string } = {}) {
  needRead(ctx);
  const detail = await getConversation(ctx, id);
  if (detail.ticketId) throw new ConflictError(`Already linked to TCK-${detail.ticket?.number ?? ""}.`);
  const transcript = detail.messages.filter((m) => m.direction !== "note").slice(-30)
    .map((m) => `${m.direction === "inbound" ? detail.title : (m.authorName ?? "Team")} (${m.createdAt.toISOString().slice(0, 16).replace("T", " ")}):\n${m.body}`).join("\n\n");
  const subject = (input.subject?.trim() || detail.subject || detail.messages.find((m) => m.direction === "inbound")?.body.split("\n")[0] || `${CHANNEL_LABELS[detail.channel]} conversation`).slice(0, 200);
  const t = await createTicket(ctx, {
    subject, description: transcript.slice(0, 10_000) || undefined, customerId: detail.customerId ?? undefined, channel: TICKET_CHANNEL[detail.channel] as never,
    contactEmail: detail.contactEmail ?? (detail.channel === "email" ? detail.contactHandle : undefined), priority: "normal", tags: [],
  } as never);
  await withTenant(ctx, async (tx) => {
    await tx.update(conversations).set({ ticketId: t.id, updatedAt: new Date() }).where(and(eq(conversations.organizationId, ctx.orgId), eq(conversations.id, id)));
    await audit(tx, ctx, { action: "conversation.ticket_created", entityType: "conversation", entityId: id, metadata: { ticketId: t.id, number: t.number } });
  });
  return t;
}

/* ───────── saved replies ───────── */

const replySchema = z.object({ title: z.string().trim().min(1, "Give it a short name").max(60), body: z.string().trim().min(1, "Write the reply").max(5000) });

export async function listSavedReplies(ctx: OrgContext) {
  needRead(ctx);
  return withTenant(ctx, (tx) => tx.select({ id: savedReplies.id, title: savedReplies.title, body: savedReplies.body }).from(savedReplies).where(and(eq(savedReplies.organizationId, ctx.orgId), isNull(savedReplies.archivedAt))).orderBy(asc(savedReplies.title)));
}
export async function createSavedReply(ctx: OrgContext, input: unknown) {
  need(ctx, "conversations.reply");
  const d = parseInput(replySchema, input);
  return withTenant(ctx, async (tx) => {
    const id = newId();
    try {
      await tx.insert(savedReplies).values({ id, organizationId: ctx.orgId, title: d.title, body: d.body, createdByUserId: ctx.userId });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A saved reply with that name exists.", { title: ["Already exists"] });
      throw e;
    }
    await audit(tx, ctx, { action: "inbox.saved_reply_created", entityType: "saved_reply", entityId: id, metadata: { title: d.title } });
    return { id };
  });
}
export async function archiveSavedReply(ctx: OrgContext, id: string) {
  need(ctx, "conversations.reply");
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.update(savedReplies).set({ archivedAt: new Date() }).where(and(eq(savedReplies.organizationId, ctx.orgId), eq(savedReplies.id, id), isNull(savedReplies.archivedAt))).returning({ title: savedReplies.title });
    if (!r) throw new NotFoundError("Saved reply not found.");
    await audit(tx, ctx, { action: "inbox.saved_reply_archived", entityType: "saved_reply", entityId: id, metadata: r });
  });
}

export { conversationIdFromToken };
