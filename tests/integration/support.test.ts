import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createCustomer, getCustomerTimeline } from "@/domains/customers/service";
import { mergeCustomers, unmergeCustomers } from "@/domains/customers/duplicates";
import { createOrder } from "@/domains/commerce/orders";
import {
  addTicketMessage,
  archiveTicketStatus,
  assignTicket,
  changeTicketStatus,
  countOpenTickets,
  createTicket,
  createTicketStatus,
  getSupportStats,
  getTicket,
  getTicketAttachment,
  getTicketTimeline,
  linkTicketRecord,
  listTicketConfig,
  listTickets,
  unlinkTicketRecord,
  updateTicket,
} from "@/domains/support/service";
import { supportTickets, ticketMessages } from "@/domains/support/schema";
import { listNotifications } from "@/domains/platform/notifications";
import { isPermissionDenied } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>["ctx"];

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function setup(name = "Helpdesk") {
  const { ctx } = await createOrgWithOwner(name);
  const customer = await createCustomer(ctx, { firstName: "Bisi", lastName: "Ola", emails: [{ email: "bisi@example.com" }] });
  const config = await listTicketConfig(ctx);
  const status = (cat: string) => config.statuses.find((s) => s.category === cat)!;
  return { ctx, customer, config, status };
}

async function raw(ctx: Ctx, id: string) {
  return withTenant(ctx, async (tx) => (await tx.select().from(supportTickets).where(eq(supportTickets.id, id)))[0]);
}

