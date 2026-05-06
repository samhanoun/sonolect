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
    await page.getByLabel("Trigger").fill("sig");
    await page.getByLabel("Expansion").fill("Best, Ismail");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await expect(page.getByText("/sig", { exact: true })).toBeVisible();
    await expect(page.getByText("Best, Ismail")).toBeVisible();
    await expect(page.getByText(/1 snippet/i)).toBeVisible();
  });

  test("searches and filters snippets", async ({ page }) => {
    await page.getByLabel("Trigger").fill("sig");
    await page.getByLabel("Expansion").fill("Best, Ismail");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await page.getByLabel("Trigger").fill("addr");
    await page.getByLabel("Expansion").fill("123 Main St");
    await page.getByRole("button", { name: /Add snippet/i }).click();

    await expect(page.getByText(/2 snippets/i)).toBeVisible();

    await page.getByRole("textbox", { name: "Search snippets" }).fill("sig");
    await expect(page.getByText("/sig", { exact: true })).toBeVisible();
    await expect(page.getByText("/addr")).not.toBeVisible();

    await page.getByRole("textbox", { name: "Search snippets" }).fill("");
    await expect(page.getByText("/sig", { exact: true })).toBeVisible();
    await expect(page.getByText("/addr")).toBeVisible();
  });

  test("deletes a snippet", async ({ page }) => {
    await page.getByLabel("Trigger").fill("rm");
    await page.getByLabel("Expansion").fill("Remove me");
    await page.getByRole("button", { name: /Add snippet/i }).click();
    await expect(page.getByText("/rm")).toBeVisible();
    await expect(page.getByText(/1 snippet/i)).toBeVisible();

    await page.getByRole("button", { name: /Remove snippet \/rm/i }).click();
    await expect(page.getByText("/rm")).not.toBeVisible();
    await expect(page.getByText(/0 snippets/i)).toBeVisible();
  });
});
