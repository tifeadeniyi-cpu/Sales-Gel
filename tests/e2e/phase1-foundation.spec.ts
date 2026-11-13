import { expect, test, type Page } from "@playwright/test";

const run = Date.now().toString(36);
const owner = { name: "Ada Owner", email: `owner-${run}@example.test`, password: "correct-horse-1" };
const rep = { name: "Bayo Rep", email: `rep-${run}@example.test`, password: "correct-horse-2" };
const orgName = `Sasun Market ${run}`;
let orgSlug = "";
let inviteLink = "";

async function signUp(page: Page, u: typeof owner, next?: string) {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up");
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function signIn(page: Page, u: typeof owner) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\//);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

test.describe.configure({ mode: "serial" });

test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/o/anything");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fo%2Fanything/);
});

test("owner signs up, creates a workspace and lands on the dashboard", async ({ page }) => {
  await signUp(page, owner);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Business name").fill(orgName);
  await expect(page.getByLabel("Workspace URL")).toHaveValue(/sasun-market-/);
  await page.getByLabel("Default currency").selectOption("NGN");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)|Welcome back/ })).toBeVisible();
  orgSlug = new URL(page.url()).pathname.split("/")[2];
  expect(orgSlug).toContain("sasun-market");
  await expect(page.getByRole("button", { name: "Account menu" }).filter({ hasText: "Owner" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "More" }).click();
  await expect(nav.getByRole("link", { name: "Team & Permissions" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent Activity" })).toContainText("No activity yet.");
  await page.goto(`/o/${orgSlug}/settings/audit`);
  await expect(page.getByText("created the workspace")).toBeVisible();
});

test("validation errors are shown inline and nothing is saved", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/settings`);
  await page.getByLabel("Business name").fill("x");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Business name")).toHaveValue(orgName);
});

test("settings save, persist and are audited", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/settings`);
  await page.getByLabel("Business name").fill(`${orgName} Ltd`);
  await page.getByLabel("Timezone").selectOption("America/Chicago");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Business name")).toHaveValue(`${orgName} Ltd`);
  await expect(page.getByLabel("Timezone")).toHaveValue("America/Chicago");

  await page.getByRole("link", { name: "Security & audit log" }).click();
  await expect(page.getByText("updated organization settings").first()).toBeVisible();
});

test("owner invites a sales rep and gets a copyable link", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/team`);
  await page.getByRole("button", { name: "Invite member" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(rep.email);
  await dialog.getByLabel("Role").selectOption({ label: "Sales Representative" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation created")).toBeVisible();
  await expect(page.getByText("Email delivery isn't connected yet")).toBeVisible();
  inviteLink = await page.getByLabel("Invitation link").inputValue();
  expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("cell", { name: rep.email })).toBeVisible();
});

test("invitee signs up through the link, joins with limited access", async ({ page }) => {
  const path = new URL(inviteLink).pathname;
  await page.goto(path);
  await expect(page.getByText(`Join ${orgName} Ltd`)).toBeVisible();
  await page.getByRole("link", { name: "Create account to join" }).click();
  await expect(page.getByLabel("Work email")).toHaveValue(rep.email);
  await page.getByLabel("Your name").fill(rep.name);
  await page.getByLabel("Password").fill(rep.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(path));
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("button", { name: "Account menu" }).filter({ hasText: "Sales Representative" })).toBeVisible();

  // Limited permissions: no invite button, read-only settings, audit log forbidden, admin nav hidden.
  await page.goto(`/o/${orgSlug}/team`);
  await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
  await page.goto(`/o/${orgSlug}/settings`);
  await expect(page.getByLabel("Business name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await page.goto(`/o/${orgSlug}/settings/audit`);
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Integrations" })).toHaveCount(0);

  // Used invitation can't be reused.
  await page.goto(path);
  await expect(page.getByText("Invitation unavailable")).toBeVisible();
});

test("rep creates their own workspace; the owner cannot access it (tenant isolation)", async ({ page }) => {
  await signIn(page, rep);
  await page.goto("/onboarding");
  await page.getByLabel("Business name").fill(`Rep Side Shop ${run}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)|Welcome back/ })).toBeVisible();
  const repSlug = new URL(page.url()).pathname.split("/")[2];

  // Org switcher shows both orgs for the rep.
  await page.getByRole("button", { name: "Switch organization" }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(`${orgName} Ltd`) })).toBeVisible();
  await page.keyboard.press("Escape");
  await signOut(page);

  await signIn(page, owner);
  const res = await page.goto(`/o/${repSlug}/team`);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Not found")).toBeVisible();
});

test("owner is notified that the rep joined and can change the rep's role inline", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/notifications`);
  await expect(page.getByText(`${rep.email} joined`)).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();

  await page.goto(`/o/${orgSlug}/team`);
  const select = page.getByLabel(`Role for ${rep.name}`);
  await select.selectOption({ label: "Sales Manager" });
  await expect(page.getByText("Role updated")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`Role for ${rep.name}`)).toHaveValue(await page.getByLabel(`Role for ${rep.name}`).inputValue());
  await expect(page.getByLabel(`Role for ${rep.name}`).locator("option:checked")).toHaveText("Sales Manager");

  // Last-owner protection is explained, not silently ignored.
  await expect(page.getByLabel(`Role for ${owner.name}`).locator("option:checked")).toHaveText("Owner");
  await page.getByLabel(`Role for ${owner.name}`).selectOption({ label: "Admin" });
  await expect(page.getByText("at least one active Owner")).toBeVisible();
  await expect(page.getByLabel(`Role for ${owner.name}`).locator("option:checked")).toHaveText("Owner");
});

test("custom role and team management", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/team/roles`);
  await page.getByRole("button", { name: "New role" }).click();
  await page.getByLabel("Role name").fill("Fulfillment");
  await page.getByLabel("View orders").check();
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByText("Role created")).toBeVisible();
  await expect(page.getByRole("row", { name: /Fulfillment\s*Custom/ })).toBeVisible();

  await page.goto(`/o/${orgSlug}/team/teams`);
  await page.getByLabel("Team name").fill("Customer Care");
  await page.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByText("Team created.")).toBeVisible();
  await page.getByRole("checkbox", { name: rep.name }).check();
  await page.getByRole("button", { name: "Save members" }).click();
  await expect(page.getByText("Team members saved")).toBeVisible();
  await page.goto(`/o/${orgSlug}/team`);
  await expect(page.getByRole("row", { name: new RegExp(rep.name) }).getByText("Customer Care")).toBeVisible();
});

test("modules from later phases are clearly marked and show no fake data", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${orgSlug}/phone`);
  await expect(page.getByText("Scheduled for Phase 8b")).toBeVisible();
  await page.goto(`/o/${orgSlug}/does-not-exist`);
  await expect(page.getByText("Not found")).toBeVisible();
});

test("mobile layout exposes navigation through the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, owner);
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)|Welcome back/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Team & Permissions" }).click();
  await expect(page.getByRole("heading", { name: "Team & Permissions" })).toBeVisible();
});
