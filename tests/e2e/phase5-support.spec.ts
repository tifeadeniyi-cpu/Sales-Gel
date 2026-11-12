import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `t${Date.now().toString(36)}`;
const owner = makeUser("sowner", run);
const agent = makeUser("sagent", run);
let slug = "";
let ticketUrl = "";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

test.describe.configure({ mode: "serial" });

test("ticket from an order: attachment, reply, customer message, resolve", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Kemi Foods ${run}`);
  // Customer + order to complain about
  await page.goto(`/o/${slug}/customers/new`);
  await page.getByLabel("First name", { exact: true }).fill("Tunde");
  await page.getByLabel("Last name", { exact: true }).fill("Bello");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Tunde Bello" })).toBeVisible();
  await page.goto(`/o/${slug}/orders/new`);
  await page.getByRole("combobox", { name: "Customer" }).fill("Tunde");
  await page.getByRole("option", { name: /Tunde Bello/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Custom item" }).click();
  await page.getByLabel("Item 1 name").fill("Egusi 1kg");
  await page.getByLabel("Item 1 price").fill("18");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { name: /^ORD-\d+$/ })).toBeVisible();

  // Create ticket from the order: order + customer prefilled
  await page.getByRole("button", { name: "Create ticket" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Subject").fill("Bag arrived torn");
  await d.getByLabel("What did the customer say?").fill("The egusi bag was torn when it arrived.");
  await d.getByLabel("Received via").selectOption("whatsapp");
  await d.getByLabel("Priority").selectOption("high");
  await d.getByLabel("Type").selectOption({ label: "Product issue" });
  await d.getByLabel("Attach files").setInputFiles({ name: "torn-bag.png", mimeType: "image/png", buffer: PNG });
  await expect(d.getByText("torn-bag.png")).toBeVisible();
  await d.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByText(/Ticket TCK-\d+ created/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bag arrived torn" })).toBeVisible();
  ticketUrl = page.url();
  await expect(page.getByRole("link", { name: "Tunde Bello" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^ORD-\d+$/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "torn-bag.png" })).toBeVisible();
  await expect(page.getByText("New", { exact: true }).first()).toBeVisible();

  // Attachment downloads for the owner
  const src = await page.getByRole("img", { name: "torn-bag.png" }).getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  // Internal note, then reply → waiting on customer; honest "not sent" label
  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByLabel("Internal note").fill("Check with courier about packaging");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added")).toBeVisible();
  await page.getByRole("tab", { name: "Reply to customer" }).click();
  await page.getByLabel("Reply to customer").fill("Sorry about that! We'll send a replacement today.");
  await page.getByRole("button", { name: "Save reply" }).click();
  await expect(page.getByText("Reply saved")).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue(await page.getByRole("option", { name: "Waiting on customer" }).getAttribute("value") as string);
  await expect(page.getByText("Not sent to customer")).toBeVisible();

  // Customer calls back → logged → ticket reopens to Open
  await page.getByRole("tab", { name: "Log customer message" }).click();
  await page.getByLabel("Received via").selectOption("phone");
  await page.getByLabel("Log customer message").fill("Thanks, replacement received!");
  await page.getByRole("button", { name: "Log message" }).click();
  await expect(page.getByText("Customer message logged")).toBeVisible();
  await expect(page.getByText(/via Phone call/)).toBeVisible();

  // Resolve requires a resolution
  await page.getByLabel("Status").selectOption({ label: "Resolved" });
  const r = page.getByRole("dialog");
  await r.getByLabel("Resolution").selectOption("replacement_sent");
  await r.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("Status updated")).toBeVisible();
  await expect(page.getByText("Replacement sent")).toBeVisible();

  // Shows on customer profile and order page
  await page.getByRole("link", { name: "Tunde Bello" }).click();
  await expect(page.getByTestId("metric-open-tickets")).toHaveText("0");
  await page.getByRole("link", { name: /^Tickets \(1\)/ }).click();
  await expect(page.getByRole("button", { name: /Bag arrived torn/ })).toBeVisible();
  await page.getByRole("link", { name: "Files" }).click();
  await expect(page.getByRole("link", { name: "torn-bag.png" })).toBeVisible();
});

test("tickets list: views, search, drawer, quick create", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/support/tickets`);
  await expect(page.getByText("No open tickets")).toBeVisible();
  await page.getByRole("link", { name: "Resolved" }).first().click();
  await page.getByRole("button", { name: /Bag arrived torn/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Replacement sent")).toBeVisible();
  await page.keyboard.press("Escape");

  // Quick create from the top bar
  await page.getByRole("button", { name: "Quick create" }).click();
  await page.getByRole("menuitem", { name: "Ticket" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Subject").fill("Can I change delivery address?");
  await d.getByLabel("Priority").selectOption("urgent");
  await d.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByRole("heading", { name: "Can I change delivery address?" })).toBeVisible();

  await page.goto(`/o/${slug}/support/tickets`);
  await expect(page.getByRole("button", { name: /Can I change delivery address/ })).toBeVisible();
  await page.getByLabel("Search tickets").fill("delivery address");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: /Can I change delivery address/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByLabel("1 open")).toBeVisible();

  await page.goto(`/o/${slug}/support`);
  await expect(page.getByRole("heading", { name: "Support Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Can I change delivery address/ })).toBeVisible();
});

test("settings: add a custom status", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/settings/support`);
  await page.getByLabel("Name").fill("Awaiting supplier");
  await page.getByLabel("Behaves like").selectOption("pending_internal");
  await page.getByRole("button", { name: "Add status" }).click();
  await expect(page.getByText("Status added")).toBeVisible();
  await expect(page.getByText("Awaiting supplier")).toBeVisible();
});

test("support agents only see tickets assigned to them", async ({ page, browser }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/team`);
  await page.getByRole("button", { name: "Invite member" }).click();
  const inv = page.getByRole("dialog");
  await inv.getByLabel("Email").fill(agent.email);
  await inv.getByLabel("Role").selectOption({ label: "Support Agent" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const path = new URL(await page.getByLabel("Invitation link").inputValue()).pathname;

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(path);
  await p2.getByRole("link", { name: "Create account to join" }).click();
  await p2.getByLabel("Your name").fill(agent.name);
  await p2.getByLabel("Password").fill(agent.password);
  await p2.getByRole("button", { name: "Create account" }).click();
  await p2.getByRole("button", { name: "Accept invitation" }).click();
  await expect(p2.getByText("You're signed in as Support Agent")).toBeVisible();
  await p2.goto(`/o/${slug}/support/tickets`);
  await expect(p2.getByText("No tickets assigned to you")).toBeVisible();
  await p2.goto(ticketUrl);
  await expect(p2.getByText(/not found/i).first()).toBeVisible();

  // Owner assigns the open ticket to the agent
  await page.goto(`/o/${slug}/support/tickets`);
  await page.getByRole("button", { name: /Can I change delivery address/ }).click();
  await page.getByRole("dialog").getByLabel("Assignee").selectOption({ label: agent.name });
  await expect(page.getByText("Assignee saved")).toBeVisible();

  await p2.goto(`/o/${slug}/support/tickets`);
  await expect(p2.getByRole("button", { name: /Can I change delivery address/ })).toBeVisible();
  await expect(p2.getByRole("button", { name: /Bag arrived torn/ })).toHaveCount(0);
  await ctx2.close();
});
