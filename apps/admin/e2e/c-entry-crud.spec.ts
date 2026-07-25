import { expect, test } from "@playwright/test";
import { ADMIN, confirmDialog, saveEntry, savedEntryUrl, signIn } from "./helpers";

/**
 * The editorial loop beyond "create a draft": publishing in one step,
 * unpublishing, updating in place, moving a slug, and deleting. Runs against a
 * dedicated `note` type so entry counts stay predictable for later specs.
 */
test.describe.configure({ mode: "serial" });

test("set up the note type", async ({ page }) => {
  await signIn(page, ADMIN);
  const res = await page.request.post("/api/content-types", {
    data: {
      name: "note",
      label: "Note",
      fields: [
        { name: "title", kind: "text", required: true },
        { name: "body", kind: "richtext" },
        { name: "code", kind: "text", unique: true },
      ],
    },
  });
  expect(res.status()).toBe(201);
});

test("saving without a required field surfaces the server's issues", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note/new");
  await page.getByRole("textbox", { name: "body" }).fill("no title here");
  await page.getByTestId("save-entry").click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("title");
  // Still on the create screen: nothing was persisted.
  await expect(page).toHaveURL(/\/content\/note\/new$/);
});

test("save + publish lands published in one step", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note/new");
  await page.getByRole("textbox", { name: "title *" }).fill("Published In One Step");
  await page.getByRole("button", { name: "Save + publish" }).click();

  // Navigated to the saved entry, already live.
  await expect(page).toHaveURL(savedEntryUrl("note"));
  await expect(page.getByTestId("toggle-publish")).toHaveText("Unpublish");
  await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue("published-in-one-step");

  const anon = await page.request.fetch("/api/content/note/slug/published-in-one-step", {
    headers: { cookie: "" },
  });
  expect(anon.status()).toBe(200);
});

test("unpublishing hides the entry from anonymous readers", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note");
  await page.getByRole("cell", { name: "Published In One Step" }).click();

  await page.getByTestId("toggle-publish").click();
  await expect(page.getByTestId("toggle-publish")).toHaveText("Publish");

  const anon = await page.request.fetch("/api/content/note/slug/published-in-one-step", {
    headers: { cookie: "" },
  });
  expect(anon.status()).toBe(404);

  // Put it back so the row is a published fixture for later assertions.
  await page.getByTestId("toggle-publish").click();
  await expect(page.getByTestId("toggle-publish")).toHaveText("Unpublish");
});

test("editing an entry stays on the page and persists", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note/new");
  await page.getByRole("textbox", { name: "title *" }).fill("Draft To Edit");
  await page.getByRole("textbox", { name: "body" }).fill("first version");
  await page.getByTestId("save-entry").click();
  await expect(page).toHaveURL(savedEntryUrl("note"));
  const url = page.url();

  // Update: the editor does not navigate away on save.
  await page.getByRole("textbox", { name: "body" }).fill("second version");
  await saveEntry(page, "note", "PATCH");
  await expect(page.getByTestId("save-entry")).toHaveText("Save");
  await expect(page).toHaveURL(url);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "body" })).toHaveValue("second version");
});

test("a slug can be moved, but not onto a taken one", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note");
  await page.getByRole("cell", { name: "Draft To Edit" }).click();
  await expect(page.getByRole("textbox", { name: "Slug" })).toHaveValue("draft-to-edit");

  await page.getByRole("textbox", { name: "Slug" }).fill("moved-somewhere-else");
  await saveEntry(page, "note", "PATCH");
  await expect(page.getByRole("alert")).toHaveCount(0);

  const moved = await page.request.get("/api/content/note/slug/moved-somewhere-else");
  expect(moved.status()).toBe(200);

  // Colliding with the other entry's slug is refused.
  await page.getByRole("textbox", { name: "Slug" }).fill("published-in-one-step");
  await page.getByTestId("save-entry").click();
  await expect(page.getByRole("alert")).toContainText("already exists");
});

test("a duplicate value in a unique field is refused", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note/new");
  await page.getByRole("textbox", { name: "title *" }).fill("Has A Code");
  await page.getByRole("textbox", { name: "code" }).fill("ABC-123");
  await page.getByTestId("save-entry").click();
  await expect(page).toHaveURL(savedEntryUrl("note"));

  await page.goto("/content/note/new");
  await page.getByRole("textbox", { name: "title *" }).fill("Wants The Same Code");
  await page.getByRole("textbox", { name: "code" }).fill("ABC-123");
  await page.getByTestId("save-entry").click();
  await expect(page.getByRole("alert")).toContainText('unique field "code"');
});

test("deleting an entry is confirmed, and cancellable", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/note");
  await page.getByRole("cell", { name: "Has A Code" }).click();
  const url = page.url();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete this entry?");
  await expect(page.getByRole("alertdialog")).toContainText("This cannot be undone.");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(url);

  await page.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete").click();

  // Back at the list, and the row is gone.
  await expect(page).toHaveURL(/\/content\/note$/);
  await expect(page.getByRole("cell", { name: "Has A Code" })).toHaveCount(0);
});

test("an entry with no title renders as untitled", async ({ page }) => {
  await signIn(page, ADMIN);
  // Only reachable through the API: the UI cannot submit an empty required field.
  await page.request.post("/api/content/note", {
    data: { slug: "untitled-one", data: { title: " " } },
  });
  await page.goto("/content/note");
  await expect(page.getByRole("cell", { name: "untitled" })).toBeVisible();
});