describe("ticket configuration", () => {
  it("seeds default statuses and types once", async () => {
    const { ctx, config } = await setup();
    expect(config.statuses.map((s) => s.category)).toEqual(["new", "open", "pending_customer", "pending_internal", "escalated", "resolved", "closed"]);
    expect(config.statuses.filter((s) => s.isDefault)).toHaveLength(1);
    expect(config.types.map((t) => t.name)).toContain("Order issue");
    expect((await listTicketConfig(ctx)).statuses).toHaveLength(7);
  });

  it("custom statuses: create, no duplicates, can't archive in-use or last of a category", async () => {
    const { ctx, status } = await setup();
    const { id } = await createTicketStatus(ctx, { name: "Awaiting supplier", category: "pending_internal", color: "#123456" });
    await expect(createTicketStatus(ctx, { name: "awaiting SUPPLIER", category: "open" })).rejects.toBeInstanceOf(ValidationError);
    await expect(archiveTicketStatus(ctx, status("closed").id)).rejects.toBeInstanceOf(ConflictError);
    const t = await createTicket(ctx, { subject: "Supplier delay" });
    await changeTicketStatus(ctx, t.id, { statusId: id });
    await expect(archiveTicketStatus(ctx, id)).rejects.toThrow(/uses this status/);
    const agent = (await addMember(ctx, "support_agent")).ctx;
    await expect(createTicketStatus(agent, { name: "Nope", category: "open" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tickets", () => {
  it("creates with number, default status, contact from customer, timeline entry on the customer", async () => {
    const { ctx, customer } = await setup();
    const t = await createTicket(ctx, { subject: "Where is my order?", description: "Ordered last week, nothing yet.", customerId: customer.id, channel: "whatsapp", priority: "high" });
    expect(t.number).toBe(1001);
    const d = (await getTicket(ctx, t.id))!;
    expect(d).toMatchObject({ statusCategory: "new", priority: "high", channel: "whatsapp", contactEmail: "bisi@example.com", customerName: "Bisi Ola" });
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]).toMatchObject({ kind: "customer", body: "Ordered last week, nothing yet." });
    expect((await getCustomerTimeline(ctx, customer.id)).some((e) => e.action === "customer.ticket_created")).toBe(true);
    await expect(createTicket(ctx, { subject: "  " })).rejects.toBeInstanceOf(ValidationError);
  });

  it("linking an order sets the customer and shows the ticket on the order", async () => {
    const { ctx, customer } = await setup();
    const o = await createOrder(ctx, { customerId: customer.id, lines: [{ name: "Palm oil", unitPrice: "12", quantity: 1 }] });
    const t = await createTicket(ctx, { subject: "Leaking bottle", orderId: o.id });
    const d = (await getTicket(ctx, t.id))!;
    expect(d.customerId).toBe(customer.id);
    expect(d.links).toEqual([expect.objectContaining({ type: "order", recordId: o.id, label: `ORD-${o.number}` })]);
    expect((await listTickets(ctx, { view: "all", order: o.id })).rows.map((r) => r.id)).toEqual([t.id]);
    await linkTicketRecord(ctx, t.id, { orderId: o.id }); // idempotent
    expect((await getTicket(ctx, t.id))!.links).toHaveLength(1);
    await unlinkTicketRecord(ctx, t.id, d.links[0].id);
    expect((await getTicket(ctx, t.id))!.links).toHaveLength(0);
  });

  it("conversation drives status: reply → waiting on customer, customer reply → open; first response recorded", async () => {
    const { ctx, customer } = await setup();
    const t = await createTicket(ctx, { subject: "Wrong size", customerId: customer.id });
    await addTicketMessage(ctx, t.id, { kind: "note", body: "Check stock first" });
    expect((await raw(ctx, t.id)).statusCategory).toBe("new");
    await addTicketMessage(ctx, t.id, { kind: "reply", body: "We can swap it — which size?" });
    let r = await raw(ctx, t.id);
    expect(r.statusCategory).toBe("pending_customer");
    expect(r.firstRespondedAt).toBeTruthy();
    await addTicketMessage(ctx, t.id, { kind: "customer", body: "Large please", channel: "phone" });
    r = await raw(ctx, t.id);
    expect(r.statusCategory).toBe("open");
    const d = (await getTicket(ctx, t.id))!;
    expect(d.messages.map((m) => [m.kind, m.deliveryStatus])).toEqual([["note", "not_sent"], ["reply", "not_sent"], ["customer", "received"]]);
    expect((await getTicketTimeline(ctx, t.id)).map((e) => e.action)).toEqual(expect.arrayContaining(["ticket.created", "ticket.replied", "ticket.customer_message", "ticket.status_changed"]));
  });

  it("resolve needs a resolution; reopening counts; closed tickets refuse replies", async () => {
    const { ctx, status } = await setup();
    const t = await createTicket(ctx, { subject: "Refund question" });
    await expect(changeTicketStatus(ctx, t.id, { statusId: status("resolved").id })).rejects.toBeInstanceOf(ValidationError);
    await changeTicketStatus(ctx, t.id, { statusId: status("resolved").id, resolutionCategory: "answered", resolutionNote: "Explained policy" });
    let r = await raw(ctx, t.id);
    expect(r).toMatchObject({ statusCategory: "resolved", resolutionCategory: "answered" });
    expect(r.resolvedAt).toBeTruthy();
    await addTicketMessage(ctx, t.id, { kind: "customer", body: "Still confused" });
    r = await raw(ctx, t.id);
    expect(r).toMatchObject({ statusCategory: "open", reopenedCount: 1, resolvedAt: null, resolutionCategory: null });
    await changeTicketStatus(ctx, t.id, { statusId: status("closed").id });
    await expect(addTicketMessage(ctx, t.id, { kind: "reply", body: "hi" })).rejects.toBeInstanceOf(ConflictError);
    await addTicketMessage(ctx, t.id, { kind: "note", body: "internal notes still allowed" });
  });

  it("messages are append-only at the database level", async () => {
    const { ctx } = await setup();
    const t = await createTicket(ctx, { subject: "x ticket", description: "original" });
    const err1 = await withTenant(ctx, (tx) => tx.update(ticketMessages).set({ body: "edited" }).where(eq(ticketMessages.ticketId, t.id))).then(() => null, (e) => e);
    const err2 = await withTenant(ctx, (tx) => tx.delete(ticketMessages).where(eq(ticketMessages.ticketId, t.id))).then(() => null, (e) => e);
    expect(isPermissionDenied(err1)).toBe(true);
    expect(isPermissionDenied(err2)).toBe(true);
  });

  it("attachments: stored, type-checked, size-checked, served only to people who can see the ticket", async () => {
    const { ctx } = await setup();
    const t = await createTicket(ctx, { subject: "Damaged parcel" });
    await addTicketMessage(ctx, t.id, { kind: "customer", body: "photo attached" }, [{ filename: "box.png", mimeType: "image/png", data: PNG }]);
    const d = (await getTicket(ctx, t.id))!;
    const att = d.messages[0].attachments[0];
    expect(att).toMatchObject({ filename: "box.png", mimeType: "image/png", size: PNG.length });
    const file = await getTicketAttachment(ctx, att.id);
    expect(Buffer.from(file!.content!).equals(PNG)).toBe(true);
    await expect(addTicketMessage(ctx, t.id, { kind: "note", body: "x" }, [{ filename: "fake.png", mimeType: "image/png", data: Buffer.from("not an image") }])).rejects.toThrow(/doesn't match/);
    await expect(addTicketMessage(ctx, t.id, { kind: "note", body: "x" }, [{ filename: "run.exe", mimeType: "application/x-msdownload", data: Buffer.from("MZ") }])).rejects.toThrow(/supported file type/);
    await expect(addTicketMessage(ctx, t.id, { kind: "note", body: "x" }, [{ filename: "big.txt", mimeType: "text/plain", data: Buffer.alloc(4 * 1024 * 1024 + 1, 1) }])).rejects.toThrow(/4 MB/);
    const other = await setup("OtherDesk");
    expect(await getTicketAttachment(other.ctx, att.id)).toBeNull();
    const { ctx: agent } = await addMember(ctx, "support_agent");
    expect(await getTicketAttachment(agent, att.id)).toBeNull(); // not assigned to the agent
  });

  it("views, search and filters", async () => {
    const { ctx, customer, status } = await setup();
    const { ctx: agent } = await addMember(ctx, "support_agent");
    const membershipId = agent.membershipId;
    const a = await createTicket(ctx, { subject: "Late delivery", customerId: customer.id, priority: "urgent" });
    const b = await createTicket(ctx, { subject: "Coupon not working", assigneeMembershipId: membershipId });
    const c = await createTicket(ctx, { subject: "Thanks!" });
    await changeTicketStatus(ctx, c.id, { statusId: status("resolved").id, resolutionCategory: "no_action_needed" });
    const ids = async (f: Parameters<typeof listTickets>[1]) => (await listTickets(ctx, f)).rows.map((r) => r.id).sort();
    expect(await ids({ view: "open" })).toEqual([a.id, b.id].sort());
    expect(await ids({ view: "unassigned" })).toEqual([a.id]);
    expect(await ids({ view: "resolved" })).toEqual([c.id]);
    expect(await ids({ view: "all", q: "coupon" })).toEqual([b.id]);
    expect(await ids({ view: "all", q: "bisi" })).toEqual([a.id]);
    expect(await ids({ view: "all", q: `TCK-${c.number}` })).toEqual([c.id]);
    expect(await ids({ view: "all", priority: "urgent" })).toEqual([a.id]);
    expect((await listTickets(ctx, { view: "open", sort: "priority" })).rows[0].id).toBe(a.id);
    expect((await listTickets(agent, { view: "mine" })).rows.map((r) => r.id)).toEqual([b.id]);
  });
});

describe("permissions, assignment, notifications", () => {
  it("agents see only assigned tickets; tickets they create are assigned to them; they can't reassign", async () => {
    const { ctx } = await setup();
    const { ctx: agent } = await addMember(ctx, "support_agent");
    const membershipId = agent.membershipId;
    const mine = await createTicket(ctx, { subject: "For agent" });
    const notMine = await createTicket(ctx, { subject: "Not for agent" });
    await assignTicket(ctx, mine.id, membershipId);
    expect((await listTickets(agent, { view: "all" })).rows.map((r) => r.subject)).toEqual(["For agent"]);
    expect(await getTicket(agent, notMine.id)).toBeNull();
    await expect(addTicketMessage(agent, notMine.id, { kind: "reply", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignTicket(agent, mine.id, null)).rejects.toBeInstanceOf(ForbiddenError);
    const own = await createTicket(agent, { subject: "Agent created", assigneeMembershipId: null });
    expect((await raw(ctx, own.id)).assigneeMembershipId).toBe(membershipId);
    expect(await countOpenTickets(agent)).toBe(2);
    expect(await countOpenTickets(ctx)).toBe(3);
    const notes = await listNotifications(agent);
    expect(notes.some((n) => n.type === "ticket.assigned")).toBe(true);
  });

  it("sales reps without ticket permissions are refused", async () => {
    const { ctx } = await setup();
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    await expect(listTickets(rep)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTicket(rep, { subject: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getSupportStats(rep)).toBeNull();
  });

  it("assignment to inactive or foreign members is refused", async () => {
    const a = await setup("DeskA");
    const b = await setup("DeskB");
    const t = await createTicket(a.ctx, { subject: "x ticket" });
    await expect(assignTicket(a.ctx, t.id, b.ctx.membershipId)).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTicket(a.ctx, t.id, { customerId: b.customer.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("stats, merge, isolation", () => {
  it("support stats reflect workload and period numbers", async () => {
    const { ctx, status } = await setup();
    const a = await createTicket(ctx, { subject: "A", priority: "urgent", description: "help" });
    await createTicket(ctx, { subject: "B" });
    const c = await createTicket(ctx, { subject: "C" });
    await addTicketMessage(ctx, a.id, { kind: "reply", body: "on it" });
    await changeTicketStatus(ctx, c.id, { statusId: status("resolved").id, resolutionCategory: "answered" });
    const s = (await getSupportStats(ctx))!;
    expect(s).toMatchObject({ open: 2, unassigned: 2, urgent: 1, resolved: 1, created: 3 });
    expect(s.medianFirstResponseMin).not.toBeNull();
    expect(s.priorityTickets[0].subject).toBe("A");
  });

  it("customer merge moves tickets and undo restores them", async () => {
    const { ctx, customer } = await setup();
    const dup = await createCustomer(ctx, { firstName: "Bisi", lastName: "O." });
    const t = await createTicket(ctx, { subject: "Dup ticket", customerId: dup.id });
    const m = await mergeCustomers(ctx, customer.id, dup.id);
    expect((await raw(ctx, t.id)).customerId).toBe(customer.id);
    await unmergeCustomers(ctx, m.mergeId);
    expect((await raw(ctx, t.id)).customerId).toBe(dup.id);
  });

  it("tenants can't read, reply to or link across orgs", async () => {
    const a = await setup("IsoA");
    const b = await setup("IsoB");
    const t = await createTicket(a.ctx, { subject: "Private" });
    const o = await createOrder(a.ctx, { lines: [{ name: "x", unitPrice: "1", quantity: 1 }] });
    expect(await getTicket(b.ctx, t.id)).toBeNull();
    await expect(addTicketMessage(b.ctx, t.id, { kind: "reply", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createTicket(b.ctx, { subject: "steal", orderId: o.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(b.ctx, { subject: "steal", customerId: a.customer.id })).rejects.toBeInstanceOf(ValidationError);
    expect((await listTickets(b.ctx, { view: "all" })).total).toBe(0);
  });
});
