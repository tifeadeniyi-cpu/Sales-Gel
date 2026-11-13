import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createCustomer, setCustomerTagNames } from "@/domains/customers/service";
import { createTeam, setTeamMembers } from "@/domains/identity/service";
import { createOrder } from "@/domains/commerce/orders";
import { addTicketMessage, changeTicketStatus, createTicket, getTicket, listTicketConfig, updateTicket } from "@/domains/support/service";
import {
  addHoliday, archiveRoutingRule, createRoutingRule, createSlaPolicy, createTicketForm, getSupportSettings, moveSlaPolicy, publishTicketForm, savePortal, saveBusinessHours, updateTicketForm,
} from "@/domains/support/config";
import { getPortal, getPortalTicket, replyPortalTicket, submitPortalTicket, validateFormAnswers } from "@/domains/support/portal";
import { portalAccessTokens, supportTickets, ticketFormVersions, ticketRecordLinks, ticketSlaEvents } from "@/domains/support/schema";
import { customers } from "@/domains/customers/schema";
import { listNotifications } from "@/domains/platform/notifications";
import { isPermissionDenied } from "@/server/db/errors";
import { withScope, withTenant } from "@/server/db/tenant";
import { runDueWork } from "@/server/jobs/worker";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];
const H = 60;
const targets = (fr: number | null, res: number | null) => ({ low: { firstResponse: fr, resolution: res }, normal: { firstResponse: fr, resolution: res }, high: { firstResponse: fr, resolution: res }, urgent: { firstResponse: fr, resolution: res } });
const row = (ctx: Ctx, id: string) => withTenant(ctx, async (tx) => (await tx.select().from(supportTickets).where(eq(supportTickets.id, id)))[0]);
const events = (ctx: Ctx, id: string) => withTenant(ctx, async (tx) => (await tx.select().from(ticketSlaEvents).where(eq(ticketSlaEvents.ticketId, id)).orderBy(ticketSlaEvents.createdAt)).map((e) => e.kind));
/** Moves a ticket's creation back in time and re-applies the SLA, as if it had been open that long. */
async function age(ctx: Ctx, id: string, minutes: number) {
  const { applySla } = await import("@/domains/support/sla");
  await withScope({ orgId: ctx.orgId }, async (tx) => {
    await tx.update(supportTickets).set({ createdAt: new Date(Date.now() - minutes * 60_000) }).where(eq(supportTickets.id, id));
    await applySla(tx, ctx.orgId, id);
  });
}
/** Asserts a ValidationError whose field messages match. */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(ValidationError);
  expect(JSON.stringify((e as ValidationError).fieldErrors ?? {}) + (e as Error).message).toMatch(re);
}
const statusId = async (ctx: Ctx, category: string) => (await listTicketConfig(ctx)).statuses.find((s) => s.category === category)!.id;

