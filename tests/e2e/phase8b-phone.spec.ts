import { expect, test } from "@playwright/test";
import { makeUser, signUpWithOrg } from "./helpers";

const run = `p8${Date.now().toString(36)}`;
const owner = { ...makeUser("phone", run), name: "Kemi Phone" };

test("phone is honest when Twilio isn't configured, and every phone page renders without fake data", async ({ page }) => {
  const slug = await signUpWithOrg(page, owner, `Kemi Calls ${run}`);
  await page.getByRole("link", { name: /^Phone/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/phone$`));
  await expect(page.getByRole("heading", { name: "Phone", exact: true })).toBeVisible();
  await expect(page.getByText("Phone isn't set up yet")).toBeVisible();
  await expect(page.getByText(/Twilio platform credentials .* haven't been configured/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable phone" })).toHaveCount(0);
  await expect(page.getByText("Scheduled for Phase")).toHaveCount(0);
  // No softphone without a working phone setup
  await expect(page.getByRole("button", { name: /^Phone ·/ })).toHaveCount(0);

  await page.goto(`/o/${slug}/phone/calls`);
  await expect(page.getByRole("heading", { name: "No calls yet" })).toBeVisible();
  await page.getByLabel("Outcome").selectOption("missed");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/outcome=missed/);
  await expect(page.getByRole("heading", { name: "No calls match" })).toBeVisible();

  await page.goto(`/o/${slug}/phone/voicemail`);
  await expect(page.getByRole("heading", { name: "No new voicemail" })).toBeVisible();

  // Settings need an account first
  await page.goto(`/o/${slug}/phone/settings`);
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/phone$`));

  // Unknown call ids are a plain 404, not an error page
  await page.goto(`/o/${slug}/phone/calls/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("Not found")).toBeVisible();

  // Phone notifications can be switched off like the others
  await page.goto(`/o/${slug}/settings/notifications`);
  await expect(page.getByText("A call to you or your queue is missed")).toBeVisible();
  await expect(page.getByText("A caller leaves voicemail for you or your queue")).toBeVisible();
});
