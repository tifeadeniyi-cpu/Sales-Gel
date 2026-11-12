import "server-only";
import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { customerEmails, customerPhones, customers } from "@/domains/customers/schema";
import { memberships, teams } from "@/domains/identity/schema";
import { auditLogs } from "@/domains/platform/schema";
import { notify } from "@/domains/platform/notifications";
import { orders } from "@/domains/commerce/schema";
import { leads } from "@/domains/sales/schema";
import { user } from "@/server/auth/schema";
import { audit, diff, emit } from "@/server/audit/audit";
import type { OrgContext } from "@/server/authz/context";
import type { Tx } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import { nextNumber } from "@/server/db/sequences";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { files, supportTickets, ticketAttachments, ticketMessages, ticketRecordLinks, ticketStatuses, ticketTypes, type StatusCategory } from "./schema";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MIME,
  messageInputSchema,
  statusChangeSchema,
  statusInputSchema,
  ticketFiltersSchema,
  ticketInputSchema,
  ticketUpdateSchema,
  typeInputSchema,
  type TicketFilters,
  type TicketInput,
} from "./validation";

const ACTIVE: StatusCategory[] = ["new", "open", "pending_customer", "pending_internal", "escalated"];
const DONE: StatusCategory[] = ["resolved", "closed"];
export const isDone = (c: StatusCategory) => DONE.includes(c);

const DEFAULT_STATUSES: { name: string; category: StatusCategory; color: string }[] = [
  { name: "New", category: "new", color: "#2563eb" },
  { name: "Open", category: "open", color: "#0ea5a4" },
  { name: "Waiting on customer", category: "pending_customer", color: "#d97706" },
  { name: "Waiting on team", category: "pending_internal", color: "#7c3aed" },
  { name: "Escalated", category: "escalated", color: "#dc2626" },
  { name: "Resolved", category: "resolved", color: "#16a34a" },
  { name: "Closed", category: "closed", color: "#64748b" },
];
const DEFAULT_TYPES = ["Question", "Order issue", "Delivery problem", "Return or refund", "Product issue", "Complaint", "Other"];