describe("SLA policies", () => {
  it("applies the first matching policy by position and recomputes on priority change", async () => {
    const { ctx } = await createOrgWithOwner("SlaOrder");
    await createSlaPolicy(ctx, { name: "Urgent", calendar: "24x7", conditions: { priorities: ["urgent"] }, targets: { urgent: { firstResponse: 15, resolution: 4 * H } } });
    await createSlaPolicy(ctx, { name: "Everyone", calendar: "24x7", targets: targets(8 * H, 48 * H) });
    const { id } = await createTicket(ctx, { subject: "Where is my order?", priority: "normal" });
    let t = await row(ctx, id);
    expect(t.firstResponseDueAt!.getTime() - t.createdAt.getTime()).toBe(8 * H * 60_000);
    expect(t.resolutionDueAt!.getTime() - t.createdAt.getTime()).toBe(48 * H * 60_000);
    await updateTicket(ctx, id, { priority: "urgent" });
    t = await row(ctx, id);
    expect(t.firstResponseDueAt!.getTime() - t.createdAt.getTime()).toBe(15 * 60_000);
    expect(await events(ctx, id)).toEqual(["applied", "applied"]);
  });

  it("re-orders policies and re-applies to open tickets", async () => {
    const { ctx } = await createOrgWithOwner("SlaMove");
    const a = await createSlaPolicy(ctx, { name: "Slow", calendar: "24x7", targets: targets(10 * H, null) });
    const b = await createSlaPolicy(ctx, { name: "Fast", calendar: "24x7", targets: targets(1 * H, null) });
    const { id } = await createTicket(ctx, { subject: "Hi" });
    expect((await row(ctx, id)).slaPolicyId).toBe(a.id);
    await moveSlaPolicy(ctx, b.id, "up");
    expect((await row(ctx, id)).slaPolicyId).toBe(b.id);
  });

  it("uses business hours (and holidays) unless the policy is 24/7", async () => {
    const { ctx } = await createOrgWithOwner("SlaHours");
    await saveBusinessHours(ctx, { timezone: "America/Chicago", schedule: { "1": [[540, 1020]], "2": [[540, 1020]], "3": [[540, 1020]], "4": [[540, 1020]], "5": [[540, 1020]] } });
    await createSlaPolicy(ctx, { name: "Biz", calendar: "business", targets: targets(2 * H, null) });
    const { id } = await createTicket(ctx, { subject: "Weekend question" });
    // Pin creation to Saturday 2026-11-14 12:00 CST: due Monday 11:00 CST.
    const { applySla } = await import("@/domains/support/sla");
    await withScope({ orgId: ctx.orgId }, async (tx) => {
      await tx.update(supportTickets).set({ createdAt: new Date("2026-11-14T18:00:00Z") }).where(eq(supportTickets.id, id));
      await applySla(tx, ctx.orgId, id, new Date("2026-11-14T18:00:00Z"));
    });
    expect((await row(ctx, id)).firstResponseDueAt!.toISOString()).toBe("2026-11-16T17:00:00.000Z");
    await addHoliday(ctx, { date: "2026-11-16", name: "Team day" });
    expect((await row(ctx, id)).firstResponseDueAt!.toISOString()).toBe("2026-11-17T17:00:00.000Z");
    await expect(saveBusinessHours(ctx, { timezone: "America/Chicago", schedule: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveBusinessHours(ctx, { timezone: "Mars/Olympus", schedule: { "1": [[540, 600]] } })).rejects.toBeInstanceOf(ValidationError);
    await rejectsWith(saveBusinessHours(ctx, { timezone: "UTC", schedule: { "1": [[540, 700], [600, 800]] } }), /overlap/);
  });

  it("records first response met, pauses while waiting on the customer, and resolution met", async () => {
    const { ctx } = await createOrgWithOwner("SlaFlow");
    await createSlaPolicy(ctx, { name: "Std", calendar: "24x7", targets: targets(1 * H, 4 * H) });
    const { id } = await createTicket(ctx, { subject: "Broken jar", description: "Arrived cracked" });
    await addTicketMessage(ctx, id, { kind: "reply", body: "So sorry — can you send a photo?" }); // → waiting on customer (paused)
    let t = await row(ctx, id);
    expect(t.statusCategory).toBe("pending_customer");
    expect(t.slaPausedAt).not.toBeNull();
    expect(t.resolutionDueAt).toBeNull();
    // Simulate 30 minutes paused.
    await withScope({ orgId: ctx.orgId }, (tx) => tx.update(supportTickets).set({ slaPausedAt: new Date(Date.now() - 30 * 60_000) }).where(eq(supportTickets.id, id)));
    await addTicketMessage(ctx, id, { kind: "customer", body: "Here it is" }); // → open (resumed)
    t = await row(ctx, id);
    expect(t.slaPausedAt).toBeNull();
    expect(t.slaPausedMinutes).toBeGreaterThanOrEqual(29);
    expect(t.resolutionDueAt!.getTime() - t.createdAt.getTime()).toBe((4 * H + t.slaPausedMinutes) * 60_000);
    await changeTicketStatus(ctx, id, { statusId: await statusId(ctx, "resolved"), resolutionCategory: "replacement_sent" });
    expect(await events(ctx, id)).toEqual(["applied", "first_response_met", "paused", "resumed", "resolution_met", "paused"]);
    const detail = await getTicket(ctx, id);
    expect(detail!.sla?.policy).toBe("Std");
  });

  it("breaches in the background, notifies, and escalates once", async () => {
    const { ctx } = await createOrgWithOwner("SlaBreach");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    await createSlaPolicy(ctx, { name: "Tight", calendar: "24x7", escalateOnBreach: true, targets: targets(10, 60) });
    const { id } = await createTicket(ctx, { subject: "Late reply", assigneeMembershipId: agent.membershipId });
    await age(ctx, id, 90); // first response (10m) and resolution (60m) both overdue
    await runDueWork({ orgId: ctx.orgId });
    const t = await row(ctx, id);
    expect(t.firstResponseBreachedAt).not.toBeNull();
    expect(t.resolutionBreachedAt).not.toBeNull();
    expect(t.statusCategory).toBe("escalated");
    expect(t.escalatedAt).not.toBeNull();
    const kinds = await events(ctx, id);
    expect(kinds.filter((k) => k === "escalated")).toHaveLength(1);
    expect(kinds).toEqual(expect.arrayContaining(["first_response_breached", "resolution_breached"]));
    expect((await listNotifications(agent)).filter((n) => n.type === "sla.warning")).toHaveLength(2);
    expect((await listNotifications(ctx)).some((n) => n.type === "ticket.escalated")).toBe(true);
    // A late first reply doesn't turn it into "met".
    await addTicketMessage(agent, id, { kind: "reply", body: "Sorry for the wait" });
    expect(await events(ctx, id)).not.toContain("first_response_met");
  });

  it("ignores stale checks when the clock was met or moved", async () => {
    const { ctx } = await createOrgWithOwner("SlaStale");
    await createSlaPolicy(ctx, { name: "Std", calendar: "24x7", targets: targets(10, null) });
    const { id } = await createTicket(ctx, { subject: "Quick one" });
    await addTicketMessage(ctx, id, { kind: "reply", body: "On it" });
    await age(ctx, id, 30);
    await runDueWork({ orgId: ctx.orgId });
    expect((await row(ctx, id)).firstResponseBreachedAt).toBeNull();
  });

  it("only support configurators can manage policies", async () => {
    const { ctx } = await createOrgWithOwner("SlaPerm");
    const { ctx: agent } = await addMember(ctx, "support_agent");
    await expect(createSlaPolicy(agent, { name: "X", targets: targets(10, null) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSupportSettings(agent)).rejects.toBeInstanceOf(ForbiddenError);
    await rejectsWith(createSlaPolicy(ctx, { name: "Bad", targets: targets(60, 30) }), /faster/);
  });
});

describe("routing rules", () => {
  it("assigns by keyword to a team in round robin and fills only what staff left empty", async () => {
    const { ctx } = await createOrgWithOwner("RouteRR");
    const { ctx: a1 } = await addMember(ctx, "support_agent");
    const { ctx: a2 } = await addMember(ctx, "support_agent");
    const { ctx: rep } = await addMember(ctx, "sales_rep"); // no ticket access → skipped
    const team = await createTeam(ctx, { name: "Deliveries" });
    await setTeamMembers(ctx, team.id, [a1.membershipId, a2.membershipId, rep.membershipId]);
    const { types } = await listTicketConfig(ctx);
    const delivery = types.find((t) => t.name === "Delivery problem")!;
    await createRoutingRule(ctx, { name: "Delivery", conditions: { keywords: ["delivery", "courier"] }, actions: { teamId: team.id, assign: "round_robin", ticketTypeId: delivery.id, addTags: ["shipping"] } });
    const t1 = await createTicket(ctx, { subject: "Delivery is late" });
    const t2 = await createTicket(ctx, { subject: "Courier lost my parcel" });
    const t3 = await createTicket(ctx, { subject: "Where's my delivery" });
    const other = await createTicket(ctx, { subject: "Question about spices" });
    const [r1, r2, r3, r4] = await Promise.all([row(ctx, t1.id), row(ctx, t2.id), row(ctx, t3.id), row(ctx, other.id)]);
    expect([r1.assigneeMembershipId, r2.assigneeMembershipId, r3.assigneeMembershipId]).toEqual([a1.membershipId, a2.membershipId, a1.membershipId]);
    expect(r1).toMatchObject({ teamId: team.id, ticketTypeId: delivery.id, tags: ["shipping"] });
    expect(r4.assigneeMembershipId).toBeNull();
    expect((await listNotifications(a1)).filter((n) => n.title.includes("assigned"))).toHaveLength(2);
    // Staff picked an assignee: kept.
    const manual = await createTicket(ctx, { subject: "delivery damaged", assigneeMembershipId: a2.membershipId });
    expect((await row(ctx, manual.id)).assigneeMembershipId).toBe(a2.membershipId);
  });

  it("first matching rule wins; archived rules are skipped; priority and channel conditions", async () => {
    const { ctx } = await createOrgWithOwner("RouteOrder");
    const { ctx: a1 } = await addMember(ctx, "support_agent");
    const vip = await createRoutingRule(ctx, { name: "VIP", conditions: { customerTags: ["VIP"] }, actions: { assign: "member", membershipId: a1.membershipId } });
    await createRoutingRule(ctx, { name: "All", conditions: {}, actions: { addTags: ["triage"] } });
    const c = await createCustomer(ctx, { firstName: "Funke" });
    await setCustomerTagNames(ctx, c.id, ["vip"]);
    const t = await createTicket(ctx, { subject: "Hello", customerId: c.id });
    expect((await row(ctx, t.id)).assigneeMembershipId).toBe(a1.membershipId);
    expect((await row(ctx, t.id)).tags).toEqual([]);
    await archiveRoutingRule(ctx, vip.id);
    const t2 = await createTicket(ctx, { subject: "Hello again", customerId: c.id });
    expect((await row(ctx, t2.id)).tags).toEqual(["triage"]);
    await expect(createRoutingRule(ctx, { name: "Nothing", actions: {} })).rejects.toBeInstanceOf(ValidationError);
    await rejectsWith(createRoutingRule(ctx, { name: "RR", actions: { assign: "round_robin" } }), /team/);
  });
});

describe("forms and portal", () => {
  async function portalOrg(name: string) {
    const { ctx } = await createOrgWithOwner(name);
    const slug = `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const { types } = await listTicketConfig(ctx);
    const form = await createTicketForm(ctx, {
      name: "Order problem", ticketTypeId: types.find((t) => t.name === "Order issue")!.id, priority: "high",
      fields: [
        { key: "order_no", label: "Order number", type: "order_number", required: false },
        { key: "issue", label: "What went wrong?", type: "select", required: true, options: ["Damaged", "Missing item", "Late"] },
        { key: "photos_ok", label: "I can send photos", type: "checkbox", required: false },
      ],
    });
    await publishTicketForm(ctx, form.id);
    await savePortal(ctx, { enabled: true, slug, title: `${name} Help`, welcome: "We usually reply within a day." });
    return { ctx, slug, formId: form.id };
  }

  it("publishes immutable versions; drafts don't change what customers see", async () => {
    const { ctx, slug, formId } = await portalOrg("FormVer");
    await expect(publishTicketForm(ctx, formId)).rejects.toBeInstanceOf(ConflictError); // unchanged
    await updateTicketForm(ctx, formId, { name: "Order problem", priority: "high", fields: [{ key: "issue", label: "Issue", type: "short_text", required: true }] });
    let portal = await getPortal(slug);
    expect(portal!.forms[0].fields.map((f) => f.key)).toEqual(["order_no", "issue", "photos_ok"]);
    const v2 = await publishTicketForm(ctx, formId);
    expect(v2.version).toBe(2);
    portal = await getPortal(slug);
    expect(portal!.forms[0].fields.map((f) => f.key)).toEqual(["issue"]);
    // The database refuses edits to published versions.
    const err = await withTenant(ctx, (tx) => tx.update(ticketFormVersions).set({ name: "hacked" }).where(eq(ticketFormVersions.formId, formId))).catch((e) => e);
    expect(isPermissionDenied(err)).toBe(true);
    await rejectsWith(updateTicketForm(ctx, formId, { name: "X", fields: [{ key: "email", label: "Email", type: "email" }] }), /always asked/);
  });

  it("validates answers against the form", () => {
    const fields = [
      { key: "issue", label: "Issue", type: "select" as const, required: true, options: ["A", "B"] },
      { key: "qty", label: "Qty", type: "number" as const, required: false },
      { key: "order", label: "Order", type: "order_number" as const, required: false },
    ];
    expect(validateFormAnswers(fields, { issue: "A", qty: "3", order: "ORD-0042" })).toEqual({ values: { issue: "A", qty: 3, order: "ORD-0042" }, orderNumbers: [42] });
    expect(() => validateFormAnswers(fields, { issue: "C" })).toThrow(ValidationError);
    expect(() => validateFormAnswers(fields, {})).toThrow(ValidationError);
  });

  it("customer submits, follows the ticket by private link, sees replies but never notes, and replies back", async () => {
    const { ctx, slug, formId } = await portalOrg("Portal");
    const existing = await createCustomer(ctx, { firstName: "Bisi", emails: [{ email: "bisi@example.com" }] });
    const order = await createOrder(ctx, { customerId: existing.id, lines: [{ name: "Palm oil", unitPrice: "12.00", quantity: 1 }] });
    const strangers = await createCustomer(ctx, { firstName: "Other" });
    const theirOrder = await createOrder(ctx, { customerId: strangers.id, lines: [{ name: "Rice", unitPrice: "30.00", quantity: 1 }] });
    await createSlaPolicy(ctx, { name: "High", calendar: "24x7", conditions: { priorities: ["high"] }, targets: { high: { firstResponse: 60, resolution: 480 } } });

    await expect(submitPortalTicket(slug, { formId, name: "Bisi", email: "bisi@example.com", subject: "Cracked jar", message: "It arrived broken", fields: {} }, { ip: "1.1.1.1" })).rejects.toBeInstanceOf(ValidationError); // required select
    await expect(submitPortalTicket(slug, { formId, name: "Bot", email: "b@example.com", subject: "x", message: "y", fields: { issue: "Damaged" }, website: "spam" }, { ip: "1.1.1.1" })).rejects.toBeInstanceOf(ValidationError);

    const res = await submitPortalTicket(slug, { formId, name: "Bisi Ade", email: "Bisi@Example.com", subject: "Cracked jar", message: "It arrived broken", fields: { issue: "Damaged", order_no: `ORD-${order.number}`, other: "ignored" } }, { ip: "1.1.1.1" });
    expect(res.path).toMatch(new RegExp(`^/portal/${slug}/t/[A-Za-z0-9_-]{30,}$`));
    const secret = res.path.split("/").pop()!;

    const [t] = await withTenant(ctx, (tx) => tx.select().from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.number, res.number))));
    expect(t).toMatchObject({ channel: "portal", customerId: existing.id, priority: "high", customFields: { issue: "Damaged", order_no: `ORD-${order.number}` }, createdByUserId: null });
    expect(t.firstResponseDueAt).not.toBeNull();
    const links = await withTenant(ctx, (tx) => tx.select().from(ticketRecordLinks).where(eq(ticketRecordLinks.ticketId, t.id)));
    expect(links.map((l) => l.orderId)).toEqual([order.id]);
    const detail = await getTicket(ctx, t.id);
    expect(detail!.form).toMatchObject({ name: "Order problem", version: 1 });
    expect(detail!.portalAccess).not.toBeNull();
    expect((await listNotifications(ctx)).some((n) => n.title.includes(`TCK-${res.number}`))).toBe(true);

    // Someone else's order number isn't linked.
    const r2 = await submitPortalTicket(slug, { formId, name: "Bisi", email: "bisi@example.com", subject: "Another", message: "Hi", fields: { issue: "Late", order_no: String(theirOrder.number) } }, { ip: "2.2.2.2" });
    const [t2] = await withTenant(ctx, (tx) => tx.select().from(supportTickets).where(and(eq(supportTickets.organizationId, ctx.orgId), eq(supportTickets.number, r2.number))));
    expect(await withTenant(ctx, (tx) => tx.select().from(ticketRecordLinks).where(eq(ticketRecordLinks.ticketId, t2.id)))).toHaveLength(0);

    await addTicketMessage(ctx, t.id, { kind: "note", body: "INTERNAL: check warehouse camera" });
    await addTicketMessage(ctx, t.id, { kind: "reply", body: "Sorry! A replacement is on the way." });
    const view = await getPortalTicket(slug, secret);
    expect(view!.ticket).toMatchObject({ number: res.number, status: "Waiting for your reply" });
    expect(view!.messages.map((m) => m.from)).toEqual(["you", "team"]);
    expect(JSON.stringify(view)).not.toContain("INTERNAL");

    await replyPortalTicket(slug, secret, { body: "Thank you!" }, { ip: "1.1.1.1" });
    expect((await row(ctx, t.id)).statusCategory).toBe("open");
    expect((await getPortalTicket(slug, secret))!.messages).toHaveLength(3);

    // Bad, expired, or other-portal links show nothing.
    expect(await getPortalTicket(slug, "x".repeat(32))).toBeNull();
    const other = await portalOrg("Elsewhere");
    expect(await getPortalTicket(other.slug, secret)).toBeNull();
    await withTenant(ctx, (tx) => tx.update(portalAccessTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(portalAccessTokens.ticketId, t.id)));
    expect(await getPortalTicket(slug, secret)).toBeNull();
    await expect(replyPortalTicket(slug, secret, { body: "hi" }, { ip: "1.1.1.1" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates a provisional customer for a new email; rate limits; disabled portal is unavailable", async () => {
    const { ctx, slug } = await portalOrg("Limits");
    const res = await submitPortalTicket(slug, { name: "Ngozi Eze", email: "ngozi@example.com", subject: "Question", message: "Do you ship to Austin?" }, { ip: "9.9.9.9" });
    const [c] = await withTenant(ctx, (tx) => tx.select().from(customers).where(eq(customers.organizationId, ctx.orgId)));
    expect(c).toMatchObject({ firstName: "Ngozi", lastName: "Eze", status: "provisional", source: "support_portal" });
    expect(res.number).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) await submitPortalTicket(slug, { name: "N", email: `n${i}@example.com`, subject: "Q", message: "M" }, { ip: "9.9.9.9" });
    await expect(submitPortalTicket(slug, { name: "N", email: "n9@example.com", subject: "Q", message: "M" }, { ip: "9.9.9.9" })).rejects.toThrow(/Too many/);
    await savePortal(ctx, { enabled: false, slug, title: "Off" });
    expect(await getPortal(slug)).toBeNull();
    await expect(submitPortalTicket(slug, { name: "N", email: "z@example.com", subject: "Q", message: "M" }, { ip: "8.8.8.8" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("portal slugs are unique across workspaces and portal data stays isolated", async () => {
    const a = await portalOrg("SlugA");
    const b = await createOrgWithOwner("SlugB");
    await rejectsWith(savePortal(b.ctx, { enabled: true, slug: a.slug, title: "Mine" }), /taken/);
    await rejectsWith(savePortal(b.ctx, { enabled: true, slug: "admin", title: "Mine" }), /reserved/);
    await submitPortalTicket(a.slug, { name: "N", email: "iso@example.com", subject: "Q", message: "M" }, { ip: "7.7.7.7" });
    const seen = await withTenant(b.ctx, (tx) => tx.select().from(portalAccessTokens));
    expect(seen).toHaveLength(0);
    expect(await withTenant(b.ctx, (tx) => tx.select().from(supportTickets))).toHaveLength(0);
  });
});
