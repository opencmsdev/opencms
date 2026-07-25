import { expect, test } from "@playwright/test";
import { ADMIN, EDITOR, signIn } from "./helpers";

/**
 * Who can see and do what. admin.spec proves the editor's nav is hidden; this
 * file proves the routes themselves are unreachable, that roles can be changed
 * at runtime, and that a failed sign-in says so.
 */
test.describe.configure({ mode: "serial" });

test("a wrong password is reported, not swallowed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("wrong email or password")).toBeVisible();
  await expect(page.getByTestId("sign-out")).toHaveCount(0);
});

test("an unknown email is reported the same way", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("nobody@opencms.test");
  await page.getByLabel("Password").fill("whatever-123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("wrong email or password")).toBeVisible();
});

test("admin routes are unreachable for an editor, even by URL", async ({ page }) => {
  await signIn(page, EDITOR);

  for (const path of ["/types", "/types/new", "/types/article", "/users", "/keys"]) {
    await page.goto(path);
    // The admin routes are not registered for an editor, so the catch-all
    // redirects home, which then redirects to the first content type.
    await expect(page).toHaveURL(/\/content\/article$/);
  }
});

test("the API refuses schema writes from an editor session", async ({ page }) => {
  await signIn(page, EDITOR);
  const res = await page.request.post("/api/content-types", {
    data: { name: "sneaky", label: "Sneaky", fields: [] },
  });
  expect(res.status()).toBe(403);
});

test("you cannot change your own role", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/users");
  const ownRow = page.getByRole("row", { name: new RegExp(ADMIN.email) });
  await expect(ownRow).toContainText("(you)");
  // Everyone else gets a role combobox; your own row is plain text.
  await expect(ownRow.getByRole("combobox")).toHaveCount(0);
});

test("promoting and demoting a user takes effect immediately", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/users");

  await page.getByRole("combobox", { name: `Role for ${EDITOR.email}` }).click();
  await page.getByRole("option", { name: "admin", exact: true }).click();
  await expect(page.getByRole("combobox", { name: `Role for ${EDITOR.email}` })).toContainText(
    "admin"
  );

  // Ed now sees the admin surface.
  await page.getByTestId("sign-out").click();
  await signIn(page, EDITOR);
  await expect(page.getByRole("link", { name: "Content types" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("link", { name: "API keys" })).toBeVisible();

  // Put it back, so the rest of the suite sees the roles it expects.
  await page.getByTestId("sign-out").click();
  await signIn(page, ADMIN);
  await page.goto("/users");
  await page.getByRole("combobox", { name: `Role for ${EDITOR.email}` }).click();
  await page.getByRole("option", { name: "editor", exact: true }).click();
  await expect(page.getByRole("combobox", { name: `Role for ${EDITOR.email}` })).toContainText(
    "editor"
  );

  await page.getByTestId("sign-out").click();
  await signIn(page, EDITOR);
  await expect(page.getByRole("link", { name: "Content types" })).toHaveCount(0);
});

test("the new-user form toggles closed", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/users");

  await page.getByTestId("new-user").click();
  await expect(page.getByTestId("create-user")).toBeVisible();
  await expect(page.getByTestId("new-user")).toHaveText("Close");

  await page.getByTestId("new-user").click();
  await expect(page.getByTestId("create-user")).toHaveCount(0);
  await expect(page.getByTestId("new-user")).toHaveText("New user");
});

test("an admin can be created directly", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/users");
  await page.getByTestId("new-user").click();

  await page.getByRole("textbox", { name: "Name" }).fill("Al Admin");
  await page.getByRole("textbox", { name: "Email" }).fill("al@opencms.test");
  await page.getByRole("textbox", { name: "Password" }).fill("al-password-123");
  // The form's own select is named exactly "Role"; the per-row ones are
  // "Role for <email>", so this needs an exact match.
  await page.getByRole("combobox", { name: "Role", exact: true }).click();
  await page.getByRole("option", { name: "admin", exact: true }).click();
  await page.getByTestId("create-user").click();

  await expect(page.getByRole("cell", { name: "Al Admin" })).toBeVisible();

  await page.getByTestId("sign-out").click();
  await signIn(page, { email: "al@opencms.test", password: "al-password-123" });
  await expect(page.getByRole("link", { name: "Content types" })).toBeVisible();
});

test("signing out returns to the sign-in screen", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByTestId("sign-out").click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // And the session really is gone, not just hidden.
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