/** Seeds default statuses and ticket types once per org (concurrency-safe). */
export async function ensureSupportDefaults(tx: Tx, orgId: string) {
  const [quick] = await tx.select({ id: ticketStatuses.id }).from(ticketStatuses).where(eq(ticketStatuses.organizationId, orgId)).limit(1);
  if (quick) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`support:${orgId}`}))`);
  const [again] = await tx.select({ id: ticketStatuses.id }).from(ticketStatuses).where(eq(ticketStatuses.organizationId, orgId)).limit(1);
  if (again) return;
  await tx.insert(ticketStatuses).values(DEFAULT_STATUSES.map((s, i) => ({ organizationId: orgId, position: i, isDefault: i === 0 ? 1 : 0, ...s })));
  await tx.insert(ticketTypes).values(DEFAULT_TYPES.map((name, i) => ({ organizationId: orgId, name, position: i })));
}

/* ───────── permissions & visibility ───────── */

const canReadAll = (ctx: OrgContext) => ctx.permissions.has("tickets.read");
function needRead(ctx: OrgContext) {
  if (!canReadAll(ctx) && !ctx.permissions.has("tickets.read_assigned")) throw new ForbiddenError(undefined, "tickets.read");
}
function need(ctx: OrgContext, p: "tickets.write" | "tickets.assign" | "support.configure") {
  if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
}
/** SQL predicate limiting tickets to what this user may see. */
export function ticketScope(ctx: OrgContext): SQL | undefined {
  return canReadAll(ctx) ? undefined : eq(supportTickets.assigneeMembershipId, ctx.membershipId);
}
const visible = (ctx: OrgContext, t: { assigneeMembershipId: string | null }) => canReadAll(ctx) || t.assigneeMembershipId === ctx.membershipId;

async function loadTicket(tx: Tx, ctx: OrgContext, id: string, lock = false) {
  const q = tx.select().from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.id, id)));
  const [t] = lock ? await q.for("update") : await q;
  if (!t || !visible(ctx, t)) throw new NotFoundError("Ticket not found.");
  return t;
}

async function customerVisibleSet(tx: Tx, ctx: OrgContext, ids: string[]): Promise<Set<string> | null> {
  if (ctx.permissions.has("customers.read")) return null;
  const set = new Set<string>();
  if (ids.length && ctx.permissions.has("customers.read_assigned")) {
    for (const r of await tx.select({ id: customers.id }).from(customers).where(and(inArray(customers.id, ids), eq(customers.ownerMembershipId, ctx.membershipId)))) set.add(r.id);
  }
  return set;
}

async function assertCustomer(tx: Tx, ctx: OrgContext, id: string | null | undefined) {
  if (!id) return null;
  const [c] = await tx.select().from(customers).where(and(eq(customers.organizationId, ctx.orgId), eq(customers.id, id)));
  const vis = await customerVisibleSet(tx, ctx, c ? [c.id] : []);
  if (!c || (vis && !vis.has(c.id))) throw new ValidationError("Choose a customer you have access to.", { customerId: ["Choose a customer you have access to."] });
  if (c.status === "merged") throw new ValidationError("That customer was merged into another record.", { customerId: ["Choose the surviving customer."] });
  return c;
}

async function assertMember(tx: Tx, ctx: OrgContext, id: string | null | undefined) {
  if (!id) return null;
  const [m] = await tx.select({ id: memberships.id, userId: memberships.userId, status: memberships.status }).from(memberships).where(and(eq(memberships.organizationId, ctx.orgId), eq(memberships.id, id)));
  if (!m || m.status !== "active") throw new ValidationError("Choose an active team member.", { assigneeMembershipId: ["Choose an active team member."] });
  return m;
}

async function assertTeam(tx: Tx, ctx: OrgContext, id: string | null | undefined) {
  if (!id) return;
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.organizationId, ctx.orgId), eq(teams.id, id)));
  if (!t) throw new ValidationError("Choose a team.", { teamId: ["Choose a team."] });
}

async function assertType(tx: Tx, ctx: OrgContext, id: string | null | undefined) {
  if (!id) return;
  const [t] = await tx.select({ archivedAt: ticketTypes.archivedAt }).from(ticketTypes).where(and(eq(ticketTypes.organizationId, ctx.orgId), eq(ticketTypes.id, id)));
  if (!t || t.archivedAt) throw new ValidationError("Choose a ticket type.", { ticketTypeId: ["Choose a ticket type."] });
}

async function statusOf(tx: Tx, orgId: string, category: StatusCategory) {
  const rows = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, orgId), eq(ticketStatuses.category, category), isNull(ticketStatuses.archivedAt))).orderBy(asc(ticketStatuses.position)).limit(1);
  return rows[0] ?? null;
}

async function notifyAssignee(tx: Tx, ctx: OrgContext, t: { id: string; number: number; subject: string }, membershipId: string | null, title: string) {
  if (!membershipId || membershipId === ctx.membershipId) return;
  const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, membershipId));
  if (m) await notify(tx, { orgId: ctx.orgId, recipientUserId: m.userId, type: "ticket.assigned", title, body: t.subject, link: `/o/${ctx.orgSlug}/support/tickets/${t.id}`, entityType: "ticket", entityId: t.id });
}

/* ───────── files ───────── */

export interface UploadFile { filename: string; mimeType: string; data: Buffer }

function sniffOk(mime: string, b: Buffer) {
  const hex = b.subarray(0, 12).toString("hex");
  if (mime === "image/png") return hex.startsWith("89504e47");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/gif") return hex.startsWith("47494638");
  if (mime === "image/webp") return hex.startsWith("52494646") && b.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/pdf") return b.subarray(0, 5).toString() === "%PDF-";
  return true;
}

async function storeFiles(tx: Tx, ctx: OrgContext, ticketId: string, messageId: string | null, list: UploadFile[]) {
  if (!list.length) return [];
  if (list.length > ATTACHMENT_MAX_FILES) throw new ValidationError(`Attach up to ${ATTACHMENT_MAX_FILES} files at a time.`, { files: [`Up to ${ATTACHMENT_MAX_FILES} files`] });
  const total = list.reduce((n, f) => n + f.data.length, 0);
  if (total > ATTACHMENT_MAX_BYTES) throw new ValidationError("Attachments are larger than 4 MB in total.", { files: ["Max 4 MB per message"] });
  const out: string[] = [];
  for (const f of list) {
    const name = f.filename.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) || "file";
    if (f.data.length === 0) throw new ValidationError(`“${name}” is empty.`, { files: ["Empty file"] });
        if (!(ATTACHMENT_MIME as readonly string[]).includes(f.mimeType)) throw new ValidationError(`“${name}” isn't a supported file type.`, { files: ["Images, PDF, Office documents, text, audio and video"] });
    if (!sniffOk(f.mimeType, f.data)) throw new ValidationError(`“${name}” doesn't match its file type.`, { files: ["File content doesn't match its type"] });
    const fileId = newId();
    await tx.insert(files).values({ id: fileId, organizationId: ctx.orgId, filename: name, mimeType: f.mimeType, sizeBytes: f.data.length, sha256: createHash("sha256").update(f.data).digest("hex"), storage: "db", content: f.data, uploadedByUserId: ctx.userId });
    await tx.insert(ticketAttachments).values({ organizationId: ctx.orgId, ticketId, messageId, fileId });
    out.push(fileId);
  }
  return out;
}

/** Returns the file only if the user can see the ticket it's attached to. */
export async function getTicketAttachment(ctx: OrgContext, attachmentId: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    const [a] = await tx
      .select({ ticketId: ticketAttachments.ticketId, filename: files.filename, mimeType: files.mimeType, content: files.content, size: files.sizeBytes })
      .from(ticketAttachments)
      .innerJoin(files, and(eq(files.organizationId, ticketAttachments.organizationId), eq(files.id, ticketAttachments.fileId)))
      .where(and(eq(ticketAttachments.organizationId, ctx.orgId), eq(ticketAttachments.id, attachmentId)));
    if (!a) return null;
    const [t] = await tx.select({ assigneeMembershipId: supportTickets.assigneeMembershipId }).from(supportTickets).where(eq(supportTickets.id, a.ticketId));
    if (!t || !visible(ctx, t) || !a.content) return null;
    return a;
  });
}

/* ───────── mutations ───────── */

