import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `c${Date.now().toString(36)}`;
const owner = makeUser("cowner", run);
let slug = "";
let orderUrl = "";

test.describe.configure({ mode: "serial" });

test("catalog: create a product with two variants", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Ada Fabrics ${run}`);
  await page.goto(`/o/${slug}/products`);
  await expect(page.getByText("No products yet")).toBeVisible();
  await page.getByRole("link", { name: "New product" }).first().click();
  await page.getByLabel("Product name").fill("Ankara Wrap Dress");
  await page.getByLabel("Category").fill("Dresses");
  await page.getByLabel("Variant 1 name").fill("Small");
  await page.getByLabel("Variant 1 SKU").fill(`ANK-S-${run}`);
  await page.getByLabel("Variant 1 price").fill("45.00");
  await page.getByLabel("Variant 1 stock").fill("5");
  await page.getByRole("button", { name: "Add variant" }).click();
  await page.getByLabel("Variant 2 name").fill("Large");
  await page.getByLabel("Variant 2 price").fill("50");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "Ankara Wrap Dress" })).toBeVisible();
  await expect(page.getByText("$45.00")).toBeVisible();
  await page.goto(`/o/${slug}/products`);
  await expect(page.getByText("$45.00 – $50.00")).toBeVisible();
});

test("Scenario 1: inquiry → customer → lead won → order → payments → fulfillment → completed", async ({ page }) => {
  await signIn(page, owner);
  // Customer from a social inquiry
  await page.goto(`/o/${slug}/customers/new`);
  await page.getByLabel("First name", { exact: true }).fill("Funke");
  await page.getByLabel("Last name", { exact: true }).fill("Adeyemi");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Funke Adeyemi" })).toBeVisible();

  // Lead
  await page.goto(`/o/${slug}/leads`);
  await page.getByRole("button", { name: "New lead" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^Title/ }).fill("Bridal party dresses");
  await dialog.getByRole("combobox", { name: "Customer" }).fill("Funke");
  await dialog.getByRole("option", { name: /Funke Adeyemi/ }).click();
  await dialog.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText(/Lead LEAD-\d+ created/)).toBeVisible();
  await page.getByLabel("Move Bridal party dresses to stage").selectOption({ label: "Move to Won" });
  await expect(page.getByText("Moved to Won")).toBeVisible();

  // Won does not create an order on its own
  await page.getByRole("button", { name: "Open lead Bridal party dresses" }).click();
  await page.getByRole("link", { name: "Open full page" }).click();
  await expect(page.getByText(/Orders are never created automatically/)).toBeVisible();
  await page.getByRole("link", { name: "Create order" }).click();

  // Wizard step 1: customer prefilled from the lead
  await expect(page.getByText(/Linked to lead/)).toBeVisible();
  await expect(page.getByText("Funke Adeyemi").first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: items from catalog + custom
  await page.getByLabel("Search catalog").fill("Ankara");
  await page.getByRole("button", { name: "Add Ankara Wrap Dress Small" }).click();
  await page.getByRole("button", { name: "Add Ankara Wrap Dress Small" }).click(); // qty 2
  await page.getByRole("button", { name: "Add Ankara Wrap Dress Large" }).click();
  await page.getByRole("button", { name: "Custom item" }).click();
  await page.getByLabel("Item 3 name").fill("Head tie");
  await page.getByLabel("Item 3 price").fill("10");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: 150 - 20 = 130; tax 5% = 6.50; shipping 9 → 145.50
  await page.getByLabel("Order discount").fill("20");
  await page.getByLabel("Tax rate (%)").fill("5");
  await page.getByLabel("Shipping").fill("9");
  await expect(page.getByTestId("order-total")).toHaveText("$145.50");
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByText(/Order ORD-\d+ created/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^ORD-\d+$/ })).toBeVisible();
  orderUrl = page.url();
  await expect(page.getByTestId("order-total")).toHaveText("$145.50");
  await expect(page.getByText("Unpaid", { exact: true }).first()).toBeVisible();

  // Partial payment, then the rest
  await page.getByRole("button", { name: "Record payment" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel(/^Amount/).fill("50");
  await d.getByLabel("Reference").fill("TRF-001");
  await d.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.getByText("Partially paid", { exact: true })).toBeVisible();
  await expect(page.getByTestId("balance-due")).toHaveText("$95.50");

  await page.getByRole("button", { name: "Record payment" }).click();
  d = page.getByRole("dialog");
  await expect(d.getByLabel(/^Amount/)).toHaveValue("95.50");
  await d.getByLabel(/^Amount/).fill("100");
  await d.getByRole("button", { name: "Record payment" }).click();
  await expect(d.getByText(/still due/)).toBeVisible(); // overpayment refused
  await d.getByLabel(/^Amount/).fill("95.50");
  await d.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("balance-due")).toHaveText("$0.00");

  // Fulfill everything, then complete
  await page.getByRole("button", { name: "Fulfill items" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Carrier").fill("GIG Logistics");
  await d.getByLabel("Tracking number").fill("GIG123");
  await d.getByRole("button", { name: "Save fulfillment" }).click();
  await expect(page.getByText("Fulfillment saved")).toBeVisible();
  await expect(page.getByText("Fulfilled", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2/2" })).toBeVisible();
  await page.getByRole("button", { name: "Mark completed" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark completed" }).click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();

  // Customer profile shows real metrics and the order
  await page.getByRole("link", { name: "Funke Adeyemi" }).click();
  await expect(page.getByTestId("metric-lifetime-spending")).toHaveText("$145.50");
  await expect(page.getByTestId("metric-total-orders")).toHaveText("1");
  await page.getByRole("link", { name: /^Orders \(1\)/ }).click();
  await expect(page.getByRole("button", { name: /^ORD-\d+$/ })).toBeVisible();
});

test("refund updates status and lifetime value; Command Center shows real numbers", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Issue refund" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel(/^Amount/).fill("35");
  await d.getByLabel("Reason").fill("One dress returned");
  await d.getByRole("button", { name: "Record refund" }).click();
  await expect(page.getByText("Refund recorded")).toBeVisible();
  await expect(page.getByText("Partially refunded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/One dress returned · by/)).toBeVisible();

  await page.goto(`/o/${slug}/orders`);
  await expect(page.getByText("Net revenue (30 days)")).toBeVisible();
  await expect(page.getByText("$110.50").first()).toBeVisible();
  await page.getByRole("link", { name: "Refunded" }).click();
  await expect(page.getByRole("button", { name: /^ORD-\d+$/ })).toBeVisible();
  await page.getByRole("link", { name: "Pending payment" }).click();
  await expect(page.getByText("No orders in this view.")).toBeVisible();

  await page.goto(`/o/${slug}`);
  await expect(page.getByText("Revenue (30 days)")).toBeVisible();
  await expect(page.getByText("$110.50")).toBeVisible();
});

test("a support agent sees orders without money and can't refund", async ({ page, browser }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/team`);
  const agent = makeUser("cagent", run);
  await page.getByRole("button", { name: "Invite member" }).click();
  const inv = page.getByRole("dialog");
  await inv.getByLabel("Email").fill(agent.email);
  await inv.getByLabel("Role").selectOption({ label: "Support Agent" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  const path = new URL(link).pathname;

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(path);
  await p2.getByRole("link", { name: "Create account to join" }).click();
  await p2.getByLabel("Your name").fill(agent.name);
  await p2.getByLabel("Password").fill(agent.password);
  await p2.getByRole("button", { name: "Create account" }).click();
  await expect(p2).toHaveURL(new RegExp(path));
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2.getByText("You're signed in as Support Agent")).toBeVisible();
  await p2.goto(orderUrl);
  await expect(p2.getByRole("heading", { name: /^ORD-\d+$/ })).toBeVisible();
  await expect(p2.getByTestId("order-total")).toHaveCount(0);
  await expect(p2.getByRole("button", { name: "Issue refund" })).toHaveCount(0);
  await expect(p2.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await p2.goto(`/o/${slug}/orders/new`);
  await expect(p2.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  await ctx2.close();
});
