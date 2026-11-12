import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `d${Date.now().toString(36)}`;
const owner = { ...makeUser("downer", run), name: "Alex Rivera" };
const rep = makeUser("drep", run);
let slug = "";

test.describe.configure({ mode: "serial" });

test("seed: orders with payments, deals, a ticket and an overdue follow-up", async ({ page }) => {
  test.setTimeout(120_000);
  slug = await signUpWithOrg(page, owner, `Rivera Goods ${run}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alex");
  await page.goto(`/o/${slug}/customers/new`);
  await page.getByLabel("First name", { exact: true }).fill("Chioma");
  await page.getByLabel("Last name", { exact: true }).fill("Okafor");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Chioma Okafor" })).toBeVisible();
  for (const [item, price, pay] of [["Spice box", "86", "86"], ["Shea butter", "42", "20"]]) {
    await page.goto(`/o/${slug}/orders/new`);
    await page.getByRole("combobox", { name: "Customer" }).fill("Chioma");
    await page.getByRole("option", { name: /Chioma Okafor/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Custom item" }).click();
    await page.getByLabel("Item 1 name").fill(item);
    await page.getByLabel("Item 1 price").fill(price);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create order" }).click();
    await expect(page.getByRole("heading", { name: /^ORD-\d+$/ })).toBeVisible();
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog").getByLabel(/^Amount/).fill(pay);
    await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("Payment recorded")).toBeVisible();
  }
  for (const [t, v] of [["GreenMart bulk order", "5000"], ["Monthly supply", "8500"]]) {
    await page.goto(`/o/${slug}/deals?new=1`);
    const d = page.getByRole("dialog");
    await d.getByRole("textbox", { name: /^Title/ }).fill(t);
    await d.getByLabel("Estimated value").fill(v);
    await d.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText(/Lead LEAD-\d+ created/)).toBeVisible();
  }
  await page.goto(`/o/${slug}/support/tickets?new=1`);
  await page.getByRole("dialog").getByLabel("Subject").fill("Parcel arrived damaged");
  await page.getByRole("dialog").getByLabel("Priority").selectOption("urgent");
  await page.getByRole("dialog").getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByRole("heading", { name: "Parcel arrived damaged" })).toBeVisible();
  await page.goto(`/o/${slug}/tasks?new=1`);
  await page.getByRole("dialog").getByRole("textbox", { name: /^Title/ }).fill("Send proposal to GreenMart");
  await page.getByRole("dialog").getByLabel("Due").fill("2024-01-10T10:00");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
});

test("cards show real numbers and open matching filtered records", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}?range=7d`);
  await expect(page.getByTestId("card-revenue-value")).toHaveText("$106.00");
  await expect(page.getByTestId("card-orders-value")).toHaveText("2");
  await expect(page.getByTestId("card-leads-value")).toHaveText("2");
  await expect(page.getByTestId("card-deals-value")).toHaveText("2");
  await expect(page.getByTestId("card-deals")).toContainText("$13,500.00");
  await expect(page.getByTestId("card-tickets-value")).toHaveText("1");
  await expect(page.getByTestId("card-conversations")).toContainText("No channels connected");
  await expect(page.getByTestId("chart-total")).toHaveText("$106.00");

  await page.getByTestId("card-orders").click();
  await expect(page.getByText("Orders placed in the dashboard period")).toBeVisible();
  await expect(page.getByRole("button", { name: /^ORD-\d+$/ })).toHaveCount(2);
  await page.goBack();
  await page.getByTestId("card-leads").click();
  await expect(page.getByText("Leads created in the dashboard period")).toBeVisible();
  await expect(page.getByRole("button", { name: "GreenMart bulk order" })).toBeVisible();
  await page.goBack();
  await page.getByTestId("card-tickets").click();
  await expect(page.getByRole("button", { name: /Parcel arrived damaged/ })).toBeVisible();
});