export async function createTicket(ctx: OrgContext, input: TicketInput, attachments: UploadFile[] = []) {
  need(ctx, "tickets.write");
  const data = parseInput(ticketInputSchema, input);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    let order = null;
    if (data.orderId) {
      if (!ctx.permissions.has("orders.read")) throw new ValidationError("You can't link orders.", { orderId: ["No access to orders"] });
      [order] = await tx.select({ id: orders.id, number: orders.number, customerId: orders.customerId }).from(orders).where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, data.orderId)));
      if (!order) throw new ValidationError("Choose a valid order.", { orderId: ["Choose a valid order"] });
    }
    let lead = null;
    if (data.leadId) {
      [lead] = await tx.select({ id: leads.id, customerId: leads.customerId, owner: leads.ownerMembershipId }).from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, data.leadId)));
      const ok = lead && (ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && lead.owner === ctx.membershipId));
      if (!ok) throw new ValidationError("Choose a lead you have access to.", { leadId: ["Choose a lead you have access to"] });
    }
    const customer = await assertCustomer(tx, ctx, data.customerId ?? order?.customerId ?? lead?.customerId ?? null);
    // Agents who can't assign get the ticket themselves, so they keep access to what they create.
    let assignee = data.assigneeMembershipId;
    if (!ctx.permissions.has("tickets.assign")) assignee = canReadAll(ctx) ? null : ctx.membershipId;
    await assertMember(tx, ctx, assignee);
    await assertTeam(tx, ctx, data.teamId);
    await assertType(tx, ctx, data.ticketTypeId);
    let defaultEmail: string | null = null;
    let defaultPhone: string | null = null;
    if (customer) {
      const [e] = await tx.select({ v: customerEmails.email }).from(customerEmails).where(eq(customerEmails.customerId, customer.id)).orderBy(desc(customerEmails.isPrimary)).limit(1);
      const [p] = await tx.select({ v: customerPhones.e164 }).from(customerPhones).where(eq(customerPhones.customerId, customer.id)).orderBy(desc(customerPhones.isPrimary)).limit(1);
      defaultEmail = e?.v ?? null;
      defaultPhone = p?.v ?? null;
    }
    const [status] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, ctx.orgId), eq(ticketStatuses.isDefault, 1)));
    const st = status ?? (await statusOf(tx, ctx.orgId, "new"))!;
    const id = newId();
    const number = await nextNumber(tx, ctx.orgId, "ticket");
    const now = new Date();
    await tx.insert(supportTickets).values({
      id, organizationId: ctx.orgId, number, subject: data.subject, description: data.description, customerId: customer?.id ?? null,
      channel: data.channel, ticketTypeId: data.ticketTypeId, statusId: st.id, statusCategory: st.category, priority: data.priority,
      assigneeMembershipId: assignee, teamId: data.teamId, tags: data.tags, contactEmail: data.contactEmail ?? defaultEmail,
      contactPhone: data.contactPhone ?? defaultPhone, lastActivityAt: now, lastCustomerMessageAt: data.description ? now : null, createdByUserId: ctx.userId,
    });
    if (data.description) {
      // The opening description is the customer's request; keep it in the conversation too.
      const mid = newId();
      await tx.insert(ticketMessages).values({ id: mid, organizationId: ctx.orgId, ticketId: id, kind: "customer", body: data.description, authorUserId: ctx.userId, channel: data.channel, deliveryStatus: "received" });
      await storeFiles(tx, ctx, id, mid, attachments);
    } else await storeFiles(tx, ctx, id, null, attachments);
    if (order) await tx.insert(ticketRecordLinks).values({ organizationId: ctx.orgId, ticketId: id, orderId: order.id, createdByUserId: ctx.userId });
    if (lead) await tx.insert(ticketRecordLinks).values({ organizationId: ctx.orgId, ticketId: id, leadId: lead.id, createdByUserId: ctx.userId });
    await audit(tx, ctx, { action: "ticket.created", entityType: "ticket", entityId: id, metadata: { number, subject: data.subject, priority: data.priority, channel: data.channel } });
    if (customer) {
      await audit(tx, ctx, { action: "customer.ticket_created", entityType: "customer", entityId: customer.id, metadata: { ticketId: id, preview: `TCK-${number} · ${data.subject}` } });
      await tx.update(customers).set({ lastActivityAt: now }).where(eq(customers.id, customer.id));
    }
    if (order) await audit(tx, ctx, { action: "order.ticket_linked", entityType: "order", entityId: order.id, metadata: { ticketId: id, number } });
    await notifyAssignee(tx, ctx, { id, number, subject: data.subject }, assignee, `TCK-${number} was assigned to you`);
    await emit(tx, ctx.orgId, "ticket.created", { ticketId: id });
    return { id, number };
  });
}

export async function updateTicket(ctx: OrgContext, id: string, input: Record<string, unknown>) {
  need(ctx, "tickets.write");
  const parsed = parseInput(ticketUpdateSchema, input);
  const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in input)) as Partial<typeof supportTickets.$inferInsert>;
  if (!Object.keys(patch).length) return;
  return withTenant(ctx, async (tx) => {
    const t = await loadTicket(tx, ctx, id, true);
    if ("customerId" in patch) await assertCustomer(tx, ctx, patch.customerId);
    if ("teamId" in patch) await assertTeam(tx, ctx, patch.teamId);
    if ("ticketTypeId" in patch) await assertType(tx, ctx, patch.ticketTypeId);
    await tx.update(supportTickets).set({ ...patch, updatedAt: new Date() }).where(eq(supportTickets.id, id));
    await audit(tx, ctx, { action: "ticket.updated", entityType: "ticket", entityId: id, changes: diff(t, patch) });
  });
}

