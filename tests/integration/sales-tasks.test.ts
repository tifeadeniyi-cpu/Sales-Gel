import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createCustomer, getCustomerTimeline } from "@/domains/customers/service";
import { mergeCustomers, unmergeCustomers } from "@/domains/customers/duplicates";
import {
  addStage,
  archivePipeline,
  archiveStage,
  closeLead,
  createLead,
  createPipeline,
  getBoard,
  getLead,
  getLeadStats,
  listLeads,
  listPipelines,
  moveLead,
  reorderStages,
  setLeadProducts,
  updateLeadField,
  updateStage,
} from "@/domains/sales/service";
import { leadStageHistory } from "@/domains/sales/schema";
import { addTaskComment, createTask, deleteTask, getTask, getTaskStats, listTasks, setTaskDone, updateTask, _nextDueForTests } from "@/domains/tasks/service";
import { listNotifications } from "@/domains/platform/notifications";
import { isPermissionDenied } from "@/server/db/errors";
import { withTenant } from "@/server/db/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

const stageByName = async (ctx: Parameters<typeof listPipelines>[0], name: string) => (await listPipelines(ctx))[0].stages.find((s) => s.name === name)!;

describe("pipelines & stages", () => {
  it("seeds the default pipeline with the spec's stages", async () => {
    const { ctx } = await createOrgWithOwner("Pipe");
    const [p] = await listPipelines(ctx);
    expect(p).toMatchObject({ name: "Sales", isDefault: true });
    expect(p.stages.map((s) => s.name)).toEqual(["New Inquiry", "Contacted", "Qualified", "Offer Sent", "Negotiating", "Won", "Lost"]);
    expect(p.stages.map((s) => s.category)).toEqual(["open", "open", "open", "open", "open", "won", "lost"]);
  });

  it("adds open stages before won/lost, reorders, edits, archives with lead moves", async () => {
    const { ctx } = await createOrgWithOwner("Stages");
    const [p] = await listPipelines(ctx);
    await addStage(ctx, p.id, { name: "Sample Sent", probability: 50, category: "open" });
    let names = (await listPipelines(ctx))[0].stages.map((s) => s.name);
    expect(names.slice(-3)).toEqual(["Sample Sent", "Won", "Lost"]);
    const stages = (await listPipelines(ctx))[0].stages;
    await reorderStages(ctx, p.id, [stages[1].id, stages[0].id, ...stages.slice(2).map((s) => s.id)]);
    names = (await listPipelines(ctx))[0].stages.map((s) => s.name);
    expect(names.slice(0, 2)).toEqual(["Contacted", "New Inquiry"]);
    await expect(reorderStages(ctx, p.id, [stages[0].id])).rejects.toBeInstanceOf(ValidationError);

    const sample = await stageByName(ctx, "Sample Sent");
    const lead = await createLead(ctx, { title: "Bulk rice order", stageId: sample.id });
    await expect(updateStage(ctx, sample.id, { name: "Sample Sent", probability: 50, category: "won" })).rejects.toBeInstanceOf(ConflictError);
    await expect(archiveStage(ctx, sample.id, null)).rejects.toBeInstanceOf(ValidationError);
    const won = await stageByName(ctx, "Won");
    await expect(archiveStage(ctx, sample.id, won.id)).rejects.toBeInstanceOf(ValidationError); // category must match
    const qualified = await stageByName(ctx, "Qualified");
    await archiveStage(ctx, sample.id, qualified.id);
    expect((await getLead(ctx, lead.id))!.stageId).toBe(qualified.id);
    expect((await getLead(ctx, lead.id))!.history[0]).toMatchObject({ fromName: "Sample Sent", toName: "Qualified" });
  });

  it("multiple pipelines; can't archive one with open leads or the last one", async () => {
    const { ctx } = await createOrgWithOwner("Multi");
    const { id: wholesale } = await createPipeline(ctx, { name: "Wholesale" });
    expect((await listPipelines(ctx)).map((p) => p.name)).toEqual(["Sales", "Wholesale"]);
    const l = await createLead(ctx, { title: "Distributor", pipelineId: wholesale });
    await expect(archivePipeline(ctx, wholesale)).rejects.toBeInstanceOf(ConflictError);
    await closeLead(ctx, l.id, "lost", "Went with another supplier");
    await archivePipeline(ctx, wholesale);
    const [sales] = await listPipelines(ctx);
    await expect(archivePipeline(ctx, sales.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("only pipeline managers configure pipelines", async () => {
    const { ctx } = await createOrgWithOwner("PipePerm");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    await expect(createPipeline(rep, { name: "Mine" })).rejects.toBeInstanceOf(ForbiddenError);
    const [p] = await listPipelines(rep);
    await expect(addStage(rep, p.id, { name: "X", probability: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("leads", () => {
  it("creates leads with money in minor units, customer link, products and notifications", async () => {
    const { ctx } = await createOrgWithOwner("Leads");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const c = await createCustomer(ctx, { firstName: "Ngozi" });
    const l = await createLead(ctx, { title: "Wedding catering", customerId: c.id, value: "2,500.50", ownerMembershipId: rep.membershipId, products: [{ name: "Jollof tray", quantity: 10 }], source: "instagram" });
    const lead = (await getLead(ctx, l.id))!;
    expect(lead).toMatchObject({ valueAmount: 250050, currency: "USD", status: "open", customerName: "Ngozi", ownerMembershipId: rep.membershipId });
    expect(lead.products).toMatchObject([{ name: "Jollof tray", quantity: 10 }]);
    expect((await listNotifications(rep))[0]).toMatchObject({ type: "lead.assigned" });
    expect((await getCustomerTimeline(ctx, c.id)).some((t) => t.action === "customer.lead_created")).toBe(true);
    await expect(createLead(ctx, { title: "Bad", value: "12.345" })).rejects.toMatchObject({ fieldErrors: { value: expect.any(Array) } });
    await expect(createLead(ctx, { title: "x" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("moves between stages with history, required fields, won/lost and reopen", async () => {
    const { ctx } = await createOrgWithOwner("Moves");
    const offer = await stageByName(ctx, "Offer Sent");
    await updateStage(ctx, offer.id, { name: "Offer Sent", probability: 60, category: "open", requiredFields: ["valueAmount", "customerId"] });
    const l = await createLead(ctx, { title: "Office lunch" });
    await expect(moveLead(ctx, l.id, { stageId: offer.id })).rejects.toMatchObject({ message: expect.stringContaining("Estimated value"), fieldErrors: { value: expect.any(Array), customerId: expect.any(Array) } });
    const c = await createCustomer(ctx, { companyName: "Acme Ltd", type: "business" });
    await updateLeadField(ctx, l.id, "value", "800");
    await updateLeadField(ctx, l.id, "customerId", c.id);
    await moveLead(ctx, l.id, { stageId: offer.id });
    // Clearing a field the current stage requires is refused.
    await expect(updateLeadField(ctx, l.id, "value", "")).rejects.toBeInstanceOf(ValidationError);

    await expect(closeLead(ctx, l.id, "lost")).rejects.toMatchObject({ fieldErrors: { reason: expect.any(Array) } });
    await closeLead(ctx, l.id, "lost", "Budget cut");
    let lead = (await getLead(ctx, l.id))!;
    expect(lead).toMatchObject({ status: "lost", lostReason: "Budget cut" });
    expect(lead.closedAt).toBeInstanceOf(Date);

    await moveLead(ctx, l.id, { stageId: offer.id });
    lead = (await getLead(ctx, l.id))!;
    expect(lead).toMatchObject({ status: "open", lostReason: null, closedAt: null });
    await closeLead(ctx, l.id, "won");
    lead = (await getLead(ctx, l.id))!;
    expect(lead.status).toBe("won");
    expect(lead.history.map((h) => h.toName)).toEqual(["Won", "Offer Sent", "Lost", "Offer Sent", "New Inquiry"]);
    // History is append-only.
    await expect(withTenant(ctx, (tx) => tx.delete(leadStageHistory).where(eq(leadStageHistory.leadId, l.id)))).rejects.toSatisfy(isPermissionDenied);
  });

  it("orders cards within a stage via beforeLeadId", async () => {
    const { ctx } = await createOrgWithOwner("Order");
    const a = await createLead(ctx, { title: "A lead" });
    const b = await createLead(ctx, { title: "B lead" });
    const c = await createLead(ctx, { title: "C lead" });
    const first = await stageByName(ctx, "New Inquiry");
    await moveLead(ctx, c.id, { stageId: first.id, beforeLeadId: a.id });
    const board = await getBoard(ctx);
    expect(board.stages[0].leads.map((l) => l.title)).toEqual(["C lead", "A lead", "B lead"]);
    await moveLead(ctx, a.id, { stageId: first.id, beforeLeadId: b.id });
    expect((await getBoard(ctx)).stages[0].leads.map((l) => l.title)).toEqual(["C lead", "A lead", "B lead"]);
  });

  it("board totals are per currency and never mixed; stats report weighted value", async () => {
    const { ctx } = await createOrgWithOwner("Totals");
    await createLead(ctx, { title: "USD one", value: "100" });
    await createLead(ctx, { title: "USD two", value: "50.25" });
    await createLead(ctx, { title: "Naira one", value: "200000", currency: "NGN" });
    const board = await getBoard(ctx);
    expect(board.stages[0].totals).toEqual({ USD: 15025, NGN: 20000000 });
    expect(board.stages[0].weightedTotals).toEqual({ USD: 1503, NGN: 2000000 });
    const stats = (await getLeadStats(ctx))!;
    expect(stats).toMatchObject({ active: 3, pipelineValue: { USD: 15025, NGN: 20000000 } });
  });

  it("assigned-only reps see their own leads; customers they can't see are masked", async () => {
    const { ctx } = await createOrgWithOwner("LeadScope");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const secret = await createCustomer(ctx, { firstName: "VIP Client" });
    const theirs = await createLead(ctx, { title: "Owner's deal", customerId: secret.id });
    const assigned = await createLead(ctx, { title: "Rep's deal", customerId: secret.id, ownerMembershipId: rep.membershipId });
    const mine = await createLead(rep, { title: "Rep created" });
    expect((await getLead(rep, mine.id))!.ownerMembershipId).toBe(rep.membershipId);
    expect((await listLeads(rep)).map((l) => l.title).sort()).toEqual(["Rep created", "Rep's deal"]);
    expect(await getLead(rep, theirs.id)).toBeNull();
    await expect(updateLeadField(rep, theirs.id, "title", "Hijack")).rejects.toBeInstanceOf(NotFoundError);
    // Sales reps have customers.read, so the name is visible; a custom role without it sees a masked name.
    const { createRole, changeMemberRole } = await import("@/domains/identity/service");
    const role = await createRole(ctx, { name: "Leads only", permissions: ["leads.read_assigned", "leads.write"] });
    await changeMemberRole(ctx, { membershipId: rep.membershipId, roleId: role.id });
    const { loadOrgContext } = await import("@/server/authz/context");
    const narrow = (await loadOrgContext(rep.userId, ctx.orgSlug))!;
    expect((await getLead(narrow, assigned.id))!.customerName).toBe("Restricted customer");
    await expect(createLead(narrow, { title: "Sneaky", customerId: secret.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("tenant isolation for leads, stages and customers", async () => {
    const a = await createOrgWithOwner("LeadA");
    const b = await createOrgWithOwner("LeadB");
    const bCust = await createCustomer(b.ctx, { firstName: "B cust" });
    const bLead = await createLead(b.ctx, { title: "B deal" });
    const bStage = (await listPipelines(b.ctx))[0].stages[1];
    expect(await getLead(a.ctx, bLead.id)).toBeNull();
    await expect(moveLead(a.ctx, bLead.id, { stageId: bStage.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createLead(a.ctx, { title: "Cross", customerId: bCust.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createLead(a.ctx, { title: "Cross stage", stageId: bStage.id })).rejects.toBeInstanceOf(ValidationError);
    const aLead = await createLead(a.ctx, { title: "A deal" });
    await expect(moveLead(a.ctx, aLead.id, { stageId: bStage.id })).rejects.toBeInstanceOf(ValidationError);
    expect((await listLeads(a.ctx)).map((l) => l.title)).toEqual(["A deal"]);
  });

  it("interested products can be replaced", async () => {
    const { ctx } = await createOrgWithOwner("Products");
    const l = await createLead(ctx, { title: "Gift boxes" });
    await setLeadProducts(ctx, l.id, [{ name: "Chin chin", quantity: 5 }, { name: "Plantain chips" }]);
    expect((await getLead(ctx, l.id))!.products.map((p) => [p.name, p.quantity])).toEqual([["Chin chin", 5], ["Plantain chips", 1]]);
  });
});

describe("tasks", () => {
  it("creates shared tasks linked to many records, notifies assignee, lists by context", async () => {
    const { ctx } = await createOrgWithOwner("Tasks");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const c = await createCustomer(ctx, { firstName: "Tunde" });
    const l = await createLead(ctx, { title: "Party trays", customerId: c.id });
    const t = await createTask(ctx, { title: "Call Tunde about menu", assigneeMembershipId: rep.membershipId, dueAt: new Date(Date.now() + 3600_000).toISOString(), relations: [{ type: "customer", id: c.id }, { type: "lead", id: l.id }, { type: "lead", id: l.id }] });
    const onCustomer = await listTasks(ctx, { scope: "all", entityType: "customer", entityId: c.id });
    const onLead = await listTasks(ctx, { scope: "all", entityType: "lead", entityId: l.id });
    expect(onCustomer.map((x) => x.id)).toEqual([t.id]);
    expect(onLead.map((x) => x.id)).toEqual([t.id]); // same task, not a copy
    expect(onLead[0].relations.map((r) => r.label).sort()).toEqual(["Party trays", "Tunde"]);
    expect((await listTasks(rep)).map((x) => x.id)).toEqual([t.id]);
    expect((await listNotifications(rep))[0]).toMatchObject({ type: "task.assigned" });
    expect((await getCustomerTimeline(ctx, c.id)).some((e) => e.action === "customer.task_created")).toBe(true);
    // default assignee is the creator
    const mine = await createTask(rep, { title: "Prep quote" });
    expect((await getTask(rep, mine.id))!.assigneeMembershipId).toBe(rep.membershipId);
  });

  it("completing a recurring task creates exactly one next occurrence; reopening works", async () => {
    const { ctx } = await createOrgWithOwner("Recur");
    const due = new Date("2026-01-31T15:00:00Z");
    const t = await createTask(ctx, { title: "Monthly stock check", dueAt: due.toISOString(), recurrence: "monthly" });
    const r1 = await setTaskDone(ctx, t.id, true);
    expect(r1.nextId).toBeTruthy();
    const next = (await getTask(ctx, r1.nextId!))!;
    expect(next.dueAt!.toISOString()).toBe("2026-02-28T15:00:00.000Z");
    await setTaskDone(ctx, t.id, false);
    const r2 = await setTaskDone(ctx, t.id, true);
    expect(r2.nextId).toBeNull(); // no duplicate occurrence
    expect((await listTasks(ctx, { status: "all" })).filter((x) => x.title === "Monthly stock check")).toHaveLength(2);
    expect(_nextDueForTests(new Date("2026-03-10T09:00:00Z"), "weekly").toISOString()).toBe("2026-03-17T09:00:00.000Z");
  });

  it("due filters respect the org timezone; overdue and stats", async () => {
    const { ctx } = await createOrgWithOwner("Due");
    await createTask(ctx, { title: "Overdue one", dueAt: new Date(Date.now() - 86_400_000).toISOString() });
    await createTask(ctx, { title: "Later", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await createTask(ctx, { title: "Someday" });
    expect((await listTasks(ctx, { due: "overdue" })).map((t) => t.title)).toEqual(["Overdue one"]);
    expect((await listTasks(ctx, { due: "week" })).map((t) => t.title)).toEqual(["Later"]);
    expect((await listTasks(ctx, { due: "none" })).map((t) => t.title)).toEqual(["Someday"]);
    expect(await getTaskStats(ctx)).toMatchObject({ overdue: 1, open: 3 });
    const windowed = await listTasks(ctx, { status: "all", from: new Date(Date.now() - 2 * 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(windowed.map((t) => t.title)).toEqual(["Overdue one"]);
  });

  it("comments notify mentions and assignee; edits and deletes are guarded", async () => {
    const { ctx } = await createOrgWithOwner("Comments");
    const { ctx: rep } = await addMember(ctx, "sales_rep");
    const { ctx: mgr } = await addMember(ctx, "sales_manager");
    const t = await createTask(ctx, { title: "Confirm delivery", assigneeMembershipId: rep.membershipId });
    await addTaskComment(ctx, t.id, { body: "Can you check with logistics?", mentionMembershipIds: [mgr.membershipId] });
    expect((await listNotifications(mgr))[0]).toMatchObject({ type: "mention" });
    expect((await listNotifications(rep)).some((n) => n.title.includes("New comment"))).toBe(true);
    const detail = (await getTask(ctx, t.id))!;
    expect(detail.comments).toHaveLength(1);
    await updateTask(ctx, t.id, { priority: "urgent", status: "in_progress" });
    expect((await getTask(ctx, t.id))!).toMatchObject({ priority: "urgent", status: "in_progress" });
    await expect(deleteTask(mgr, t.id)).rejects.toBeInstanceOf(ForbiddenError);
    await deleteTask(rep, t.id);
    expect(await getTask(ctx, t.id)).toBeNull();
  });

  it("tasks can't link records from other orgs or records the user can't see", async () => {
    const a = await createOrgWithOwner("TaskA");
    const b = await createOrgWithOwner("TaskB");
    const bc = await createCustomer(b.ctx, { firstName: "Other" });
    await expect(createTask(a.ctx, { title: "Leak", relations: [{ type: "customer", id: bc.id }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTask(a.ctx, { title: "Bad assignee", assigneeMembershipId: b.ctx.membershipId })).rejects.toBeInstanceOf(ValidationError);
    const bt = await createTask(b.ctx, { title: "B task" });
    expect(await getTask(a.ctx, bt.id)).toBeNull();
    await expect(setTaskDone(a.ctx, bt.id, true)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("customer merge carries leads and tasks", () => {
  it("moves leads and task links to the survivor and back on unmerge", async () => {
    const { ctx } = await createOrgWithOwner("MergeSales");
    const a = await createCustomer(ctx, { firstName: "Keep" });
    const b = await createCustomer(ctx, { firstName: "Merge me" });
    const l = await createLead(ctx, { title: "Deal on B", customerId: b.id });
    const t = await createTask(ctx, { title: "Follow up B", relations: [{ type: "customer", id: b.id }] });
    const both = await createTask(ctx, { title: "Both", relations: [{ type: "customer", id: a.id }, { type: "customer", id: b.id }] });
    const { mergeId } = await mergeCustomers(ctx, a.id, b.id);
    expect((await getLead(ctx, l.id))!.customerId).toBe(a.id);
    expect((await listTasks(ctx, { scope: "all", entityType: "customer", entityId: a.id })).map((x) => x.id).sort()).toEqual([t.id, both.id].sort());
    await unmergeCustomers(ctx, mergeId);
    expect((await getLead(ctx, l.id))!.customerId).toBe(b.id);
    expect((await listTasks(ctx, { scope: "all", entityType: "customer", entityId: b.id })).map((x) => x.id).sort()).toEqual([t.id, both.id].sort());
  });
});
