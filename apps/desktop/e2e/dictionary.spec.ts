import { expect, test } from "@playwright/test";

test.describe("Dictionary management view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Dictionary$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Teach Sonolect names/i }),
    ).toBeVisible();
  });

  test("adds a new dictionary entry and verifies it appears in the list", async ({
    page,
  }) => {
    await page.getByLabel("When I say").fill("zephyr");
    await page.getByLabel("Write").fill("Zephyr Corp");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await expect(page.getByText("zephyr", { exact: true })).toBeVisible();
    await expect(page.getByText("Zephyr Corp", { exact: true })).toBeVisible();
    await expect(page.getByText(/1 entry/i)).toBeVisible();
  });

  test("searches and filters dictionary entries", async ({ page }) => {
    await page.getByLabel("When I say").fill("alphaword");
    await page.getByLabel("Write").fill("Alpha Result");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await page.getByLabel("When I say").fill("betaword");
    await page.getByLabel("Write").fill("Beta Result");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await expect(page.getByText(/2 entries/i)).toBeVisible();

    await page
      .getByRole("textbox", { name: "Search dictionary" })
      .fill("alphaword");
    await expect(page.getByText("Alpha Result")).toBeVisible();
    await expect(page.getByText("Beta Result")).not.toBeVisible();

    await page.getByRole("textbox", { name: "Search dictionary" }).fill("");
    await expect(page.getByText("Alpha Result")).toBeVisible();
    await expect(page.getByText("Beta Result")).toBeVisible();
  });

  test("deletes a dictionary entry", async ({ page }) => {
    await page.getByLabel("When I say").fill("oldword");
    await page.getByLabel("Write").fill("Old Entry");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();
    await expect(page.getByText("Old Entry")).toBeVisible();
    await expect(page.getByText(/1 entry/i)).toBeVisible();

    await page.getByRole("button", { name: /Remove oldword/i }).click();
    await expect(page.getByText("Old Entry")).not.toBeVisible();
  });
});