export async function assignTicket(ctx: OrgContext, id: string, membershipId: string | null) {
  need(ctx, "tickets.assign");
  return withTenant(ctx, async (tx) => {
    const t = await loadTicket(tx, ctx, id, true);
    if (t.assigneeMembershipId === membershipId) return;
    await assertMember(tx, ctx, membershipId);
    await tx.update(supportTickets).set({ assigneeMembershipId: membershipId, updatedAt: new Date() }).where(eq(supportTickets.id, id));
    await audit(tx, ctx, { action: "ticket.assigned", entityType: "ticket", entityId: id, changes: { assigneeMembershipId: { from: t.assigneeMembershipId, to: membershipId } } });
    await notifyAssignee(tx, ctx, t, membershipId, `TCK-${t.number} was assigned to you`);
    await emit(tx, ctx.orgId, "ticket.assigned", { ticketId: id, membershipId });
  });
}

async function applyStatus(tx: Tx, ctx: OrgContext, t: typeof supportTickets.$inferSelect, to: typeof ticketStatuses.$inferSelect, extra: { resolutionCategory?: string | null; resolutionNote?: string | null } = {}) {
  const now = new Date();
  const wasDone = isDone(t.statusCategory);
  const nowDone = isDone(to.category);
  const patch: Partial<typeof supportTickets.$inferInsert> = { statusId: to.id, statusCategory: to.category, updatedAt: now, lastActivityAt: now };
  if (to.category === "resolved") {
    patch.resolvedAt = t.resolvedAt ?? now;
    patch.closedAt = null;
    if (extra.resolutionCategory) patch.resolutionCategory = extra.resolutionCategory;
    if (extra.resolutionNote !== undefined) patch.resolutionNote = extra.resolutionNote;
  }
  if (to.category === "closed") {
    patch.closedAt = now;
    patch.resolvedAt = t.resolvedAt ?? now;
  }
  if (wasDone && !nowDone) {
    patch.reopenedCount = t.reopenedCount + 1;
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.resolutionCategory = null;
    patch.resolutionNote = null;
  }
  await tx.update(supportTickets).set(patch).where(eq(supportTickets.id, t.id));
  const action = wasDone && !nowDone ? "ticket.reopened" : to.category === "resolved" ? "ticket.resolved" : to.category === "closed" ? "ticket.closed" : "ticket.status_changed";
  await audit(tx, ctx, { action, entityType: "ticket", entityId: t.id, metadata: { from: t.statusCategory, to: to.category, status: to.name, resolutionCategory: extra.resolutionCategory ?? undefined } });
  if (action === "ticket.resolved" && t.customerId) await audit(tx, ctx, { action: "customer.ticket_resolved", entityType: "customer", entityId: t.customerId, metadata: { ticketId: t.id, preview: `TCK-${t.number} · ${t.subject}` } });
  await emit(tx, ctx.orgId, action, { ticketId: t.id });
}

export async function changeTicketStatus(ctx: OrgContext, id: string, input: unknown) {
  need(ctx, "tickets.write");
  const data = parseInput(statusChangeSchema, input);
  return withTenant(ctx, async (tx) => {
    const t = await loadTicket(tx, ctx, id, true);
    const [to] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, ctx.orgId), eq(ticketStatuses.id, data.statusId)));
    if (!to || to.archivedAt) throw new ValidationError("Choose a status.", { statusId: ["Choose a status"] });
    if (to.id === t.statusId) return;
    if (to.category === "resolved" && !data.resolutionCategory) throw new ValidationError("Choose how this was resolved.", { resolutionCategory: ["Choose how this was resolved"] });
    await applyStatus(tx, ctx, t, to, data);
  });
}

/**
 * Adds to the conversation. Replies are recorded on the ticket; delivering them to the customer's
 * email/WhatsApp needs a connected channel (Phase 8), so they're stored as `not_sent` until then.
 */
export async function addTicketMessage(ctx: OrgContext, id: string, input: unknown, attachments: UploadFile[] = []) {
  need(ctx, "tickets.write");
  const data = parseInput(messageInputSchema, input);
  return withTenant(ctx, async (tx) => {
    const t = await loadTicket(tx, ctx, id, true);
    if (t.statusCategory === "closed" && data.kind !== "note") throw new ConflictError("This ticket is closed. Reopen it to continue the conversation.");
    const mid = newId();
    const now = new Date();
    await tx.insert(ticketMessages).values({ id: mid, organizationId: ctx.orgId, ticketId: id, kind: data.kind, body: data.body, authorUserId: ctx.userId, channel: data.channel ?? null, deliveryStatus: data.kind === "customer" ? "received" : "not_sent" });
    await storeFiles(tx, ctx, id, mid, attachments);
    const patch: Partial<typeof supportTickets.$inferInsert> = { lastActivityAt: now, updatedAt: now };
    if (data.kind === "reply" && !t.firstRespondedAt) patch.firstRespondedAt = now;
    if (data.kind === "customer") patch.lastCustomerMessageAt = now;
    await tx.update(supportTickets).set(patch).where(eq(supportTickets.id, id));
    await audit(tx, ctx, { action: data.kind === "reply" ? "ticket.replied" : data.kind === "note" ? "ticket.note_added" : "ticket.customer_message", entityType: "ticket", entityId: id, metadata: { messageId: mid, attachments: attachments.length } });
    // Status follows the conversation: replying to a new ticket opens it; a customer message re-opens it.
    const fresh = { ...t, ...patch } as typeof t;
    if (data.kind === "reply" && t.statusCategory === "new") {
      const to = await statusOf(tx, ctx.orgId, "pending_customer") ?? await statusOf(tx, ctx.orgId, "open");
      if (to) await applyStatus(tx, ctx, fresh, to);
    } else if (data.kind === "customer" && (t.statusCategory === "pending_customer" || t.statusCategory === "resolved")) {
      const to = await statusOf(tx, ctx.orgId, "open");
      if (to) await applyStatus(tx, ctx, fresh, to);
    }
    if (data.kind === "customer") {
      if (t.customerId) await audit(tx, ctx, { action: "customer.replied", entityType: "customer", entityId: t.customerId, metadata: { ticketId: id, preview: `TCK-${t.number}` } });
      await notifyAssignee(tx, ctx, t, t.assigneeMembershipId, `Customer replied on TCK-${t.number}`);
    }
    await emit(tx, ctx.orgId, "ticket.message_added", { ticketId: id, messageId: mid, kind: data.kind });
    return { id: mid };
  });
}

