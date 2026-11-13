import { expect, test } from "@playwright/test";
import { makeUser, signIn, signUpWithOrg } from "./helpers";

const run = `i8${Date.now().toString(36)}`;
const owner = { ...makeUser("inbox", run), name: "Bola Agent" };
let slug = "";
let key = "";

test.describe.configure({ mode: "serial" });

test("admin connects website chat and adds a saved reply", async ({ page }) => {
  slug = await signUpWithOrg(page, owner, `Bola Market ${run}`);
  await expect(page.getByText("No channels connected yet")).toBeVisible(); // dashboard Inbox Preview
  await page.getByRole("link", { name: /^Inbox/ }).first().click();
  await expect(page.getByRole("heading", { name: "No channels connected yet" })).toBeVisible();
  await page.getByRole("link", { name: "Connect a channel" }).click();
  await expect(page.getByRole("heading", { name: "Inbox settings" })).toBeVisible();

  // Meta credentials are validated before anything is sent to Meta.
  await page.getByRole("button", { name: "WhatsApp" }).click();
  await page.getByLabel("Phone number ID").fill("123456");
  await page.getByLabel("Access token").fill("x".repeat(30));
  await page.getByLabel("App secret").fill("not-a-secret");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(/app secret is 32 letters/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Web chat" }).click();
  await page.getByLabel("Chat title").fill("Chat with Bola Market");
  await page.getByLabel("Greeting").fill("Hi! Ask us anything about your order.");
  await page.getByRole("button", { name: "Add web chat" }).click();
  await expect(page.getByText("Web chat added")).toBeVisible();
  const snippet = await page.locator("code", { hasText: "widget.js" }).innerText();
  key = /data-key="(wc_[^"]+)"/.exec(snippet)![1];
  expect(key).toMatch(/^wc_/);

  await page.getByLabel("Name", { exact: true }).fill("Delivery times");
  await page.getByLabel("Reply", { exact: true }).fill("We deliver across Dallas in 1–2 days.");
  await page.getByRole("button", { name: "Add saved reply" }).click();
  await expect(page.getByText("Saved reply added")).toBeVisible();
});

test("only the chat window may be framed by other sites", async ({ request }) => {
  const chat = await request.get(`/chat/${key}`);
  expect(chat.headers()["content-security-policy"]).toBe("frame-ancestors *");
  expect(chat.headers()["x-frame-options"]).toBeUndefined();
  const app = await request.get("/sign-in");
  expect(app.headers()["x-frame-options"]).toBe("DENY");
  expect(app.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const js = await request.get("/widget.js");
  expect(js.headers()["content-type"]).toContain("javascript");
});

test("a visitor chats through the embedded widget", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // A host page that embeds the widget script. (Chrome blocks cross-origin loads from localhost in this
  // test setup; the framing rules for real sites are checked by the header test above.)
  const host = `${baseURL}/__shop-test.html`;
  await page.route(host, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><h1>Bola's shop</h1><script src="${baseURL}/widget.js" data-key="${key}" async></script></body></html>` }));
  await page.goto(host);
  await page.getByRole("button", { name: "Open chat" }).click();
  const chat = page.frameLocator('iframe[title="Chat"]');
  await expect(chat.getByRole("heading", { name: "Chat with Bola Market" })).toBeVisible();
  await expect(chat.getByText("Hi! Ask us anything about your order.")).toBeVisible();
  await chat.getByRole("textbox", { name: "Message" }).fill("Do you deliver to Frisco?");
  await expect(chat.getByLabel("Email")).toHaveAttribute("required", ""); // asked by default (also enforced server-side)
  await chat.getByLabel("Name").fill("Ife");
  await chat.getByLabel("Email").fill(`ife-${run}@example.com`);
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText("Do you deliver to Frisco?")).toBeVisible();
  await expect(chat.getByText(/The team will reply here/)).toBeVisible();
  await ctx.storageState({ path: `test-results/visitor-${run}.json` });
  await ctx.close();
});

test("the agent replies from the inbox with a saved reply, adds a note, and opens a ticket", async ({ page }) => {
  await signIn(page, owner);
  await page.goto(`/o/${slug}/inbox`);
  const row = page.getByRole("link", { name: /Ife/ });
  await expect(row.getByLabel("Unread")).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { level: 2, name: "Ife" })).toBeVisible();
  const thread = page.getByRole("list", { name: "Messages" });
  await expect(thread.getByText("Do you deliver to Frisco?")).toBeVisible();
  await page.getByLabel("Insert saved reply").selectOption({ label: "Delivery times" });
  await expect(page.getByLabel("Reply", { exact: true })).toHaveValue(/1–2 days/);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(thread.getByText("We deliver across Dallas in 1–2 days.")).toBeVisible();
  await expect(thread.getByText(/^(Sent|Delivered)$/)).toBeVisible();
  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByLabel("Internal note").fill("Frisco is zone 2");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(thread.getByRole("article", { name: "Internal note" }).getByText("Frisco is zone 2")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Assignee" })).toHaveValue(/.+/); // replying claimed it
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByRole("link", { name: /^TCK-\d+$/ })).toBeVisible();
});

test("the visitor sees the reply (never the note), answers, and the agent sees it", async ({ browser, page }) => {
  const ctx = await browser.newContext({ storageState: `test-results/visitor-${run}.json` });
  const v = await ctx.newPage();
  await v.goto(`/chat/${key}`);
  await expect(v.getByText("We deliver across Dallas in 1–2 days.")).toBeVisible({ timeout: 10_000 });
  await expect(v.getByText("Frisco is zone 2")).toHaveCount(0);
  await v.getByRole("textbox", { name: "Message" }).fill("Perfect, ordering now!");
  await v.getByRole("button", { name: "Send" }).click();
  await expect(v.getByText("Perfect, ordering now!")).toBeVisible();

  await signIn(page, owner);
  await page.goto(`/o/${slug}/inbox`);
  await page.getByRole("link", { name: /Ife/ }).click();
  await expect(page.getByRole("list", { name: "Messages" }).getByText("Perfect, ordering now!")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();
  await expect(v.getByText(/This conversation was closed/)).toBeVisible({ timeout: 10_000 });
  await ctx.close();

  await page.goto(`/o/${slug}`);
  await expect(page.getByText("No open conversations. You're all caught up.")).toBeVisible();
});
