import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `i${Date.now().toString(36)}`;
const owner = makeUser("iowner", run);
let slug = "";

test.describe.configure({ mode: "serial" });

test("integrations page shows honest connection states", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Ada Styles ${run}`);
  await page.getByRole("button", { name: "More" }).click().catch(() => undefined);
  await page.getByRole("link", { name: "Apps & Integrations" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Apps & Integrations" })).toBeVisible();
  await expect(page.getByText("Checkout Sessions — Write")).toBeVisible();
  // Shopify app credentials aren't set in this environment, so it says so rather than offering a broken flow.
  await expect(page.getByText(/Shopify app isn.t configured on this server/)).toBeVisible();
  await expect(page.getByText("No events received yet.")).toBeVisible();

  // Publishable keys are rejected server-side before anything is sent to Stripe.
  await page.getByLabel(/Restricted API key/).fill("pk_test_abcdefghijklmnopqrstuvwxyz");
  await page.getByRole("button", { name: "Connect Stripe" }).click();
  await expect(page.getByText(/Paste a Stripe restricted key/)).toBeVisible();
});

test("orders explain how to enable payment links", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/orders/new`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Custom item" }).click();
  await page.getByLabel("Item 1 name").fill("Kaftan");
  await page.getByLabel("Item 1 price").fill("50");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page.getByRole("heading", { name: /^ORD-\d+$/ })).toBeVisible();
  const card = page.getByText("Payment links", { exact: true }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
  await expect(card.getByText(/Connect Stripe in/)).toBeVisible();
  await card.getByRole("link", { name: "Apps & Integrations" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/integrations`));
});

test("payment return page is public and never claims payment is final", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/pay/complete?status=paid");
  await expect(page.getByRole("heading", { name: /your payment was submitted/ })).toBeVisible();
  await expect(page.getByText(/Stripe is confirming the payment/)).toBeVisible();
  await page.goto("/pay/complete?status=cancelled");
  await expect(page.getByRole("heading", { name: "Payment not completed" })).toBeVisible();
  await ctx.close();
});