test("filters update metrics; chart toggles to orders; pipeline stage opens Deals filtered", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}`);
  await page.getByLabel("Date range").selectOption("yesterday");
  await expect(page).toHaveURL(/range=yesterday/);
  await expect(page.getByTestId("card-orders-value")).toHaveText("0");
  await expect(page.getByTestId("card-revenue-value")).toHaveText("$0.00");
  await page.getByLabel("Date range").selectOption("today");
  await expect(page.getByTestId("card-orders-value")).toHaveText("2");
  await page.getByLabel("Compare with").selectOption("none");
  await expect(page).toHaveURL(/compare=none/);
  await expect(page.getByRole("region", { name: "Sales Performance" })).not.toContainText("vs previous period");

  await page.getByRole("group", { name: "Chart metric" }).getByRole("button", { name: "Orders" }).click();
  await expect(page.getByTestId("chart-total")).toHaveText("2");
  await page.getByRole("button", { name: "Show table" }).click();
  await expect(page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Period" }) })).toBeVisible();

  await page.getByRole("region", { name: "Sales Pipeline" }).getByRole("link").filter({ hasText: /New Inquiry|New/ }).first().click();
  await expect(page).toHaveURL(/\/deals\?stage=/);
  await expect(page.getByText("Showing one stage.")).toBeVisible();
});

test("record popups keep dashboard filters; inline follow-up edits persist", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}?range=7d`);
  const orders = page.getByRole("region", { name: "Recent Orders" });
  await orders.getByRole("button", { name: /^ORD-\d+$/ }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByTestId("order-total")).toBeVisible();
  await expect(page).toHaveURL(/range=7d.*open=order%3A|open=order%3A.*range=7d|range=7d&open=order/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/range=7d/);
  await expect(page).not.toHaveURL(/open=/);

  await page.getByRole("region", { name: "Support Overview" }).getByRole("button", { name: /Parcel arrived damaged/ }).click();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Internal note" })).toBeVisible();
  await page.keyboard.press("Escape");

  const fu = page.getByRole("region", { name: "My Follow-ups" });
  await expect(fu.getByText(/Overdue · 1/)).toBeVisible();
  await fu.getByLabel("Priority for Send proposal to GreenMart").selectOption("urgent");
  await expect(page.getByText("Priority for Send proposal to GreenMart saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "My Follow-ups" }).getByLabel("Priority for Send proposal to GreenMart")).toHaveValue("urgent");
  await page.getByRole("region", { name: "My Follow-ups" }).getByRole("button", { name: "Send proposal to GreenMart", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Send proposal to GreenMart");
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "My Follow-ups" }).getByRole("checkbox", { name: /Send proposal to GreenMart/ }).click();
  await page.getByRole("region", { name: "My Follow-ups" }).getByRole("button", { name: "Completed" }).click();
  await expect(page.getByRole("region", { name: "My Follow-ups" }).getByRole("button", { name: "Send proposal to GreenMart", exact: true })).toBeVisible();
});

test("customize: hide and reorder widgets, persists, resets; personal only", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}`);
  await page.getByRole("button", { name: "Customize dashboard" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("checkbox", { name: "Inbox Preview" }).uncheck();
  await d.getByRole("button", { name: "Move Recent Activity up" }).click();
  await d.getByRole("button", { name: "Save my layout" }).click();
  await expect(page.getByText("Dashboard layout saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Inbox Preview" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recent Activity" })).toBeVisible();

  await page.getByRole("button", { name: "Customize dashboard" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Reset to/ }).click();
  await expect(page.getByText(/Reset to the/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Inbox Preview" })).toBeVisible();
});

test("a sales rep sees only their own work: no revenue, no team filter", async ({ page, browser }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/team`);
  await page.getByRole("button", { name: "Invite member" }).click();
  await page.getByRole("dialog").getByLabel("Email").fill(rep.email);
  await page.getByRole("dialog").getByLabel("Role").selectOption({ label: "Sales Representative" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const path = new URL(await page.getByLabel("Invitation link").inputValue()).pathname;
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(path);
  await p2.getByRole("link", { name: "Create account to join" }).click();
  await p2.getByLabel("Your name").fill(rep.name);
  await p2.getByLabel("Password").fill(rep.password);
  await p2.getByRole("button", { name: "Create account" }).click();
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2).toHaveURL(new RegExp(`/o/${slug}`));
  await p2.goto(`/o/${slug}?range=7d`);
  await expect(p2.getByTestId("card-orders-value")).toHaveText("2");
  await expect(p2.getByTestId("card-revenue")).toHaveCount(0);
  await expect(p2.getByTestId("card-leads-value")).toHaveText("0"); // owner's leads aren't the rep's
  await expect(p2.getByTestId("card-tickets")).toHaveCount(0);
  await expect(p2.getByLabel("Team member")).toHaveCount(0);
  await expect(p2.getByText("GreenMart bulk order")).toHaveCount(0);
  await expect(p2.getByRole("group", { name: "Chart metric" })).toHaveCount(0); // no revenue toggle without financials
  await ctx2.close();
});

test("mobile: navigation drawer and single-column widgets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, owner);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Deals" })).toBeVisible();
  await expect(nav.getByLabel("1 open")).toBeVisible();
  await nav.getByRole("link", { name: "Tickets" }).click();
  await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
  await page.goto(`/o/${slug}`);
  await expect(page.getByTestId("card-leads")).toBeVisible();
  const a = await page.getByTestId("card-revenue").boundingBox();
  const b = await page.getByTestId("card-leads").boundingBox();
  expect(Math.round(a!.x)).toBe(Math.round(b!.x));
});
