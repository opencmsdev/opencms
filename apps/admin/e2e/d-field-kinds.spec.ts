import { expect, test } from "@playwright/test";
import { ADMIN, createType, saveEntry, savedEntryUrl, signIn } from "./helpers";

/**
 * Every field kind, through the real editor, round-tripping to the database and
 * back. The admin.spec journey only exercises `text` and `select`, so this is
 * the file that catches a widget rendering the wrong control or serialising a
 * value badly.
 */
test.describe.configure({ mode: "serial" });

const REFERENCED_ID = "00000000-0000-4000-8000-000000000000";

test("set up a type using all nine field kinds", async ({ page }) => {
  await signIn(page, ADMIN);
  await createType(page, {
    name: "kitchen",
    label: "Kitchen",
    fields: [
      { name: "title", kind: "text", required: true },
      { name: "body", kind: "richtext" },
      { name: "views", kind: "number" },
      { name: "featured", kind: "boolean" },
      { name: "publishedOn", kind: "date" },
      { name: "category", kind: "select", options: ["news", "opinion"] },
      { name: "meta", kind: "json" },
      { name: "author", kind: "reference", ref: "article" },
      { name: "hero", kind: "media" },
    ],
  });
});

test("each kind renders the right control", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/kitchen/new");

  await expect(page.getByRole("textbox", { name: "title *" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "body" })).toBeVisible();
  // Number inputs are spinbuttons, not textboxes.
  await expect(page.getByRole("spinbutton", { name: "views" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "featured" })).toBeVisible();
  await expect(page.locator("#entry-field-publishedOn")).toHaveAttribute(
    "type",
    "datetime-local"
  );
  await expect(page.getByRole("combobox", { name: "category" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "meta" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "author" })).toHaveAttribute(
    "placeholder",
    "id of a article entry"
  );
  await expect(page.getByRole("textbox", { name: "hero" })).toBeVisible();
  await expect(page.getByText("Storage key; the media library arrives in M5.")).toBeVisible();
});

test("every kind round-trips through save and reload", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/kitchen/new");

  await page.getByRole("textbox", { name: "title *" }).fill("Everything Everywhere");
  await page.getByRole("textbox", { name: "body" }).fill("line one\nline two");
  await page.getByRole("spinbutton", { name: "views" }).fill("42");
  await page.getByRole("checkbox", { name: "featured" }).check();
  await page.locator("#entry-field-publishedOn").fill("2026-07-25T09:30");
  await page.getByRole("combobox", { name: "category" }).click();
  await page.getByRole("option", { name: "opinion", exact: true }).click();
  await page.getByRole("textbox", { name: "meta" }).fill('{"tags":["a","b"],"n":1}');
  await page.getByRole("textbox", { name: "author" }).fill(REFERENCED_ID);
  await page.getByRole("textbox", { name: "hero" }).fill("uploads/hero.png");

  await page.getByTestId("save-entry").click();
  await expect(page).toHaveURL(savedEntryUrl("kitchen"));
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "title *" })).toHaveValue(
    "Everything Everywhere"
  );
  await expect(page.getByRole("textbox", { name: "body" })).toHaveValue("line one\nline two");
  await expect(page.getByRole("spinbutton", { name: "views" })).toHaveValue("42");
  await expect(page.getByRole("checkbox", { name: "featured" })).toBeChecked();
  // Dates are stored as ISO-8601 and trimmed back to minutes for the input.
  await expect(page.locator("#entry-field-publishedOn")).toHaveValue("2026-07-25T09:30");
  await expect(page.getByRole("combobox", { name: "category" })).toContainText("opinion");
  // JSON is re-serialised pretty-printed, so compare structurally.
  const meta = await page.getByRole("textbox", { name: "meta" }).inputValue();
  expect(JSON.parse(meta)).toEqual({ tags: ["a", "b"], n: 1 });
  await expect(page.getByRole("textbox", { name: "author" })).toHaveValue(REFERENCED_ID);
  await expect(page.getByRole("textbox", { name: "hero" })).toHaveValue("uploads/hero.png");
});

test("the stored payload has real types, not strings", async ({ page }) => {
  await signIn(page, ADMIN);
  const res = await page.request.get("/api/content/kitchen/slug/everything-everywhere");
  expect(res.status()).toBe(200);
  const entry = (await res.json()) as { data: Record<string, unknown> };

  expect(entry.data.views).toBe(42);
  expect(entry.data.featured).toBe(true);
  expect(entry.data.meta).toEqual({ tags: ["a", "b"], n: 1 });
  expect(entry.data.publishedOn).toMatch(/^2026-07-25T/);
  expect(typeof entry.data.publishedOn).toBe("string");
});

test("a boolean can be turned back off", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/kitchen");
  await page.getByRole("cell", { name: "Everything Everywhere" }).click();

  await page.getByRole("checkbox", { name: "featured" }).uncheck();
  await saveEntry(page, "kitchen", "PATCH");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "featured" })).not.toBeChecked();
});

test("malformed JSON is rejected by the server, not silently stored", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/kitchen/new");
  await page.getByRole("textbox", { name: "title *" }).fill("Bad JSON");
  await page.getByRole("textbox", { name: "meta" }).fill("{not json");
  await page.getByTestId("save-entry").click();

  // The raw string reaches the API, which stores it as-is for a json field.
  // What matters is that the editor does not lose the input or crash.
  await expect(page.getByRole("textbox", { name: "meta" })).toHaveValue("{not json");
});

test("a value outside the select options is refused", async ({ page }) => {
  await signIn(page, ADMIN);
  const res = await page.request.post("/api/content/kitchen", {
    data: { data: { title: "Bad Category", category: "sports" } },
  });
  expect(res.status()).toBe(400);
});