export async function linkTicketRecord(ctx: OrgContext, id: string, target: { orderId?: string; leadId?: string }) {
  need(ctx, "tickets.write");
  return withTenant(ctx, async (tx) => {
    const t = await loadTicket(tx, ctx, id, true);
    if (target.orderId) {
      if (!ctx.permissions.has("orders.read")) throw new ForbiddenError(undefined, "orders.read");
      const [o] = await tx.select({ id: orders.id, number: orders.number }).from(orders).where(and(eq(orders.organizationId, ctx.orgId), eq(orders.id, target.orderId)));
      if (!o) throw new ValidationError("Order not found.", { orderId: ["Order not found"] });
      await tx.insert(ticketRecordLinks).values({ organizationId: ctx.orgId, ticketId: id, orderId: o.id, createdByUserId: ctx.userId }).onConflictDoNothing();
      await audit(tx, ctx, { action: "ticket.record_linked", entityType: "ticket", entityId: id, metadata: { orderId: o.id, label: `ORD-${o.number}` } });
      await audit(tx, ctx, { action: "order.ticket_linked", entityType: "order", entityId: o.id, metadata: { ticketId: id, number: t.number } });
    } else if (target.leadId) {
      const [l] = await tx.select({ id: leads.id, number: leads.number, owner: leads.ownerMembershipId }).from(leads).where(and(eq(leads.organizationId, ctx.orgId), eq(leads.id, target.leadId)));
      if (!l || !(ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && l.owner === ctx.membershipId))) throw new ValidationError("Lead not found.", { leadId: ["Lead not found"] });
      await tx.insert(ticketRecordLinks).values({ organizationId: ctx.orgId, ticketId: id, leadId: l.id, createdByUserId: ctx.userId }).onConflictDoNothing();
      await audit(tx, ctx, { action: "ticket.record_linked", entityType: "ticket", entityId: id, metadata: { leadId: l.id, label: `LEAD-${l.number}` } });
    } else throw new ValidationError("Choose an order or lead.");
  });
}

export async function unlinkTicketRecord(ctx: OrgContext, id: string, linkId: string) {
  need(ctx, "tickets.write");
  return withTenant(ctx, async (tx) => {
    await loadTicket(tx, ctx, id, true);
    const [l] = await tx.delete(ticketRecordLinks).where(and(eq(ticketRecordLinks.organizationId, ctx.orgId), eq(ticketRecordLinks.ticketId, id), eq(ticketRecordLinks.id, linkId))).returning();
    if (!l) throw new NotFoundError("Link not found.");
    await audit(tx, ctx, { action: "ticket.record_unlinked", entityType: "ticket", entityId: id, metadata: { orderId: l.orderId, leadId: l.leadId } });
  });
}

/* ───────── configuration ───────── */

export async function listTicketConfig(ctx: OrgContext) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    const [statuses, types] = await Promise.all([
      tx.select().from(ticketStatuses).where(eq(ticketStatuses.organizationId, ctx.orgId)).orderBy(asc(ticketStatuses.position)),
      tx.select().from(ticketTypes).where(eq(ticketTypes.organizationId, ctx.orgId)).orderBy(asc(ticketTypes.position)),
    ]);
    return { statuses, types };
  });
}

