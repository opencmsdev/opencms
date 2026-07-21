import { expect, test } from "@playwright/test";

/**
 * One serial journey through the whole admin, in the order a fresh install
 * experiences it: bootstrap, schema, content lifecycle, access management,
 * role restrictions. The webServer starts on an empty database.
 */
test.describe.configure({ mode: "serial" });

const ADMIN = { name: "Ada Admin", email: "ada@opencms.test", password: "ada-password-123" };
const EDITOR = { name: "Ed Editor", email: "ed@opencms.test", password: "ed-password-123" };

test("first run: create the bootstrap admin", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Create the admin" })).toBeVisible();

  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create admin account" }).click();

  // Lands in the shell as admin with the empty state.
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  await expect(page.getByText(`${ADMIN.name} ·`)).toBeVisible();
});

test("create a content type in the builder", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Create the first content type" }).click();

  await page.getByRole("textbox", { name: "Machine name" }).fill("article");
  await page.getByRole("textbox", { name: "Label", exact: true }).fill("Article");

  await page.getByTestId("add-field").click();
  const title = page.getByTestId("field-0");
  await title.getByRole("textbox", { name: "Field name" }).fill("title");
  await title.getByRole("checkbox", { name: "required" }).check();

  await page.getByTestId("add-field").click();
  const category = page.getByTestId("field-1");
  await category.getByRole("textbox", { name: "Field name" }).fill("category");
  // Rich kind picker: trigger button, then an option carrying the kind name.
  await category.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "select", exact: true }).click();
  await expect(category.getByRole("button", { name: "Kind" })).toContainText("Select");
  await category.getByRole("textbox", { name: "Options" }).fill("news, opinion");

  await page.getByTestId("save-type").click();
  await expect(page.getByRole("heading", { name: "Content types" })).toBeVisible();
  await expect(page.getByText("2 fields")).toBeVisible();
});

test("entry lifecycle: draft, publish, filters", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Article" }).first().click();
  await expect(page.getByRole("heading", { name: "Article" })).toBeVisible();

  // Create a draft.
  await page.getByRole("link", { name: "New entry" }).click();
  await page.getByRole("textbox", { name: "title *" }).fill("Hello Admin UI");
  await page.getByRole("combobox", { name: "category" }).click();
  await page.getByRole("option", { name: "news", exact: true }).click();
  await page.getByTestId("save-entry").click();

  // Saved: slug derived, still a draft.
  await expect(page.getByText("draft").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue("hello-admin-ui");

  // Publish it.
  await page.getByTestId("toggle-publish").click();
  await expect(page.getByTestId("toggle-publish")).toHaveText("Unpublish");

  // The list shows it and the status filter narrows correctly.
  await page.getByRole("link", { name: "Article" }).first().click();
  await expect(page.getByRole("cell", { name: "Hello Admin UI" })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "draft", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Hello Admin UI" })).not.toBeVisible();
  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "published", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Hello Admin UI" })).toBeVisible();

  // The published entry is publicly readable without a session.
  const anon = await page.request.fetch("/api/content/article/slug/hello-admin-ui", {
    headers: { cookie: "" },
  });
  expect(anon.status()).toBe(200);
});

test("mint an API key and use it against the API", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "API keys" }).click();
  await expect(page.getByText("No API keys yet.")).toBeVisible(); // list loaded

  await page.getByTestId("new-key").click();
  await page.getByRole("textbox", { name: "Name" }).fill("e2e-ci");
  await page.getByTestId("mint-key").click();

  const key = (await page.getByTestId("minted-key").textContent())?.trim() ?? "";
  expect(key).toMatch(/^ocms_/);

  // The key writes content over plain HTTP, no cookies involved.
  const res = await page.request.post("/api/content/article", {
    headers: { "x-api-key": key, cookie: "" },
    data: { status: "published", data: { title: "Via API Key", category: "opinion" } },
  });
  expect(res.status()).toBe(201);

  // And it shows up in the list with its role.
  await expect(page.getByRole("cell", { name: "e2e-ci" })).toBeVisible();
});

test("create an editor; editors see no admin surface", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("cell", { name: ADMIN.name })).toBeVisible(); // list loaded
  await page.getByTestId("new-user").click();
  await page.getByRole("textbox", { name: "Name" }).fill(EDITOR.name);
  await page.getByRole("textbox", { name: "Email" }).fill(EDITOR.email);
  await page.getByRole("textbox", { name: "Password" }).fill(EDITOR.password);
  await page.getByTestId("create-user").click();
  await expect(page.getByRole("cell", { name: EDITOR.name })).toBeVisible();

  // Switch to the editor.
  await page.getByTestId("sign-out").click();
  await signIn(page, EDITOR);

  // Content is there, admin nav is not.
  await expect(page.getByRole("link", { name: "Article" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Content types" })).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible();
  await expect(page.getByRole("link", { name: "API keys" })).not.toBeVisible();

  // Editors can write content.
  await page.getByRole("link", { name: "Article" }).first().click();
  await page.getByRole("link", { name: "New entry" }).click();
  await page.getByRole("textbox", { name: "title *" }).fill("By The Editor");
  await page.getByTestId("save-entry").click();
  await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue("by-the-editor");
});

test("signup stays closed after bootstrap", async ({ page }) => {
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { email: "late@opencms.test", password: "password-123456", name: "Late" },
  });
  expect(res.status()).toBe(403);
});

async function signIn(page: import("@playwright/test").Page, creds: { email: string; password: string }) {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Sign in" });
  const signOut = page.getByTestId("sign-out");
  // Wait for the session probe to resolve into either screen.
  await expect(heading.or(signOut)).toBeVisible();
  if (await signOut.isVisible()) return; // already signed in
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(signOut).toBeVisible();
}
