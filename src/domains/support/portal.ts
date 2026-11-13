import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { orders } from "@/domains/commerce/schema";
import { customerEmails, customers } from "@/domains/customers/schema";
import { deriveDisplayName, normalizeEmail } from "@/domains/customers/normalize";
import { memberships, organizations } from "@/domains/identity/schema";
import { notify } from "@/domains/platform/notifications";
import { audit, emit } from "@/server/audit/audit";
import type { Tx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequences";
import { withScope } from "@/server/db/tenant";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { parseInput } from "@/server/validate";
import { newId } from "@/lib/ids";
import { routeTicket } from "./routing";
import {
  portalAccessTokens, portalRoutes, portalSubmissions, supportPortals, supportTickets, ticketFormVersions, ticketForms, ticketMessages, ticketRecordLinks, ticketStatuses,
  type FormField, type StatusCategory,
} from "./schema";
import { applySla } from "./sla";
import { applyStatus, ensureSupportDefaults, statusOf } from "./service";

const SYSTEM = (orgId: string) => ({ orgId, userId: null });
const TOKEN_TTL_DAYS = 120;
const LIMITS = { ticket: { perIp: 5, perEmail: 5 }, reply: { perIp: 30, perEmail: 30 } };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const ipHash = (ip: string) => sha(`${process.env.BETTER_AUTH_SECRET ?? ""}:${ip}`);

/** Customer-facing status wording. */
export const PORTAL_STATUS: Record<StatusCategory, string> = {
  new: "Received", open: "In progress", pending_internal: "In progress", escalated: "In progress",
  pending_customer: "Waiting for your reply", resolved: "Resolved", closed: "Closed",
};

/* ───────── resolving the public portal ───────── */

async function orgForSlug(slug: string) {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [r] = await withScope({}, (tx) => tx.select().from(portalRoutes).where(eq(portalRoutes.slug, slug)));
  return r?.organizationId ?? null;
}

export async function getPortal(slug: string) {
  const orgId = await orgForSlug(slug);
  if (!orgId) return null;
  return withScope({ orgId }, async (tx) => {
    const [p] = await tx.select().from(supportPortals).where(eq(supportPortals.organizationId, orgId));
    if (!p || !p.enabled || p.slug !== slug) return null;
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const forms = await tx
      .select({ id: ticketForms.id, description: ticketForms.description, versionId: ticketFormVersions.id, name: ticketFormVersions.name, fields: ticketFormVersions.fields })
      .from(ticketForms)
      .innerJoin(ticketFormVersions, eq(ticketFormVersions.id, ticketForms.currentVersionId))
      .where(and(eq(ticketForms.organizationId, orgId), isNull(ticketForms.archivedAt), eq(ticketForms.portalVisible, 1)))
      .orderBy(asc(ticketForms.position), asc(ticketForms.createdAt));
    return { orgId, slug, title: p.title, welcome: p.welcome, orgName: org.name, forms };
  });
}
export type PortalView = NonNullable<Awaited<ReturnType<typeof getPortal>>>;

/* ───────── rate limiting ───────── */

async function limit(tx: Tx, orgId: string, kind: "ticket" | "reply", ip: string, email: string) {
  const since = new Date(Date.now() - 3_600_000);
  const h = ipHash(ip);
  const [{ byIp, byEmail }] = await tx
    .select({ byIp: sql<number>`count(*) filter (where ${portalSubmissions.ipHash} = ${h})::int`, byEmail: sql<number>`count(*) filter (where ${portalSubmissions.email} = ${email})::int` })
    .from(portalSubmissions)
    .where(and(eq(portalSubmissions.organizationId, orgId), eq(portalSubmissions.kind, kind), gt(portalSubmissions.createdAt, since)));
  if (byIp >= LIMITS[kind].perIp || byEmail >= LIMITS[kind].perEmail) throw new ConflictError("Too many requests from you in the last hour. Please try again later.");
  await tx.insert(portalSubmissions).values({ organizationId: orgId, ipHash: h, email, kind });
}

/* ───────── submitting ───────── */

const submitSchema = z.object({
  formId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  subject: z.string().trim().min(1, "What's this about?").max(200),
  message: z.string().trim().min(1, "Tell us what happened").max(10_000),
  fields: z.record(z.string(), z.unknown()).default({}),
  website: z.string().max(0, "Leave this empty").optional(), // honeypot
});
export type PortalSubmission = z.input<typeof submitSchema>;

/** Validates answers against a published form version; returns clean values and order numbers to link. */
export function validateFormAnswers(fields: FormField[], raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  const orderNumbers: number[] = [];
  for (const f of fields) {
    const v = raw[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) || (f.type === "checkbox" && v !== true && v !== "on" && v !== "true");
    if (empty) {
      if (f.required) errors[`fields.${f.key}`] = [f.type === "checkbox" ? "Please confirm" : "Required"];
      continue;
    }
    const s = String(v).trim().slice(0, 2000);
    switch (f.type) {
      case "email":
        if (!z.string().email().safeParse(s).success) errors[`fields.${f.key}`] = ["Enter a valid email"];
        else out[f.key] = s;
        break;
      case "number":
        if (!Number.isFinite(Number(s))) errors[`fields.${f.key}`] = ["Enter a number"];
        else out[f.key] = Number(s);
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[`fields.${f.key}`] = ["Choose a date"];
        else out[f.key] = s;
        break;
      case "checkbox":
        out[f.key] = true;
        break;
      case "select":
        if (!f.options?.includes(s)) errors[`fields.${f.key}`] = ["Choose an option"];
        else out[f.key] = s;
        break;
      case "multi_select": {
        const list = (Array.isArray(v) ? v : [v]).map(String);
        if (list.some((x) => !f.options?.includes(x))) errors[`fields.${f.key}`] = ["Choose from the options"];
        else out[f.key] = list;
        break;
      }
      case "order_number": {
        const n = /^(?:ORD-?)?0*(\d{1,9})$/i.exec(s.replace(/\s/g, ""));
        out[f.key] = s;
        if (n) orderNumbers.push(Number(n[1]));
        break;
      }
      default:
        out[f.key] = s;
    }
  }
  if (Object.keys(errors).length) throw new ValidationError("Please check the highlighted fields.", errors);
  return { values: out, orderNumbers };
}

async function findOrCreateCustomer(tx: Tx, orgId: string, name: string, email: string) {
  const norm = normalizeEmail(email);
  const [hit] = await tx
    .select({ id: customers.id })
    .from(customerEmails)
    .innerJoin(customers, eq(customers.id, customerEmails.customerId))
    .where(and(eq(customerEmails.organizationId, orgId), eq(customerEmails.normalizedEmail, norm), ne(customers.status, "merged")))
    .limit(1);
  if (hit) return { id: hit.id, created: false };
  const [first, ...rest] = name.split(/\s+/);
  const id = newId();
  const number = await nextNumber(tx, orgId, "customer");
  await tx.insert(customers).values({
    id, organizationId: orgId, number, type: "person", status: "provisional", source: "support_portal",
    firstName: first.slice(0, 80), lastName: rest.join(" ").slice(0, 80) || null, displayName: deriveDisplayName({ firstName: first, lastName: rest.join(" ") || null, email, phone: null }),
  } as typeof customers.$inferInsert);
  await tx.insert(customerEmails).values({ organizationId: orgId, customerId: id, email, normalizedEmail: norm, isPrimary: true });
  await audit(tx, SYSTEM(orgId), { action: "customer.created", entityType: "customer", entityId: id, metadata: { source: "support_portal" } });
  return { id, created: true };
}

async function issueToken(tx: Tx, orgId: string, ticketId: string) {
  const secret = randomBytes(24).toString("base64url");
  await tx.insert(portalAccessTokens).values({ organizationId: orgId, ticketId, tokenHash: sha(secret), expiresAt: new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000) });
  return secret;
}

