import { expect, test } from "@playwright/test";

test.describe("Snippet library view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Snippets$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Expand voice shortcuts/i }),
    ).toBeVisible();
  });

  test("adds a new snippet and verifies it appears in the list", async ({
    page,
  }) => {
    await page.getByLabel("Trigger").fill("mysig");
    await page.getByLabel("Expansion").fill("Best regards, Ismail");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await expect(page.getByText("/mysig", { exact: true })).toBeVisible();
    await expect(page.getByText("Best regards, Ismail")).toBeVisible();
    await expect(page.getByText(/1 snippet/i)).toBeVisible();
  });

  test("searches and filters snippets", async ({ page }) => {
    await page.getByLabel("Trigger").fill("greet");
    await page.getByLabel("Expansion").fill("Hello there!");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await page.getByLabel("Trigger").fill("bye");
    await page.getByLabel("Expansion").fill("Goodbye!");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await expect(page.getByText(/2 snippets/i)).toBeVisible();

    await page
      .getByRole("textbox", { name: "Search snippets" })
      .fill("greet");
    await expect(page.getByText("Hello there!")).toBeVisible();
    await expect(page.getByText("Goodbye!")).not.toBeVisible();

    await page.getByRole("textbox", { name: "Search snippets" }).fill("");
    await expect(page.getByText("Hello there!")).toBeVisible();
    await expect(page.getByText("Goodbye!")).toBeVisible();
  });

  test("deletes a snippet", async ({ page }) => {
    await page.getByLabel("Trigger").fill("delme");
    await page.getByLabel("Expansion").fill("Delete this snippet");
    await page.getByRole("button", { name: /Add snippet/i }).click();
    await expect(page.getByText("/delme")).toBeVisible();
    await expect(page.getByText(/1 snippet/i)).toBeVisible();

    await page.getByRole("button", { name: /Remove/i }).first().click();
    await expect(page.getByText("/delme")).not.toBeVisible();
    await expect(page.getByText(/0 snippets/i)).toBeVisible();
  });
});
