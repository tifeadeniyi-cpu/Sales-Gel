import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `c${Date.now().toString(36)}`;
const owner = makeUser("cowner", run);
let slug = "";
let adaUrl = "";

test.describe.configure({ mode: "serial" });

test("create a customer with contact details and tags", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Naija Pantry ${run}`);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Customers & Contacts" }).click();
  await expect(page.getByText("No customers yet")).toBeVisible();
  await page.getByRole("link", { name: "Add customer" }).first().click();

  // Validation: an empty record is refused with an explanation.
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Add at least a name, company, email, phone or social handle").first()).toBeVisible();

  await page.getByLabel("First name", { exact: true }).fill("Ada");
  await page.getByLabel("Last name", { exact: true }).fill("Obi");
  await page.getByLabel("Email 1", { exact: true }).fill("ada@example.com");
  await page.getByLabel("Phone 1", { exact: true }).fill("(214) 555-0101");
  await page.getByRole("button", { name: "Add social handle" }).click();
  await page.getByLabel("Handle 1", { exact: true }).fill("@adacooks");
  await page.getByLabel("Source", { exact: true }).selectOption("instagram");
  await page.getByLabel("Tags", { exact: true }).fill("VIP, Wholesale");
  await page.getByRole("button", { name: "Create customer" }).click();

  await expect(page.getByRole("heading", { name: "Ada Obi" })).toBeVisible();
  adaUrl = new URL(page.url()).pathname;
  await expect(page.getByText("ada@example.com")).toBeVisible();
  await expect(page.getByText("adacooks")).toBeVisible();
  await expect(page.getByText("VIP", { exact: true })).toBeVisible();
});

test("inline edits persist, notes and timeline record activity", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(adaUrl);
  await page.getByRole("button", { name: "Edit Company" }).click();
  await page.getByLabel("Company", { exact: true }).fill("Obi Foods");
  await page.getByRole("button", { name: "Save Company" }).click();
  await expect(page.getByRole("button", { name: "Edit Company" })).toContainText("Obi Foods");

  await page.getByLabel("Preferred channel").selectOption("whatsapp");
  await expect(page.getByText("Preferred channel saved")).toBeVisible();

  await page.getByLabel("New note").fill("Prefers Saturday delivery");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Prefers Saturday delivery")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Edit Company" })).toContainText("Obi Foods");
  await expect(page.getByLabel("Preferred channel")).toHaveValue("whatsapp");

  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByText("added a note")).toBeVisible();
  await expect(page.getByText("companyName: — → Obi Foods")).toBeVisible();

  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Conversations" }).click();
  await expect(page.getByText("Conversations arrive in Phase 8")).toBeVisible();
});

test("list search, drawer with deep link, and global search", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/customers`);
  await page.getByLabel("Search customers").fill("adacoo");
  await expect(page).toHaveURL(/q=adacoo/);
  await page.getByRole("button", { name: "Ada Obi" }).click();
  await expect(page).toHaveURL(/open=/);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Ada Obi" })).toBeVisible();
  await expect(drawer.getByText("Prefers Saturday delivery")).toBeVisible();
  // Deep link reopens the drawer with the filter intact.
  const url = page.url();
  await page.goto(url);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Ada Obi" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/open=/);
  await expect(page).toHaveURL(/q=adacoo/);

  await page.getByLabel("Global search").fill("ada@example");
  await page.getByLabel("Global search").press("Enter");
  await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ada Obi/ })).toBeVisible();
});

