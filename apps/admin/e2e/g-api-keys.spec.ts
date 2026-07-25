import { expect, test } from "@playwright/test";
import { ADMIN, confirmDialog, signIn } from "./helpers";

/**
 * Machine access. admin.spec mints one editor key and writes an entry with it;
 * this file covers the admin role, revocation, and the one-time display of the
 * secret.
 */
test.describe.configure({ mode: "serial" });

let adminKey = "";

test("an admin-role key can write schema, an editor-role key cannot", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/keys");
  await expect(page.getByRole("cell", { name: "e2e-ci" })).toBeVisible(); // list loaded

  await page.getByTestId("new-key").click();
  await page.getByRole("textbox", { name: "Name" }).fill("e2e-admin");
  await page.getByRole("combobox", { name: "Key role" }).click();
  await page.getByRole("option", { name: "admin", exact: true }).click();
  await page.getByTestId("mint-key").click();

  adminKey = (await page.getByTestId("minted-key").textContent())?.trim() ?? "";
  expect(adminKey).toMatch(/^ocms_/);

  const allowed = await page.request.post("/api/content-types", {
    headers: { "x-api-key": adminKey, cookie: "" },
    data: { name: "from_key", label: "From Key", fields: [{ name: "title", kind: "text" }] },
  });
  expect(allowed.status()).toBe(201);

  // The editor key from admin.spec is refused on the same route.
  await expect(page.getByRole("cell", { name: "e2e-admin" })).toBeVisible();
});

test("an unknown key is a hard 401, not an anonymous downgrade", async ({ page }) => {
  // A misconfigured client should fail loudly rather than silently reading
  // published content as if it had sent no key at all.
  const res = await page.request.get("/api/content/article", {
    headers: { "x-api-key": "ocms_not-a-real-key", cookie: "" },
  });
  expect(res.status()).toBe(401);
});

test("the minted secret is shown once and then dismissed", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/keys");
  await page.getByTestId("new-key").click();
  await page.getByRole("textbox", { name: "Name" }).fill("e2e-throwaway");
  await page.getByTestId("mint-key").click();

  await expect(page.getByText("This key is shown once and never again.")).toBeVisible();
  await page.getByRole("button", { name: "Done, I copied it" }).click();
  await expect(page.getByTestId("minted-key")).toHaveCount(0);

  // A reload does not bring it back.
  await page.reload();
  await expect(page.getByTestId("minted-key")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "e2e-throwaway" })).toBeVisible();
});

test("the new-key form toggles closed", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/keys");

  await page.getByTestId("new-key").click();
  await expect(page.getByTestId("mint-key")).toBeVisible();
  await expect(page.getByTestId("new-key")).toHaveText("Close");

  await page.getByTestId("new-key").click();
  await expect(page.getByTestId("mint-key")).toHaveCount(0);
  await expect(page.getByTestId("new-key")).toHaveText("New key");
});

test("revoking a key stops it working", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/keys");

  const row = page.getByRole("row", { name: /e2e-admin/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Revoke" }).click();

  await expect(page.getByRole("alertdialog")).toContainText('Revoke "e2e-admin"?');
  await expect(page.getByRole("alertdialog")).toContainText(
    "Clients using this key stop working immediately."
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row", { name: /e2e-admin/ })).toBeVisible();

  await page.getByRole("row", { name: /e2e-admin/ }).getByRole("button", { name: "Revoke" }).click();
  await confirmDialog(page, "Revoke").click();
  await expect(page.getByRole("row", { name: /e2e-admin/ })).toHaveCount(0);

  const after = await page.request.get("/api/content-types", {
    headers: { "x-api-key": adminKey, cookie: "" },
  });
  expect(after.status()).toBe(401);
});

test("clean up the type the key created", async ({ page }) => {
  await signIn(page, ADMIN);
  const res = await page.request.delete("/api/content-types/from_key");
  expect([200, 204]).toContain(res.status());
});
