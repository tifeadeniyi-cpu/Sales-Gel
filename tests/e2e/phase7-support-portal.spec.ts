import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `p${Date.now().toString(36)}`;
const owner = { ...makeUser("powner", run), name: "Kemi Admin" };
const portalSlug = `kemi-${run}`;
let slug = "";
let ticketUrl = "";

test.describe.configure({ mode: "serial" });

test("configure business hours, an SLA policy, a routing rule, a form and the portal", async ({ page }) => {
  test.setTimeout(120_000);
  slug = await signUpWithOrg(page, owner, `Kemi Foods ${run}`);
  await page.goto(`/o/${slug}/settings/support`);
  await expect(page.getByRole("link", { name: "SLA policies" })).toBeVisible();

  // Business hours: open on Saturday too.
  await page.getByRole("link", { name: "Business hours" }).click();
  await page.getByRole("checkbox", { name: "Saturday" }).check();
  await page.getByRole("button", { name: "Save business hours" }).click();
  await expect(page.getByText(/Business hours saved/)).toBeVisible();
  await page.getByLabel("Holiday date").fill("2026-12-25");
  await page.getByLabel("Holiday name").fill("Christmas");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await expect(page.getByRole("button", { name: "Remove Christmas" })).toBeVisible();

  // SLA policy with the suggested targets, on a 24/7 clock.
  await page.getByRole("link", { name: "SLA policies" }).click();
  await expect(page.getByLabel("Policy name")).toHaveValue("Standard support");
  await page.getByLabel("High first reply target").fill("2h");
  await page.getByRole("radio", { name: /24\/7/ }).check();
  await page.getByRole("button", { name: "Add policy" }).click();
  await expect(page.getByText("Policy added")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Standard support" })).toBeVisible();
  await expect(page.getByRole("row", { name: /High 2h 1d/ })).toBeVisible();

  // Routing: damaged-item requests go to the owner.
  await page.getByRole("link", { name: "Routing" }).click();
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Rule name").fill("Damaged items to Kemi");
  await page.getByLabel(/Mentions any of these words/).fill("damaged, broken");
  await page.getByRole("combobox", { name: /^Assign/ }).selectOption("member");
  await page.getByRole("combobox", { name: /^Person/ }).selectOption({ label: owner.name });
  await page.getByRole("button", { name: "Add rule", exact: true }).last().click();
  await expect(page.getByText("Rule added")).toBeVisible();
  await expect(page.getByText(/When mentions “damaged” or “broken”/)).toBeVisible();

  // A form with a dropdown question, published.
  await page.getByRole("link", { name: "Forms" }).click();
  await page.getByRole("button", { name: "Add form" }).click();
  await page.getByLabel("Form name").fill("Problem with an order");
  await page.getByLabel("…and priority").selectOption("high");
  await page.getByRole("button", { name: "+ Add question" }).click();
  await page.getByRole("textbox", { name: "Question 1" }).fill("What went wrong?");
  await page.getByLabel("Answer type").selectOption("select");
  await page.getByLabel("Options (one per line)").fill("Damaged\nMissing item\nLate");
  await page.getByLabel("Required", { exact: true }).check();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Form published")).toBeVisible();
  await expect(page.getByText("Published v1")).toBeVisible();

  // Portal on.
  await page.getByRole("link", { name: "Customer portal" }).click();
  await page.getByRole("textbox", { name: "Portal address" }).fill(portalSlug);
  await page.getByRole("button", { name: "Save portal" }).click();
  await expect(page.getByText("Portal saved")).toBeVisible();
  await expect(page.getByText(new RegExp(`Live at .*/portal/${portalSlug}`))).toBeVisible();
});

test("a customer submits a request through the portal and gets a private link", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/portal/${portalSlug}`);
  await expect(page.getByRole("heading", { level: 1, name: /Support/ })).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Enter your name")).toBeVisible(); // server-side validation, nothing created
  await page.getByLabel("Your name").fill("Tunde Bakare");
  await page.getByLabel("Email").fill(`tunde-${run}@example.com`);
  await page.getByLabel("Subject").fill("Jar arrived damaged");
  await page.getByLabel("What went wrong?").selectOption("Damaged");
  await page.getByLabel("Message").fill("The palm oil jar was cracked when it arrived.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText(/we received your request/)).toBeVisible();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  ticketUrl = page.url().replace(/\?new=1$/, "");
  expect(ticketUrl).toMatch(new RegExp(`/portal/${portalSlug}/t/[A-Za-z0-9_-]{30,}$`));
  await ctx.close();
});

test("the team sees routing, SLA and form answers, and replies through the portal", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/support/tickets?view=mine`);
  const row = page.getByRole("row", { name: /Jar arrived damaged/ });
  await expect(row).toBeVisible(); // routed to the owner by the rule
  await expect(row.getByText(/Reply in/)).toBeVisible();
  await expect(row.getByText("High")).toBeVisible(); // priority from the form
  await row.getByRole("button", { name: /Jar arrived damaged/ }).click();
  const d = page.getByRole("dialog");
  await expect(d.getByText("Standard support")).toBeVisible();
  await expect(d.getByText("First reply", { exact: true })).toBeVisible();
  await expect(d.getByText("Form answers")).toBeVisible();
  await expect(d.getByText("Damaged", { exact: true })).toBeVisible();
  await expect(d.getByText(/customer sees replies on their portal request page/)).toBeVisible();
  await d.getByPlaceholder("Write your reply…").fill("So sorry, Tunde! A replacement ships today.");
  await d.getByRole("button", { name: "Save reply" }).click();
  await expect(d.getByText("Visible in customer portal")).toBeVisible();
  await expect(d.getByText("Met", { exact: true })).toBeVisible();
});

test("the customer sees the reply, answers back, and the ticket reopens for the team", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(ticketUrl);
  await expect(page.getByText("A replacement ships today")).toBeVisible();
  await expect(page.getByText("Waiting for your reply")).toBeVisible();
  await page.getByLabel("Add a reply").fill("Thank you so much!");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Thank you so much!")).toBeVisible();
  await expect(page.getByText("In progress")).toBeVisible();
  await page.goto(`/portal/${portalSlug}/t/${"x".repeat(32)}`);
  await expect(page.getByRole("heading", { name: /This link isn.t valid/ })).toBeVisible();
  await ctx.close();
});

test("support dashboard shows SLA compliance", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/support`);
  await expect(page.getByText("First reply within SLA (30 days)")).toBeVisible();
  await expect(page.getByText("100%").first()).toBeVisible();
  await expect(page.getByText("SLA: overdue & due soon")).toBeVisible();
});