test("duplicate warning, merge and undo merge (Scenario 5)", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/customers/new`);
  await page.getByRole("button", { name: "Add social handle" }).click();
  await page.getByLabel("Handle 1", { exact: true }).fill("AdaCooks");
  await page.getByLabel("Handle 1", { exact: true }).blur();
  await expect(page.getByText("Possible duplicate")).toBeVisible();
  await page.getByText("Provisional contact").click();
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "@adacooks" })).toBeVisible();
  await page.getByLabel("New note").fill("DM asked for egusi prices");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("DM asked for egusi prices")).toBeVisible();

  await page.goto(`/o/${slug}/customers/duplicates`);
  await expect(page.getByText("Same identity")).toBeVisible();
  await page.getByRole("button", { name: "Merge…" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /Ada Obi/ }).check();
  await page.getByRole("button", { name: "Merge customers" }).click();
  await expect(page.getByText("Customers merged")).toBeVisible();

  await page.goto(adaUrl);
  await expect(page.getByText("DM asked for egusi prices")).toBeVisible();
  await expect(page.getByText(/Merged @adacooks/)).toBeVisible();
  await page.getByRole("button", { name: "Undo merge" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo merge" }).click();
  await expect(page.getByText("Merge undone")).toBeVisible();
  await page.reload();
  await expect(page.getByText("DM asked for egusi prices")).toHaveCount(0);
});

test("import a CSV with a per-row error report, then export", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/customers/import`);
  const csv = ["Name,Email,Phone,Tags", "Bisi Cole,bisi@example.com,214-555-0111,Retail", "Chidi Eze,chidi@example.com,,Retail", "Broken,not-an-email,,", "Ada Duplicate,ada@example.com,,"].join("\n");
  await page.getByLabel("Choose CSV file").setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("Map columns")).toBeVisible();
  await expect(page.getByLabel("Import Name as")).toHaveValue("fullName");
  await page.getByRole("button", { name: /Import 4 rows/ }).click();
  await expect(page.getByText("Import finished")).toBeVisible();
  const stat = (label: string) => page.locator("div.rounded-md.border", { hasText: label }).locator("div.text-2xl");
  await expect(stat("Created")).toHaveText("2");
  await expect(stat("Skipped (already existed)")).toHaveText("1");
  await expect(page.getByRole("cell", { name: "Enter a valid email" })).toBeVisible();

  await page.goto(`/o/${slug}/customers`);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export" }).click();
  const download = await downloadPromise;
  const content = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(content).toContain("Bisi Cole");
  expect(content).toContain("Ada Obi");
});

test("bulk tag and archive from the list", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/customers?q=example.com&sort=name_asc`);
  await page.getByLabel("Select Bisi Cole").check();
  await page.getByLabel("Select Chidi Eze").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByLabel("Tag to add").fill("Spring Promo");
  await page.getByRole("button", { name: "Tag", exact: true }).click();
  await expect(page.getByText("Tagged: 2 customer(s)")).toBeVisible();
  await expect(page.getByRole("row", { name: /Bisi Cole/ }).getByText("Spring Promo")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Select Chidi Eze").check();
  await page.getByRole("region", { name: "Bulk actions" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Archived: 1 customer(s)")).toBeVisible();
  await expect(page.getByRole("row", { name: /Chidi Eze/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Customer views" }).getByRole("button", { name: "Archived" }).click();
  await expect(page.getByRole("row", { name: /Chidi Eze/ })).toBeVisible();
});

test("required custom field is enforced on the customer form", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/settings/customers`);
  await page.getByRole("textbox", { name: /^Label/ }).fill("Loyalty tier");
  await page.getByRole("combobox", { name: /^Type/ }).selectOption("select");
  await page.getByRole("textbox", { name: /^Options/ }).fill("Bronze, Gold");
  await page.getByText("Required when creating or editing a customer").click();
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText("loyalty_tier")).toBeVisible();

  await page.goto(`/o/${slug}/customers/new`);
  await page.getByLabel("First name", { exact: true }).fill("Dayo");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Loyalty tier is required")).toBeVisible();
  await page.getByRole("combobox", { name: /^Loyalty tier/ }).selectOption("Gold");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Dayo" })).toBeVisible();
  await expect(page.getByText("Gold")).toBeVisible();
});

test("another organization cannot open these customers (tenant isolation)", async ({ page }) => {
  const outsider = makeUser("outsider", run);
  await signUpWithOrg(page, outsider, `Other Shop ${run}`);
  const res = await page.goto(adaUrl);
  expect(res?.status()).toBe(404);
  const exp = await page.request.get(`/o/${slug}/customers/export`);
  expect(exp.status()).toBe(404);
});