/**
 * A customer submits a request from the public portal. Creates (or matches by email) the customer,
 * the ticket with form answers, runs routing and SLA, and returns a private link to follow it.
 */
export async function submitPortalTicket(slug: string, input: unknown, meta: { ip: string }) {
  const portal = await getPortal(slug);
  if (!portal) throw new NotFoundError("This support portal isn't available.");
  const data = parseInput(submitSchema, input);
  const orgId = portal.orgId;
  return withScope({ orgId }, async (tx) => {
    await ensureSupportDefaults(tx, orgId);
    let version: { id: string; formId: string; fields: FormField[]; priority: string; ticketTypeId: string | null } | null = null;
    if (data.formId) {
      const [f] = await tx
        .select({ id: ticketFormVersions.id, formId: ticketForms.id, fields: ticketFormVersions.fields, priority: ticketForms.priority, ticketTypeId: ticketForms.ticketTypeId })
        .from(ticketForms)
        .innerJoin(ticketFormVersions, eq(ticketFormVersions.id, ticketForms.currentVersionId))
        .where(and(eq(ticketForms.organizationId, orgId), eq(ticketForms.id, data.formId), isNull(ticketForms.archivedAt), eq(ticketForms.portalVisible, 1)));
      if (!f) throw new ValidationError("Choose what you need help with.", { formId: ["This form isn't available"] });
      version = f;
    }
    const answers = version ? validateFormAnswers(version.fields, data.fields) : { values: {}, orderNumbers: [] };
    const email = normalizeEmail(data.email);
    await limit(tx, orgId, "ticket", meta.ip, email);
    const customer = await findOrCreateCustomer(tx, orgId, data.name, data.email);
    const [status] = await tx.select().from(ticketStatuses).where(and(eq(ticketStatuses.organizationId, orgId), eq(ticketStatuses.isDefault, 1)));
    const st = status ?? (await statusOf(tx, orgId, "new"))!;
    const id = newId();
    const number = await nextNumber(tx, orgId, "ticket");
    const now = new Date();
    await tx.insert(supportTickets).values({
      id, organizationId: orgId, number, subject: data.subject, description: data.message, customerId: customer.id, channel: "portal",
      ticketTypeId: version?.ticketTypeId ?? null, statusId: st.id, statusCategory: st.category, priority: version?.priority ?? "normal",
      contactEmail: data.email, formVersionId: version?.id ?? null, customFields: answers.values, lastActivityAt: now, lastCustomerMessageAt: now,
    });
    await tx.insert(ticketMessages).values({ organizationId: orgId, ticketId: id, kind: "customer", body: data.message, channel: "portal", deliveryStatus: "received" });
    // Only link orders that belong to this customer, so a portal visitor can't attach someone else's order.
    if (answers.orderNumbers.length) {
      const own = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.customerId, customer.id), inArray(orders.number, answers.orderNumbers)));
      for (const o of own) await tx.insert(ticketRecordLinks).values({ organizationId: orgId, ticketId: id, orderId: o.id }).onConflictDoNothing();
    }
    const routed = await routeTicket(tx, orgId, id, { fillOnly: false });
    await applySla(tx, orgId, id, now);
    await audit(tx, SYSTEM(orgId), { action: "ticket.created", entityType: "ticket", entityId: id, metadata: { number, subject: data.subject, channel: "portal", form: version?.formId ?? null } });
    await audit(tx, SYSTEM(orgId), { action: "customer.ticket_created", entityType: "customer", entityId: customer.id, metadata: { ticketId: id, preview: `TCK-${number} · ${data.subject}` } });
    await tx.update(customers).set({ lastActivityAt: now }).where(eq(customers.id, customer.id));
    if (!routed?.patch.assigneeMembershipId) await notifyTriage(tx, orgId, { id, number, subject: data.subject });
    const secret = await issueToken(tx, orgId, id);
    await emit(tx, orgId, "ticket.created", { ticketId: id, channel: "portal" });
    return { number, path: `/portal/${slug}/t/${secret}` };
  });
}

