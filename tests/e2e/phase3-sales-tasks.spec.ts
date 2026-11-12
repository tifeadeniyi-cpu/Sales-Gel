import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `s${Date.now().toString(36)}`;
const owner = makeUser("sowner", run);
let slug = "";

test.describe.configure({ mode: "serial" });

test("create a lead linked to a customer and see it on the board", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Jollof Co ${run}`);
  await page.goto(`/o/${slug}/customers/new`);
  await page.getByLabel("First name", { exact: true }).fill("Kemi");
  await page.getByLabel("Last name", { exact: true }).fill("Bello");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Kemi Bello" })).toBeVisible();

  await page.goto(`/o/${slug}/deals`);
  await expect(page.getByText("No leads yet")).toBeVisible();
  await page.getByRole("button", { name: "New lead" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /^Title/ }).fill("Wedding catering");
  await dialog.getByRole("combobox", { name: "Customer" }).fill("Kemi");
  await dialog.getByRole("option", { name: /Kemi Bello/ }).click();
  await dialog.getByRole("textbox", { name: "Estimated value" }).fill("2,500.50");
  await dialog.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText(/Lead LEAD-\d+ created/)).toBeVisible();

  const newInquiry = page.getByRole("listitem", { name: /New Inquiry/ });
  await expect(newInquiry.getByText("Wedding catering")).toBeVisible();
  await expect(newInquiry.getByText("$2,500.50").first()).toBeVisible();
});

test("drag a lead to another stage; it persists", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/deals`);
  const card = page.getByRole("button", { name: "Open lead Wedding catering" });
  const qualified = page.getByRole("listitem", { name: /Qualified/ });
  await card.dragTo(qualified);
  await expect(page.getByText("Moved to Qualified")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem", { name: /Qualified/ }).getByText("Wedding catering")).toBeVisible();
});

test("stage required fields block moves with a clear message; lost needs a reason", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/leads/settings`);
  await page.getByRole("button", { name: "Edit Offer Sent" }).click();
  await page.getByRole("dialog").getByLabel("Expected close date").check();
  await page.getByRole("button", { name: "Save stage" }).click();
  await expect(page.getByText("Stage saved")).toBeVisible();
  await expect(page.getByText("Requires: Expected close date")).toBeVisible();

  await page.goto(`/o/${slug}/deals`);
  await page.getByLabel("Move Wedding catering to stage").selectOption({ label: "Move to Offer Sent" });
  await expect(page.getByText(/“Offer Sent” requires: Expected close date/)).toBeVisible();
  await expect(page.getByRole("listitem", { name: /Qualified/ }).getByText("Wedding catering")).toBeVisible();

  await page.getByLabel("Move Wedding catering to stage").selectOption({ label: "Move to Lost" });
  await expect(page.getByRole("heading", { name: /Mark “Wedding catering” as lost/ })).toBeVisible();
  await page.getByRole("button", { name: "Price too high" }).click();
  await page.getByRole("button", { name: "Mark as lost" }).click();
  await expect(page.getByText("Moved to Lost")).toBeVisible();
});

test("lead drawer: reopen, edit inline, add a task linked to the lead", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/deals`);
  await page.getByRole("button", { name: "Open lead Wedding catering" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Reason: Price too high")).toBeVisible();
  await drawer.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Stage updated")).toBeVisible();
  // The panel remounts with the reopened lead; wait for that before editing.
  await expect(drawer.getByText("Reason: Price too high")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Reopen" })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Edit Expected close" }).click();
  await drawer.getByLabel("Expected close", { exact: true }).fill("2026-12-20");
  await drawer.getByRole("button", { name: "Save Expected close" }).click();
  await expect(drawer.getByRole("button", { name: "Edit Expected close" })).toContainText("2026-12-20");

  await drawer.getByRole("button", { name: "Add task" }).click();
  const taskDialog = page.getByRole("dialog", { name: "New task" });
  await taskDialog.getByRole("textbox", { name: /^Title/ }).fill("Send tasting menu");
  await taskDialog.getByLabel("Due").fill("2026-12-01T10:00");
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created")).toBeVisible();
  await expect(drawer.getByText("Send tasting menu")).toBeVisible();
});

test("tasks page: complete with the check circle, calendar and board views, customer link", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/tasks`);
  await expect(page.getByText("Send tasting menu")).toBeVisible();
  await page.getByRole("checkbox", { name: "Mark “Send tasting menu” as done" }).click();
  // Open view drops the task once the server confirms; then it appears under Done, checked.
  await expect(page.getByText("Send tasting menu")).toHaveCount(0);
  await page.getByLabel("Status").selectOption("done");
  await expect(page.getByRole("checkbox", { name: "Mark “Send tasting menu” as not done" })).toBeVisible();

  await page.getByRole("button", { name: "Calendar view" }).click();
  await page.goto(`/o/${slug}/tasks?view=calendar&month=2026-12&status=all`);
  await expect(page.getByRole("link", { name: "Send tasting menu" })).toBeVisible();
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.getByRole("region", { name: "Done" }).getByText("Send tasting menu")).toBeVisible();

  // The same task shows on the related lead's customer? It's linked to the lead; open the task and comment.
  await page.goto(`/o/${slug}/tasks?status=all`);
  await page.getByRole("button", { name: /Send tasting menu/ }).click();
  await page.getByLabel("Comment").fill("Menu sent via WhatsApp");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Menu sent via WhatsApp")).toBeVisible();
});

test("customer page shows the lead and lets you add tasks; command center widgets are live", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/customers?q=Kemi`);
  await page.getByRole("button", { name: "Kemi Bello" }).click();
  await page.getByRole("link", { name: "Open full page" }).click();
  await expect(page.getByText("Wedding catering")).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Leads" }).click();
  await expect(page.getByRole("link", { name: "Wedding catering" })).toBeVisible();

  await page.goto(`/o/${slug}`);
  await expect(page.getByTestId("card-deals")).toContainText("$2,500.50");
});

test("sales reps can't open pipeline settings", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/team`);
  await page.getByRole("button", { name: "Invite member" }).click();
  const rep = makeUser("srep", run);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(rep.email);
  await dialog.getByLabel("Role").selectOption({ label: "Sales Representative" });
  await dialog.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await page.context().clearCookies(); // start the invitee in a clean, signed-out session
  const path = new URL(link).pathname;
  await page.goto(`/sign-up?next=${encodeURIComponent(path)}&email=${encodeURIComponent(rep.email)}`);
  await page.getByLabel("Your name").fill(rep.name);
  await page.getByLabel("Password").fill(rep.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("button", { name: "Account menu" }).filter({ hasText: "Sales Representative" })).toBeVisible();

  await page.goto(`/o/${slug}/deals`);
  await expect(page.getByRole("link", { name: "Pipeline settings" })).toHaveCount(0);
  // Reps only see leads assigned to them — the owner's unassigned lead is hidden.
  await expect(page.getByText("Wedding catering")).toHaveCount(0);
  await page.goto(`/o/${slug}/leads/settings`);
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});
