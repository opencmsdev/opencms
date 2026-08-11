import { expect, test } from "@playwright/test";
import { ADMIN, confirmDialog, signIn } from "./helpers";

/**
 * The schema side of the admin: editing an existing type, reordering and
 * removing fields, and deleting a type. Uses a throwaway `widget` type so the
 * `article` type the rest of the suite depends on is never touched.
 */
test.describe.configure({ mode: "serial" });

const widgetCard = 'a[href="/types/widget"]';

test("build a throwaway type", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Content types" }).click();
  await page.getByRole("link", { name: "New type" }).click();

  await page.getByRole("textbox", { name: "Machine name" }).fill("widget");
  await page.getByRole("textbox", { name: "Label", exact: true }).fill("Widget");

  await page.getByTestId("add-field").click();
  const name = page.getByTestId("field-0");
  await name.getByRole("textbox", { name: "Field name" }).fill("name");
  await name.getByRole("checkbox", { name: "required" }).check();

  await page.getByTestId("add-field").click();
  const size = page.getByTestId("field-1");
  await size.getByRole("textbox", { name: "Field name" }).fill("size");
  await size.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "number", exact: true }).click();

  await page.getByTestId("save-type").click();
  await expect(page.getByRole("heading", { name: "Content types" })).toBeVisible();
  await expect(page.locator(widgetCard)).toContainText("2 fields");
});

test("the machine name is immutable once the type exists", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");

  const machineName = page.getByRole("textbox", { name: "Machine name" });
  await expect(machineName).toHaveValue("widget");
  await expect(machineName).toBeDisabled();
});

test("add a field to an existing type", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  await expect(page.getByTestId("field-1")).toBeVisible(); // definition loaded

  await page.getByTestId("add-field").click();
  const colour = page.getByTestId("field-2");
  await colour.getByRole("textbox", { name: "Field name" }).fill("colour");
  await colour.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "select", exact: true }).click();
  await colour.getByRole("textbox", { name: "Options" }).fill("red, blue");

  await page.getByTestId("save-type").click();
  await expect(page.locator(widgetCard)).toContainText("3 fields");

  // The entry editor picks the new field up without any further deploy.
  await page.goto("/content/widget/new");
  await expect(page.getByRole("combobox", { name: "colour" })).toBeVisible();
});

test("changing a field kind swaps the kind-specific input", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  const colour = page.getByTestId("field-2");
  await expect(colour.getByRole("textbox", { name: "Options" })).toBeVisible();

  await colour.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "reference", exact: true }).click();
  await expect(colour.getByRole("textbox", { name: "References type" })).toBeVisible();
  await expect(colour.getByRole("textbox", { name: "Options" })).toHaveCount(0);

  await colour.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "select", exact: true }).click();
  await expect(colour.getByRole("textbox", { name: "Options" })).toBeVisible();
});

test("reorder fields", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  await expect(page.getByTestId("field-2")).toBeVisible();

  // The ends of the list cannot move further.
  await expect(page.getByTestId("field-0").getByRole("button", { name: "Move up" })).toBeDisabled();
  await expect(
    page.getByTestId("field-2").getByRole("button", { name: "Move down" })
  ).toBeDisabled();

  await page.getByTestId("field-2").getByRole("button", { name: "Move up" }).click();
  // Cards are keyed by index, so the moved field is now field-1.
  await expect(page.getByTestId("field-1").getByRole("textbox", { name: "Field name" })).toHaveValue(
    "colour"
  );

  await page.getByTestId("save-type").click();
  await page.goto("/types/widget");
  await expect(page.getByTestId("field-1").getByRole("textbox", { name: "Field name" })).toHaveValue(
    "colour"
  );
});

test("remove a field", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  await expect(page.getByTestId("field-2")).toBeVisible();

  // Removal is immediate, with no confirmation step.
  await page.getByTestId("field-2").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("field-2")).toHaveCount(0);

  await page.getByTestId("save-type").click();
  await expect(page.locator(widgetCard)).toContainText("2 fields");
});

test("the default input takes the field's own shape", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  await expect(page.getByTestId("field-1")).toBeVisible();

  // A boolean default is a true/false choice, not a text box.
  await page.getByTestId("add-field").click();
  const flag = page.getByTestId("field-2");
  await flag.getByRole("textbox", { name: "Field name" }).fill("flag");
  await flag.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "boolean", exact: true }).click();
  const flagDefault = flag.getByRole("combobox", { name: "Default" });
  await expect(flagDefault).toBeVisible();
  await expect(flag.getByRole("textbox", { name: "Default" })).toHaveCount(0);
  await flagDefault.click();
  await page.getByRole("option", { name: "true", exact: true }).click();

  // A number default is a number input.
  await page.getByTestId("add-field").click();
  const rating = page.getByTestId("field-3");
  await rating.getByRole("textbox", { name: "Field name" }).fill("rating");
  await rating.getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "number", exact: true }).click();
  await rating.getByRole("spinbutton", { name: "Default" }).fill("5");

  await page.getByTestId("save-type").click();
  await expect(page.getByRole("heading", { name: "Content types" })).toBeVisible();

  // The server received real types: an entry missing both fields gets them.
  const created = await page.request.post("/api/content/widget", {
    data: { data: { name: "defaulted" } },
  });
  expect(created.status(), await created.text()).toBe(201);
  const entry = (await created.json()) as {
    id: string;
    data: { flag?: unknown; rating?: unknown };
  };
  expect(entry.data.flag).toBe(true);
  expect(entry.data.rating).toBe(5);
  // Clean up: the delete-type test below needs an entry-free widget.
  await page.request.delete(`/api/content/widget/${entry.id}`);

  // The stored defaults hydrate back into their own controls.
  await page.goto("/types/widget");
  await expect(
    page.getByTestId("field-2").getByRole("combobox", { name: "Default" })
  ).toContainText("true");
  await expect(
    page.getByTestId("field-3").getByRole("spinbutton", { name: "Default" })
  ).toHaveValue("5");

  // Switching kind clears a default typed for the previous kind.
  await page.getByTestId("field-3").getByRole("button", { name: "Kind" }).click();
  await page.getByRole("option", { name: "text", exact: true }).click();
  await expect(
    page.getByTestId("field-3").getByRole("textbox", { name: "Default" })
  ).toHaveValue("");

  // Put the type back the way the rest of the file expects.
  await page.getByTestId("field-3").getByRole("button", { name: "Remove" }).click();
  await page.getByTestId("field-2").getByRole("button", { name: "Remove" }).click();
  await page.getByTestId("save-type").click();
  await expect(page.locator(widgetCard)).toContainText("2 fields");
});

test("deleting a type is confirmed, and cancellable", async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto("/types/widget");
  await expect(page.getByTestId("save-type")).toBeVisible();

  // Cancel leaves everything alone.
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText('Delete "widget"?');
  await expect(page.getByRole("alertdialog")).toContainText(
    "The definition goes away; its entries stay in the database."
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.goto("/types");
  await expect(page.locator(widgetCard)).toBeVisible();

  // Confirming removes it.
  await page.goto("/types/widget");
  await page.getByRole("button", { name: "Delete" }).click();
  await confirmDialog(page, "Delete").click();
  await expect(page.getByRole("heading", { name: "Content types" })).toBeVisible();
  await expect(page.locator(widgetCard)).toHaveCount(0);

  // And the API agrees.
  const res = await page.request.get("/api/content-types/widget");
  expect(res.status()).toBe(404);
});