/** Unassigned portal tickets alert whoever can assign tickets. */
async function notifyTriage(tx: Tx, orgId: string, t: { id: string; number: number; subject: string }) {
  const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
  const rows = await tx.execute<{ user_id: string }>(sql`
    select distinct m.user_id from memberships m join role_permissions rp on rp.role_id = m.role_id
    where m.organization_id = ${orgId} and m.status = 'active' and rp.permission_key = 'tickets.assign'`);
  for (const r of rows) await notify(tx, { orgId, recipientUserId: r.user_id, type: "ticket.assigned", title: `New portal request TCK-${t.number}`, body: t.subject, link: `/o/${org.slug}/support/tickets/${t.id}`, entityType: "ticket", entityId: t.id });
}

/* ───────── following a ticket ───────── */

async function ticketForToken(tx: Tx, orgId: string, secret: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const [tok] = await tx.select().from(portalAccessTokens).where(and(eq(portalAccessTokens.organizationId, orgId), eq(portalAccessTokens.tokenHash, sha(secret)), isNull(portalAccessTokens.revokedAt), gt(portalAccessTokens.expiresAt, new Date())));
  if (!tok) return null;
  const [t] = await tx.select().from(supportTickets).where(and(eq(supportTickets.organizationId, orgId), eq(supportTickets.id, tok.ticketId)));
  return t ? { token: tok, ticket: t } : null;
}