export async function createTicketStatus(ctx: OrgContext, input: unknown) {
  need(ctx, "support.configure");
  const data = parseInput(statusInputSchema, input);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${ticketStatuses.position}),0)::int` }).from(ticketStatuses).where(eq(ticketStatuses.organizationId, ctx.orgId));
    const id = newId();
    try {
      await tx.insert(ticketStatuses).values({ id, organizationId: ctx.orgId, position: max + 1, ...data });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A status with that name already exists.", { name: ["Already exists"] });
      throw e;
    }
    await audit(tx, ctx, { action: "support.status_created", entityType: "ticket_status", entityId: id, metadata: data });
    return { id };
  });
}

export async function updateTicketStatusDef(ctx: OrgContext, id: string, input: { name?: string; color?: string; isDefault?: boolean }) {
  need(ctx, "support.configure");
  return withTenant(ctx, async (tx) => {
    const [s] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, ctx.orgId), eq(ticketStatuses.id, id)));
    if (!s) throw new NotFoundError("Status not found.");
    const patch: Partial<typeof ticketStatuses.$inferInsert> = {};
    if (input.name !== undefined) patch.name = parseInput(statusInputSchema.shape.name, input.name);
    if (input.color !== undefined) patch.color = parseInput(statusInputSchema.shape.color, input.color);
    if (input.isDefault) {
      if (isDone(s.category)) throw new ValidationError("New tickets can't start resolved or closed.");
      await tx.update(ticketStatuses).set({ isDefault: 0 }).where(eq(ticketStatuses.organizationId, ctx.orgId));
      patch.isDefault = 1;
    }
    await tx.update(ticketStatuses).set(patch).where(eq(ticketStatuses.id, id));
    await audit(tx, ctx, { action: "support.status_updated", entityType: "ticket_status", entityId: id, changes: diff(s, patch) });
  });
}

export async function archiveTicketStatus(ctx: OrgContext, id: string) {
  need(ctx, "support.configure");
  return withTenant(ctx, async (tx) => {
    const [s] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, ctx.orgId), eq(ticketStatuses.id, id)));
    if (!s) throw new NotFoundError("Status not found.");
    if (s.isDefault) throw new ConflictError("Choose another default status before archiving this one.");
    const [{ inUse }] = await tx.select({ inUse: count() }).from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.statusId, id)));
    if (inUse > 0) throw new ConflictError(`${inUse} ticket${inUse === 1 ? " uses" : "s use"} this status. Move them first.`);
    const [{ siblings }] = await tx.select({ siblings: count() }).from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, ctx.orgId), eq(ticketStatuses.category, s.category), isNull(ticketStatuses.archivedAt)));
    if (siblings <= 1 && ["new", "open", "resolved", "closed"].includes(s.category)) throw new ConflictError("Keep at least one status in this category.");
    await tx.update(ticketStatuses).set({ archivedAt: new Date() }).where(eq(ticketStatuses.id, id));
    await audit(tx, ctx, { action: "support.status_archived", entityType: "ticket_status", entityId: id });
  });
}

export async function createTicketType(ctx: OrgContext, input: unknown) {
  need(ctx, "support.configure");
  const data = parseInput(typeInputSchema, input);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    const id = newId();
    try {
      await tx.insert(ticketTypes).values({ id, organizationId: ctx.orgId, name: data.name, position: 999 });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ValidationError("A type with that name already exists.", { name: ["Already exists"] });
      throw e;
    }
    await audit(tx, ctx, { action: "support.type_created", entityType: "ticket_type", entityId: id, metadata: data });
    return { id };
  });
}

export async function archiveTicketType(ctx: OrgContext, id: string) {
  need(ctx, "support.configure");
  return withTenant(ctx, async (tx) => {
    const [t] = await tx.update(ticketTypes).set({ archivedAt: new Date() }).where(and(eq(ticketTypes.organizationId, ctx.orgId), eq(ticketTypes.id, id))).returning();
    if (!t) throw new NotFoundError("Type not found.");
    await audit(tx, ctx, { action: "support.type_archived", entityType: "ticket_type", entityId: id });
  });
}

/* ───────── reads ───────── */

function viewWhere(ctx: OrgContext, view: string): SQL | undefined {
  switch (view) {
    case "mine": return and(eq(supportTickets.assigneeMembershipId, ctx.membershipId), inArray(supportTickets.statusCategory, ACTIVE));
    case "unassigned": return and(isNull(supportTickets.assigneeMembershipId), inArray(supportTickets.statusCategory, ACTIVE));
    case "open": return inArray(supportTickets.statusCategory, ACTIVE);
    case "waiting": return inArray(supportTickets.statusCategory, ["pending_customer", "pending_internal"]);
    case "escalated": return eq(supportTickets.statusCategory, "escalated");
    case "resolved": return eq(supportTickets.statusCategory, "resolved");
    case "closed": return eq(supportTickets.statusCategory, "closed");
    default: return undefined;
  }
}

const PRIORITY_ORDER = sql`case ${supportTickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

const listSelect = {
  id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, priority: supportTickets.priority, channel: supportTickets.channel,
  statusCategory: supportTickets.statusCategory, statusName: ticketStatuses.name, statusColor: ticketStatuses.color, customerId: supportTickets.customerId,
  customerName: customers.displayName, assigneeMembershipId: supportTickets.assigneeMembershipId, assigneeName: user.name, typeName: ticketTypes.name,
  lastActivityAt: supportTickets.lastActivityAt, createdAt: supportTickets.createdAt, firstRespondedAt: supportTickets.firstRespondedAt,
  lastCustomerMessageAt: supportTickets.lastCustomerMessageAt,
};

function baseList(tx: Tx) {
  return tx
    .select(listSelect)
    .from(supportTickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, supportTickets.statusId))
    .leftJoin(ticketTypes, eq(ticketTypes.id, supportTickets.ticketTypeId))
    .leftJoin(customers, and(eq(customers.organizationId, supportTickets.organizationId), eq(customers.id, supportTickets.customerId)))
    .leftJoin(memberships, and(eq(memberships.organizationId, supportTickets.organizationId), eq(memberships.id, supportTickets.assigneeMembershipId)))
    .leftJoin(user, eq(user.id, memberships.userId));
}

async function maskRows<T extends { customerId: string | null; customerName: string | null }>(tx: Tx, ctx: OrgContext, rows: T[]) {
  const vis = await customerVisibleSet(tx, ctx, [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))]);
  return rows.map((r) => {
    const ok = !r.customerId || vis === null || vis.has(r.customerId);
    return { ...r, customerVisible: ok, customerName: ok ? r.customerName : "Restricted customer" };
  });
}

