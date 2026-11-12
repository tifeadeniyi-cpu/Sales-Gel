import { expect, type Page } from "@playwright/test";

export interface TestUser { name: string; email: string; password: string }

export function makeUser(prefix: string, run: string): TestUser {
  return { name: `${prefix[0].toUpperCase()}${prefix.slice(1)} Tester`, email: `${prefix}-${run}@example.test`, password: "correct-horse-9" };
}

export async function signUp(page: Page, u: TestUser, next?: string) {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up");
  await page.getByLabel("Your name").fill(u.name);
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signIn(page: Page, u: TestUser) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/o\//);
}

/** Signs up and creates a workspace; returns the org slug. */
export async function signUpWithOrg(page: Page, u: TestUser, orgName: string) {
  await signUp(page, u);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Business name").fill(orgName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)|Welcome back/ })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}
