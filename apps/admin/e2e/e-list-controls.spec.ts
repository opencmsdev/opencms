import { expect, test } from "@playwright/test";
import { ADMIN, createType, seedEntries, signIn } from "./helpers";

/**
 * The entry list's controls: pagination, the status filter and the search box.
 * These need more rows than the rest of the suite produces, so this file seeds
 * its own `pager` type over the API.
 */
test.describe.configure({ mode: "serial" });

const PAGE_SIZE = 25;
const DRAFTS = 20;
const PUBLISHED = 10;

test("seed a type with enough entries to paginate", async ({ page }) => {
  await signIn(page, ADMIN);
  await createType(page, {
    name: "pager",
    label: "Pager",
    fields: [{ name: "title", kind: "text", required: true }],
  });

  await seedEntries(
    page,
    "pager",
    Array.from({ length: DRAFTS }, (_, i) => ({
      data: { title: `Draft ${String(i).padStart(2, "0")}` },
      status: "draft" as const,
    }))
  );
  await seedEntries(
    page,
    "pager",
    Array.from({ length: PUBLISHED }, (_, i) => ({
      data: { title: `Live ${String(i).padStart(2, "0")}` },
      status: "published" as const,
    }))
  );

  await page.goto("/content/pager");
  await expect(page.getByText(`${DRAFTS + PUBLISHED} total`)).toBeVisible();
});

test("pagination walks the result set", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/pager");

  await expect(page.getByText("page 1 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(page.getByRole("row")).toHaveCount(PAGE_SIZE + 1); // + header row

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]page=1/);
  await expect(page.getByText("page 2 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(page.getByRole("row")).toHaveCount(DRAFTS + PUBLISHED - PAGE_SIZE + 1);

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByText("page 1 / 2")).toBeVisible();
});

test("the status filter narrows the set and resets the page", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/pager?page=1");
  await expect(page.getByText("page 2 / 2")).toBeVisible();

  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "published", exact: true }).click();

  await expect(page.getByText(`${PUBLISHED} total`)).toBeVisible();
  // Back under one page, so the pagination block disappears entirely.
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]page=1/);

  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "draft", exact: true }).click();
  await expect(page.getByText(`${DRAFTS} total`)).toBeVisible();

  await page.getByRole("combobox", { name: "Filter by status" }).click();
  await page.getByRole("option", { name: "all statuses", exact: true }).click();
  await expect(page.getByText(`${DRAFTS + PUBLISHED} total`)).toBeVisible();
});

test("search filters the current page without changing the server total", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/pager");
  await expect(page.getByText("page 1 / 2")).toBeVisible();

  await page.getByPlaceholder("Filter by slug or title...").fill("Live 0");
  await expect(page).toHaveURL(/[?&]q=/);

  // Search is client-side over the loaded page, so the count is unchanged.
  await expect(page.getByText(`${DRAFTS + PUBLISHED} total`)).toBeVisible();
  const rows = await page.getByRole("row").count();
  expect(rows).toBeGreaterThan(1);
  expect(rows).toBeLessThan(PAGE_SIZE + 1);

  await page.getByPlaceholder("Filter by slug or title...").fill("");
  await expect(page.getByRole("row")).toHaveCount(PAGE_SIZE + 1);
});

test("search matches titles case-insensitively", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/pager?status=published");
  await expect(page.getByText(`${PUBLISHED} total`)).toBeVisible();

  await page.getByPlaceholder("Filter by slug or title...").fill("live 03");
  await expect(page.getByRole("cell", { name: "Live 03" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2); // header + one match
});

test("a search that matches nothing empties the table but keeps the total", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/content/pager");
  await page.getByPlaceholder("Filter by slug or title...").fill("no-such-entry-anywhere");

  await expect(page.getByRole("row")).toHaveCount(1); // header only
  await expect(page.getByText(`${DRAFTS + PUBLISHED} total`)).toBeVisible();
});

test("a type with no entries shows its empty state", async ({ page }) => {
  await signIn(page, ADMIN);
  await createType(page, {
    name: "hollow",
    label: "Hollow",
    fields: [{ name: "title", kind: "text" }],
  });

  await page.goto("/content/hollow");
  // EmptyState renders its title as styled text, not a heading element.
  await expect(page.getByText("No entries yet")).toBeVisible();
  await expect(page.getByText("Write the first hollow.")).toBeVisible();
});