export async function listTickets(ctx: OrgContext, filters: TicketFilters = {}) {
  needRead(ctx);
  const f = parseInput(ticketFiltersSchema, filters);
  return withTenant(ctx, async (tx) => {
    await ensureSupportDefaults(tx, ctx.orgId);
    const conds: (SQL | undefined)[] = [eq(supportTickets.organizationId, ctx.orgId), ticketScope(ctx), viewWhere(ctx, f.view)];
    if (f.priority) conds.push(eq(supportTickets.priority, f.priority));
    if (f.assignee === "none") conds.push(isNull(supportTickets.assigneeMembershipId));
    else if (f.assignee) conds.push(eq(supportTickets.assigneeMembershipId, f.assignee));
    if (f.type) conds.push(eq(supportTickets.ticketTypeId, f.type));
    if (f.customer) conds.push(eq(supportTickets.customerId, f.customer));
    if (f.order) conds.push(sql`exists (select 1 from ${ticketRecordLinks} where ${ticketRecordLinks.ticketId} = ${supportTickets.id} and ${ticketRecordLinks.orderId} = ${f.order})`);
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const num = f.q.match(/^(?:tck-)?(\d+)$/i);
      conds.push(or(ilike(supportTickets.subject, like), ilike(customers.displayName, like), num ? eq(supportTickets.number, Number(num[1])) : undefined));
    }
    const where = and(...conds);
    const order =
      f.sort === "newest" ? [desc(supportTickets.createdAt)] :
      f.sort === "oldest" ? [asc(supportTickets.createdAt)] :
      f.sort === "priority" ? [asc(PRIORITY_ORDER), desc(supportTickets.lastActivityAt)] :
      [desc(supportTickets.lastActivityAt)];
    const [{ total }] = await tx.select({ total: count() }).from(supportTickets).leftJoin(customers, eq(customers.id, supportTickets.customerId)).where(where);
    const rows = await baseList(tx).where(where).orderBy(...order).limit(f.pageSize).offset((f.page - 1) * f.pageSize);
    return { rows: await maskRows(tx, ctx, rows), total, page: f.page, pageSize: f.pageSize, pageCount: Math.max(1, Math.ceil(total / f.pageSize)), filters: f };
  });
}
export type TicketRow = Awaited<ReturnType<typeof listTickets>>["rows"][number];

export async function getTicket(ctx: OrgContext, id: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ t: supportTickets, statusName: ticketStatuses.name, statusColor: ticketStatuses.color, typeName: ticketTypes.name, customerName: customers.displayName, assigneeName: user.name, teamName: teams.name })
      .from(supportTickets)
      .innerJoin(ticketStatuses, eq(ticketStatuses.id, supportTickets.statusId))
      .leftJoin(ticketTypes, eq(ticketTypes.id, supportTickets.ticketTypeId))
      .leftJoin(customers, and(eq(customers.organizationId, supportTickets.organizationId), eq(customers.id, supportTickets.customerId)))
      .leftJoin(memberships, and(eq(memberships.organizationId, supportTickets.organizationId), eq(memberships.id, supportTickets.assigneeMembershipId)))
      .leftJoin(user, eq(user.id, memberships.userId))
      .leftJoin(teams, and(eq(teams.organizationId, supportTickets.organizationId), eq(teams.id, supportTickets.teamId)))
      .where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.id, id)));
    if (!row || !visible(ctx, row.t)) return null;
    const author = user;
    const [messages, atts, links] = await Promise.all([
      tx.select({ m: ticketMessages, authorName: author.name }).from(ticketMessages).leftJoin(author, eq(author.id, ticketMessages.authorUserId)).where(eq(ticketMessages.ticketId, id)).orderBy(asc(ticketMessages.createdAt)),
      tx.select({ id: ticketAttachments.id, messageId: ticketAttachments.messageId, filename: files.filename, mimeType: files.mimeType, size: files.sizeBytes }).from(ticketAttachments).innerJoin(files, eq(files.id, ticketAttachments.fileId)).where(eq(ticketAttachments.ticketId, id)).orderBy(asc(ticketAttachments.createdAt)),
      tx
        .select({ id: ticketRecordLinks.id, orderId: ticketRecordLinks.orderId, leadId: ticketRecordLinks.leadId, orderNumber: orders.number, orderStatus: orders.paymentStatus, leadNumber: leads.number, leadTitle: leads.title, leadOwner: leads.ownerMembershipId })
        .from(ticketRecordLinks)
        .leftJoin(orders, eq(orders.id, ticketRecordLinks.orderId))
        .leftJoin(leads, eq(leads.id, ticketRecordLinks.leadId))
        .where(eq(ticketRecordLinks.ticketId, id)),
    ]);
    const [masked] = await maskRows(tx, ctx, [{ customerId: row.t.customerId, customerName: row.customerName }]);
    const seeOrders = ctx.permissions.has("orders.read");
    const seeLead = (owner: string | null) => ctx.permissions.has("leads.read") || (ctx.permissions.has("leads.read_assigned") && owner === ctx.membershipId);
    return {
      ...row.t,
      statusName: row.statusName, statusColor: row.statusColor, typeName: row.typeName, assigneeName: row.assigneeName, teamName: row.teamName,
      customerName: masked.customerName, customerVisible: masked.customerVisible,
      messages: messages.map((x) => ({ ...x.m, authorName: x.authorName, attachments: atts.filter((a) => a.messageId === x.m.id) })),
      attachments: atts.filter((a) => !a.messageId),
      links: links
        .filter((l) => (l.orderId ? seeOrders : seeLead(l.leadOwner)))
        .map((l) => ({ id: l.id, type: l.orderId ? ("order" as const) : ("lead" as const), recordId: (l.orderId ?? l.leadId)!, label: l.orderId ? `ORD-${l.orderNumber}` : `LEAD-${l.leadNumber} · ${l.leadTitle}` })),
    };
  });
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

