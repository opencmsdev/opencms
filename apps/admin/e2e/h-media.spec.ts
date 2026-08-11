import { expect, test } from "@playwright/test";
import {
  ADMIN,
  confirmDialog,
  createType,
  deleteType,
  saveEntry,
  savedEntryUrl,
  signIn,
} from "./helpers";

/**
 * The media library (M5): uploading through the library screen, serving files
 * publicly, picking media from an entry's field, and deletion. Owns the
 * `postcard` type; the dev server runs the in-memory storage connector, so the
 * library is enabled and empty when this file starts.
 */
test.describe.configure({ mode: "serial" });

// A 1x1 transparent PNG, so image previews exercise a real decodable image.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, ADMIN);
  await createType(page, {
    name: "postcard",
    label: "Postcard",
    fields: [
      { name: "title", kind: "text", required: true },
      { name: "photo", kind: "media" },
    ],
  });
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, ADMIN);
  // A type with entries refuses deletion (409), so clear the entries first.
  const list = await page.request.get("/api/content/postcard?limit=200");
  const { items } = (await list.json()) as { items: Array<{ id: string }> };
  for (const item of items) {
    await page.request.delete(`/api/content/postcard/${item.id}`);
  }
  await deleteType(page, "postcard");
  await page.close();
});

test("the media library appears in the nav and starts empty", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Media" }).click();
  await expect(page).toHaveURL(/\/media$/);
  await expect(page.getByText("No media yet")).toBeVisible();
});

test("uploading through the library shows the file and serves it publicly", async ({
  page,
  playwright,
}) => {
  await signIn(page, ADMIN);
  await page.goto("/media");

  const uploaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/media")
  );
  await page.getByTestId("media-upload-input").setInputFiles({
    name: "sunset.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  const res = await uploaded;
  expect(res.status()).toBe(201);
  const { key } = (await res.json()) as { key: string };

  // The fresh upload lands at the top of the grid, thumbnail and all.
  const card = page.getByTestId("media-object").first();
  await expect(card).toContainText(/sunset-[a-z0-9-]+\.png/);
  await expect(card.getByRole("img")).toBeVisible();

  // Anyone can read it back: a request context with no cookies at all.
  const anon = await playwright.request.newContext({
    baseURL: "http://localhost:3999",
  });
  const served = await anon.get(`/api/media/${key}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("image/png");
  expect((await served.body()).equals(PIXEL)).toBe(true);
  await anon.dispose();
});

test("an entry's media field picks from the library", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/postcard/new");
  await page.getByLabel("title *").fill("Beach day");

  await page.getByTestId("browse-photo").click();
  const dialog = page.getByRole("dialog", { name: "Choose media" });
  await expect(dialog).toBeVisible();

  // Upload from inside the picker, then select the fresh file.
  const uploaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/media")
  );
  await dialog.getByTestId("media-upload-input").setInputFiles({
    name: "beach.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await uploaded;
  await dialog.getByTestId("media-select").first().click();
  await expect(dialog).toBeHidden();

  const field = page.getByLabel("photo");
  await expect(field).toHaveValue(/beach-[a-z0-9-]+\.png/);
  const pickedKey = await field.inputValue();

  await saveEntry(page, "postcard", "POST");
  await expect(page).toHaveURL(savedEntryUrl("postcard"));

  // The stored entry holds the storage key, and a reload hydrates it back.
  await page.reload();
  await expect(page.getByLabel("photo")).toHaveValue(pickedKey);
  await expect(page.getByRole("link", { name: "open file" })).toBeVisible();
});

test("deleting from the library removes the object and its bytes", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/media");

  const victim = page.getByTestId("media-object").first();
  await expect(victim).toBeVisible();
  const name = await victim.locator(".font-mono").first().innerText();

  await victim.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete").click();
  await expect(page.getByTestId("media-object").filter({ hasText: name })).toHaveCount(0);

  // Bytes are gone too, not just the listing row.
  const res = await page.request.get(`/api/media/${latestKeyFromName(name)}`);
  expect(res.status()).toBe(404);
});

/**
 * The grid shows the key's basename; the serve route needs the whole key.
 * Uploads in this file all land in the current year/month prefix.
 */
function latestKeyFromName(basename: string): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${basename}`;
}
