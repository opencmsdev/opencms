import { expect, type Page } from "@playwright/test";

/**
 * Shared fixtures and helpers for the E2E suite.
 *
 * The whole suite runs serially against ONE server and ONE SQLite file, wiped
 * once at the start of the run. Spec files execute in alphabetical order, so
 * `admin.spec.ts` establishes the baseline (admin user, editor user, the
 * `article` type) and every later file inherits it. Name new spec files so they
 * sort after `admin.spec.ts`, and give each one its own content type where it
 * needs to create or destroy schema.
 */

export const ADMIN = {
  name: "Ada Admin",
  email: "ada@opencms.test",
  password: "ada-password-123",
};

export const EDITOR = {
  name: "Ed Editor",
  email: "ed@opencms.test",
  password: "ed-password-123",
};

/** Sign in, tolerating a context that is already authenticated. */
export async function signIn(
  page: Page,
  creds: { email: string; password: string }
): Promise<void> {
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

export interface FieldSpec {
  name: string;
  kind: string;
  required?: boolean;
  unique?: boolean;
  indexed?: boolean;
  options?: string[];
  ref?: string;
  default?: unknown;
}

/**
 * Create a content type over the API rather than by clicking through the
 * builder. Building a nine-field type in the UI would test the builder, not
 * the thing under test, and would take an order of magnitude longer.
 * `page.request` shares the browser context's cookies, so this runs as
 * whoever is currently signed in.
 */
export async function createType(
  page: Page,
  def: { name: string; label: string; fields: FieldSpec[] }
): Promise<void> {
  const res = await page.request.post("/api/content-types", { data: def });
  expect(res.status(), await res.text()).toBe(201);
}

export async function deleteType(page: Page, name: string): Promise<void> {
  const res = await page.request.delete(`/api/content-types/${name}`);
  expect([200, 204]).toContain(res.status());
}

/** Seed entries directly, for tests that need more rows than a human would click. */
export async function seedEntries(
  page: Page,
  type: string,
  rows: { data: Record<string, unknown>; status?: "draft" | "published" }[]
): Promise<void> {
  for (const row of rows) {
    const res = await page.request.post(`/api/content/${type}`, {
      data: { status: row.status ?? "draft", data: row.data },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
}

/**
 * URL of a saved entry: any id segment except the literal `new`, so a spec
 * cannot accidentally assert it "navigated" while still on the create screen.
 */
export function savedEntryUrl(type: string): RegExp {
  return new RegExp(`/content/${type}/(?!new$)[^/]+$`);
}

/**
 * Click save and wait for the write to actually land.
 *
 * On update the button label is "Save" both before and after the request, so
 * asserting on the button proves nothing and a following reload can race the
 * PATCH. Waiting on the response makes the sequence deterministic.
 */
export async function saveEntry(
  page: Page,
  type: string,
  method: "POST" | "PATCH"
): Promise<void> {
  const done = page.waitForResponse(
    (r) => r.request().method() === method && r.url().includes(`/api/content/${type}`)
  );
  await page.getByTestId("save-entry").click();
  await done;
}

/** The confirm button inside an open AlertDialog, which shares its label with the trigger. */
export function confirmDialog(page: Page, label: string) {
  return page.getByRole("alertdialog").getByRole("button", { name: label, exact: true });
}