export async function getPortalTicket(slug: string, secret: string) {
  const portal = await getPortal(slug);
  if (!portal) return null;
  return withScope({ orgId: portal.orgId }, async (tx) => {
    const hit = await ticketForToken(tx, portal.orgId, secret);
    if (!hit) return null;
    await tx.update(portalAccessTokens).set({ lastUsedAt: new Date() }).where(eq(portalAccessTokens.id, hit.token.id));
    const t = hit.ticket;
    // Customers see the public conversation only: their own messages and staff replies. Never internal notes.
    const messages = await tx
      .select({ id: ticketMessages.id, kind: ticketMessages.kind, body: ticketMessages.body, createdAt: ticketMessages.createdAt })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, t.id), or(eq(ticketMessages.kind, "reply"), eq(ticketMessages.kind, "customer"))))
      .orderBy(asc(ticketMessages.createdAt));
    return {
      portal: { title: portal.title, orgName: portal.orgName, slug },
      ticket: { number: t.number, subject: t.subject, status: PORTAL_STATUS[t.statusCategory], category: t.statusCategory, createdAt: t.createdAt, closed: t.statusCategory === "closed" },
      messages: messages.map((m) => ({ id: m.id, from: m.kind === "reply" ? ("team" as const) : ("you" as const), body: m.body, createdAt: m.createdAt })),
    };
  });
}

export async function replyPortalTicket(slug: string, secret: string, input: unknown, meta: { ip: string }) {
  const portal = await getPortal(slug);
  if (!portal) throw new NotFoundError("This support portal isn't available.");
  const { body } = parseInput(z.object({ body: z.string().trim().min(1, "Write a message").max(10_000) }), input);
  const orgId = portal.orgId;
  return withScope({ orgId }, async (tx) => {
    const hit = await ticketForToken(tx, orgId, secret);
    if (!hit) throw new NotFoundError("This link has expired.");
    const [t] = await tx.select().from(supportTickets).where(eq(supportTickets.id, hit.ticket.id)).for("update");
    if (t.statusCategory === "closed") throw new ConflictError("This request is closed. Please submit a new request.");
    await limit(tx, orgId, "reply", meta.ip, `ticket:${t.id}`);
    const now = new Date();
    const mid = newId();
    await tx.insert(ticketMessages).values({ id: mid, organizationId: orgId, ticketId: t.id, kind: "customer", body, channel: "portal", deliveryStatus: "received" });
    await tx.update(supportTickets).set({ lastActivityAt: now, lastCustomerMessageAt: now, updatedAt: now }).where(eq(supportTickets.id, t.id));
    await audit(tx, SYSTEM(orgId), { action: "ticket.customer_message", entityType: "ticket", entityId: t.id, metadata: { messageId: mid, channel: "portal" } });
    if (t.statusCategory === "pending_customer" || t.statusCategory === "resolved") {
      const to = await statusOf(tx, orgId, "open");
      if (to) await applyStatus(tx, SYSTEM(orgId), { ...t, lastActivityAt: now }, to);
    }
    if (t.customerId) await audit(tx, SYSTEM(orgId), { action: "customer.replied", entityType: "customer", entityId: t.customerId, metadata: { ticketId: t.id, preview: `TCK-${t.number}` } });
    if (t.assigneeMembershipId) {
      const [m] = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.id, t.assigneeMembershipId));
      const [org] = await tx.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, orgId));
      if (m) await notify(tx, { orgId, recipientUserId: m.userId, type: "ticket.assigned", title: `Customer replied on TCK-${t.number}`, body: t.subject, link: `/o/${org.slug}/support/tickets/${t.id}`, entityType: "ticket", entityId: t.id });
    }
    await emit(tx, orgId, "ticket.message_added", { ticketId: t.id, messageId: mid, kind: "customer" });
    return { id: mid };
  });
}

/** For the agent view: whether the customer can read replies through the portal. */
export async function portalAccessFor(tx: Tx, ticketId: string) {
  const [tok] = await tx.select({ expiresAt: portalAccessTokens.expiresAt, lastUsedAt: portalAccessTokens.lastUsedAt }).from(portalAccessTokens)
    .where(and(eq(portalAccessTokens.ticketId, ticketId), isNull(portalAccessTokens.revokedAt), gt(portalAccessTokens.expiresAt, new Date())))
    .orderBy(desc(portalAccessTokens.createdAt)).limit(1);
  return tok ?? null;
}
