import { describe, expect, it } from "vitest";
import { createCustomer } from "@/domains/customers/service";
import { createOrder, issueRefund, listOrders, recordPayment } from "@/domains/commerce/orders";
import { createLead, listLeads, moveLead, listPipelines } from "@/domains/sales/service";
import { createTicket, assignTicket } from "@/domains/support/service";
import { getActivityFeed, getDashboardCards, getPipelineSummary, getSalesSeries } from "@/domains/reporting/dashboard";
import { getDashboardLayout, resetDashboardLayout, saveDashboardLayout } from "@/domains/reporting/layout";
import { pctChange, resolvePeriod } from "@/domains/reporting/period";
import { DEFAULT_LAYOUT } from "@/domains/reporting/widgets";
import { ForbiddenError } from "@/server/errors";
import { addMember, createOrgWithOwner } from "../support/factories";

describe("periods", () => {
  it("resolves ranges at local midnight in the org timezone", () => {
    const now = new Date("2026-11-12T22:30:00Z"); // 16:30 in Chicago
    const p = resolvePeriod({ range: "today" }, "America/Chicago", now);
    expect(p.from.toISOString()).toBe("2026-11-12T06:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-11-13T06:00:00.000Z");
    expect(p.grouping).toBe("hour");
    const m = resolvePeriod({ range: "this_month" }, "America/Chicago", now);
    expect(m.from.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // CDT before Nov 1 2am → midnight is 05:00Z
    expect(m.prev!.from.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    const lm = resolvePeriod({ range: "last_month", compare: "last_year" }, "UTC", now);
    expect([lm.from.toISOString(), lm.to.toISOString(), lm.prev!.from.toISOString()]).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "2025-10-01T00:00:00.000Z"]);
    const c = resolvePeriod({ range: "custom", from: "2026-01-01", to: "2026-03-31", compare: "none" }, "UTC", now);
    expect(c.prev).toBeNull();
    expect(c.grouping).toBe("week");
    expect(resolvePeriod({ range: "custom", from: "bad", to: "x" }, "UTC", now).range).toBe("custom");
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("dashboard metrics", () => {
  it("cards reconcile with the underlying lists and keep currencies separate", async () => {
    const { ctx } = await createOrgWithOwner("DashCo");
    const period = resolvePeriod({ range: "7d" }, ctx.timezone);
    const cust = await createCustomer(ctx, { firstName: "Ngozi" });
    const a = await createOrder(ctx, { customerId: cust.id, lines: [{ name: "Rice", unitPrice: "100", quantity: 1 }] });
    const b = await createOrder(ctx, { currency: "EUR", lines: [{ name: "Beans", unitPrice: "40", quantity: 1 }] });
    await recordPayment(ctx, a.id, { amount: "100", method: "cash" });
    await issueRefund(ctx, a.id, { amount: "30", reason: "Partial return", method: "cash" });
    await recordPayment(ctx, b.id, { amount: "40", method: "card" });
    await createLead(ctx, { title: "Wholesale", value: "500" });
    await createLead(ctx, { title: "Retail", value: "50" });
    await createTicket(ctx, { subject: "Late", priority: "urgent" });

    const cards = await getDashboardCards(ctx, { period });
    expect(cards.revenue).toMatchObject({ currency: "USD", value: 7000, byCurrency: { USD: 7000, EUR: 4000 } });
    expect(cards.revenue!.currencies).toEqual(["EUR", "USD"]);
    const eur = await getDashboardCards(ctx, { period, currency: "EUR" });
    expect(eur.revenue!.value).toBe(4000);
    expect(cards.newLeads!.value).toBe(2);
    expect(cards.openDeals).toMatchObject({ count: 2, byCurrency: { USD: 55000 } });
    expect(cards.orders!.value).toBe(2);
    expect(cards.openTickets).toMatchObject({ value: 1, urgent: 1, unassigned: 1 });
    expect(cards.conversations.connected).toBe(false);

    // Drill-downs return exactly what the cards count.
    const from = period.from.toISOString();
    const to = period.to.toISOString();
    expect((await listOrders(ctx, { from, to })).total).toBe(cards.orders!.value);
    expect((await listLeads(ctx, { status: "all", from, to })).length).toBe(cards.newLeads!.value);
    expect((await listOrders(ctx, { moneyFrom: from, moneyTo: to })).total).toBe(2);

    const series = (await getSalesSeries(ctx, { period, metric: "revenue" }))!;
    expect(series.current).toHaveLength(7);
    expect(series.total).toBe(7000);
    expect((await getSalesSeries(ctx, { period, metric: "orders" }))!.total).toBe(2);

    const pipe = (await getPipelineSummary(ctx, { period }))!;
    expect(pipe.stages.some((s) => s.category === "lost")).toBe(false);
    expect(pipe.stages.reduce((n, s) => n + s.count, 0)).toBe(2);
  });

  it("member filter scopes every metric; won deals in the period appear in the Won stage", async () => {
    const { ctx } = await createOrgWithOwner("TeamCo");
    const rep = (await addMember(ctx, "sales_rep")).ctx;
    const period = resolvePeriod({ range: "today" }, ctx.timezone);
    await createLead(ctx, { title: "Owner lead" });
    const repLead = await createLead(rep, { title: "Rep lead", value: "10" });
    const won = (await listPipelines(ctx))[0].stages.find((s) => s.category === "won")!;
    await moveLead(ctx, repLead.id, { stageId: won.id });
    const scoped = await getDashboardCards(ctx, { period, memberId: rep.membershipId });
    expect(scoped.newLeads!.value).toBe(1);
    expect(scoped.openDeals!.count).toBe(0);
    const pipe = (await getPipelineSummary(ctx, { period, memberId: rep.membershipId }))!;
    expect(pipe.stages.find((s) => s.id === won.id)!.count).toBe(1);
    // Reps see only their own work and can't filter by someone else.
    expect((await getDashboardCards(rep, { period })).newLeads!.value).toBe(1);
    await expect(getDashboardCards(rep, { period, memberId: ctx.membershipId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("permission boundaries: no revenue without financials; restricted records never reach counts or the feed", async () => {
    const { ctx } = await createOrgWithOwner("PermCo");
    const agent = (await addMember(ctx, "support_agent")).ctx;
    const rep = (await addMember(ctx, "sales_rep")).ctx;
    const period = resolvePeriod({ range: "today" }, ctx.timezone);
    const o = await createOrder(ctx, { lines: [{ name: "x", unitPrice: "10", quantity: 1 }] });
    await recordPayment(ctx, o.id, { amount: "10", method: "cash" });
    const t1 = await createTicket(ctx, { subject: "For agent" });
    await createTicket(ctx, { subject: "Not for agent" });
    await assignTicket(ctx, t1.id, agent.membershipId);
    await createLead(ctx, { title: "Owner-only lead" });

    const agentCards = await getDashboardCards(agent, { period });
    expect(agentCards.revenue).toBeNull();
    expect(agentCards.newLeads).toBeNull();
    expect(agentCards.openTickets!.value).toBe(1);
    expect(await getSalesSeries(agent, { period, metric: "revenue" })).toBeNull();
    const agentFeed = await getActivityFeed(agent, { limit: 50 });
    expect(agentFeed.some((e) => e.action === "payment.recorded")).toBe(false);
    const agentTickets = agentFeed.filter((e) => e.entityType === "ticket");
    expect(agentTickets.length).toBeGreaterThan(0);
    expect(agentTickets.every((e) => e.label?.includes("For agent"))).toBe(true);
    expect(agentFeed.some((e) => e.label?.includes("Not for agent"))).toBe(false);
    expect(agentFeed.some((e) => e.entityType === "lead")).toBe(false);

    const repFeed = await getActivityFeed(rep, { limit: 50 });
    expect(repFeed.some((e) => e.label?.includes("Owner-only lead"))).toBe(false);
    expect(repFeed.some((e) => e.entityType === "ticket")).toBe(false);
    expect((await getDashboardCards(rep, { period })).newLeads!.value).toBe(0);

    const ownerFeed = await getActivityFeed(ctx, { limit: 50 });
    expect(ownerFeed.map((e) => e.action)).toEqual(expect.arrayContaining(["payment.recorded", "order.created", "ticket.created", "lead.created"]));
  });
});

describe("payment dates", () => {
  it("a date-only payment date counts on that local day, not the UTC day", async () => {
    const owner = await createOrgWithOwner("DateCo");
    // UTC−11: midnight UTC of a local date falls on the previous local day.
    const ctx = { ...owner.ctx, timezone: "Pacific/Pago_Pago" };
    const o = await createOrder(ctx, { lines: [{ name: "x", unitPrice: "10", quantity: 1 }] });
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await recordPayment(ctx, o.id, { amount: "10", method: "cash", receivedAt: d });
    const today = await getDashboardCards(ctx, { period: resolvePeriod({ range: "today" }, ctx.timezone) });
    expect(today.revenue!.value).toBe(1000);
    const yesterday = await getDashboardCards(ctx, { period: resolvePeriod({ range: "yesterday" }, ctx.timezone) });
    expect(yesterday.revenue!.value).toBe(0);
  });
});

describe("dashboard layouts", () => {
  it("personal layouts are private; admins set the workspace default; reset falls back to it", async () => {
    const { ctx } = await createOrgWithOwner("LayoutCo");
    const rep = (await addMember(ctx, "sales_rep")).ctx;
    expect((await getDashboardLayout(rep)).source).toBe("default");
    const mine = DEFAULT_LAYOUT.map((w) => (w.key === "inbox" ? { ...w, visible: false } : w)).reverse();
    await saveDashboardLayout(rep, mine, "personal");
    const repLayout = await getDashboardLayout(rep);
    expect(repLayout.source).toBe("personal");
    expect(repLayout.widgets[0].key).toBe("activity");
    expect(repLayout.widgets.find((w) => w.key === "inbox")!.visible).toBe(false);
    expect((await getDashboardLayout(ctx)).source).toBe("default"); // owner unaffected

    await expect(saveDashboardLayout(rep, DEFAULT_LAYOUT, "workspace")).rejects.toBeInstanceOf(ForbiddenError);
    await saveDashboardLayout(ctx, DEFAULT_LAYOUT.map((w) => (w.key === "sales" ? { ...w, width: "full" as const } : w)), "workspace");
    expect((await getDashboardLayout(ctx)).source).toBe("workspace");
    expect((await getDashboardLayout(rep)).source).toBe("personal");
    await resetDashboardLayout(rep);
    const after = await getDashboardLayout(rep);
    expect(after.source).toBe("workspace");
    expect(after.widgets.find((w) => w.key === "sales")!.width).toBe("full");
    await expect(saveDashboardLayout(rep, [{ key: "bogus", visible: true, width: "half" }] as never, "personal")).rejects.toThrow();
  });
});