export async function getTicketTimeline(ctx: OrgContext, id: string) {
  needRead(ctx);
  return withTenant(ctx, async (tx) => {
    await loadTicket(tx, ctx, id);
    return tx
      .select({ id: auditLogs.id, action: auditLogs.action, metadata: auditLogs.metadata, changes: auditLogs.changes, createdAt: auditLogs.createdAt, actorName: user.name })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "ticket"), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
  });
}

/** Workload counts (current, not date-bound) plus resolved/first-response figures for a period. */
export async function getSupportStats(ctx: OrgContext, opts: { since?: Date; until?: Date; membershipId?: string } = {}) {
  if (!canReadAll(ctx) && !ctx.permissions.has("tickets.read_assigned")) return null;
  return withTenant(ctx, async (tx) => {
    const scope = and(eq(supportTickets.organizationId, ctx.orgId), ticketScope(ctx), opts.membershipId ? eq(supportTickets.assigneeMembershipId, opts.membershipId) : undefined);
    const since = (opts.since ?? new Date(Date.now() - 30 * 86_400_000)).toISOString();
    const until = (opts.until ?? new Date()).toISOString();
    const [c] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${supportTickets.statusCategory} in ('new','open','pending_customer','pending_internal','escalated'))::int`,
        unassigned: sql<number>`count(*) filter (where ${supportTickets.statusCategory} in ('new','open','pending_customer','pending_internal','escalated') and ${supportTickets.assigneeMembershipId} is null)::int`,
        urgent: sql<number>`count(*) filter (where ${supportTickets.statusCategory} in ('new','open','pending_customer','pending_internal','escalated') and ${supportTickets.priority} in ('urgent','high'))::int`,
        mine: sql<number>`count(*) filter (where ${supportTickets.statusCategory} in ('new','open','pending_customer','pending_internal','escalated') and ${supportTickets.assigneeMembershipId} = ${ctx.membershipId})::int`,
        awaitingReply: sql<number>`count(*) filter (where ${supportTickets.statusCategory} in ('new','open','escalated') and ${supportTickets.lastCustomerMessageAt} is not null and (${supportTickets.firstRespondedAt} is null or ${supportTickets.lastCustomerMessageAt} > ${supportTickets.firstRespondedAt}))::int`,
        resolved: sql<number>`count(*) filter (where ${supportTickets.resolvedAt} >= ${since}::timestamptz and ${supportTickets.resolvedAt} < ${until}::timestamptz)::int`,
        created: sql<number>`count(*) filter (where ${supportTickets.createdAt} >= ${since}::timestamptz and ${supportTickets.createdAt} < ${until}::timestamptz)::int`,
        medianFirstResponseMin: sql<number | null>`(percentile_cont(0.5) within group (order by extract(epoch from (${supportTickets.firstRespondedAt} - ${supportTickets.createdAt})) / 60) filter (where ${supportTickets.firstRespondedAt} >= ${since}::timestamptz and ${supportTickets.firstRespondedAt} < ${until}::timestamptz))::float`,
      })
      .from(supportTickets)
      .where(scope);
    const priorityList = await baseList(tx)
      .where(and(scope, inArray(supportTickets.statusCategory, ACTIVE)))
      .orderBy(asc(PRIORITY_ORDER), asc(supportTickets.createdAt))
      .limit(5);
    return { ...c, priorityTickets: await maskRows(tx, ctx, priorityList) };
  });
}

export async function getCustomerTicketCounts(ctx: OrgContext, customerId: string) {
  if (!canReadAll(ctx) && !ctx.permissions.has("tickets.read_assigned")) return null;
  return withTenant(ctx, async (tx) => {
    const [r] = await tx
      .select({ open: sql<number>`count(*) filter (where ${supportTickets.statusCategory} not in ('resolved','closed'))::int`, total: count() })
      .from(supportTickets)
      .where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.customerId, customerId), ticketScope(ctx)));
    return r;
  });
}

/** Lightweight count for navigation badges. */
export async function countOpenTickets(ctx: OrgContext) {
  if (!canReadAll(ctx) && !ctx.permissions.has("tickets.read_assigned")) return 0;
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select({ n: count() }).from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), ticketScope(ctx), notInArray(supportTickets.statusCategory, DONE)));
    return r.n;
  });
}

export async function searchTicketsForPicker(ctx: OrgContext, q: string) {
  needRead(ctx);
  const r = await listTickets(ctx, { view: "all", q, pageSize: 25 });
  return r.rows.slice(0, 10).map((t) => ({ id: t.id, label: `TCK-${t.number} · ${t.subject}`, sub: t.customerName ?? undefined }));
}


/** Files attached to this customer's tickets that the user can see. */
export async function listCustomerFiles(ctx: OrgContext, customerId: string) {
  if (!canReadAll(ctx) && !ctx.permissions.has("tickets.read_assigned")) return null;
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: ticketAttachments.id, filename: files.filename, mimeType: files.mimeType, size: files.sizeBytes, createdAt: ticketAttachments.createdAt, ticketId: supportTickets.id, ticketNumber: supportTickets.number })
      .from(ticketAttachments)
      .innerJoin(files, eq(files.id, ticketAttachments.fileId))
      .innerJoin(supportTickets, eq(supportTickets.id, ticketAttachments.ticketId))
      .where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.customerId, customerId), ticketScope(ctx)))
      .orderBy(desc(ticketAttachments.createdAt))
      .limit(200),
  );
}
