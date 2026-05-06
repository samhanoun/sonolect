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
    await page.getByLabel("When I say").fill("sonolect");
    await page.getByLabel("Write").fill("Sonolect");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await expect(page.getByText("sonolect")).toBeVisible();
    await expect(page.getByText("Sonolect")).toBeVisible();
    await expect(page.getByText(/1 entry/i)).toBeVisible();
  });

  test("searches and filters dictionary entries", async ({ page }) => {
    await page.getByLabel("When I say").fill("flow");
    await page.getByLabel("Write").fill("Wispr Flow");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await page.getByLabel("When I say").fill("claw");
    await page.getByLabel("Write").fill("OpenClaw");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();

    await expect(page.getByText(/2 entries/i)).toBeVisible();

    await page.getByLabel("Search dictionary").fill("flow");
    await expect(page.getByText("Wispr Flow")).toBeVisible();
    await expect(page.getByText("OpenClaw")).not.toBeVisible();

    await page.getByLabel("Search dictionary").fill("");
    await expect(page.getByText("Wispr Flow")).toBeVisible();
    await expect(page.getByText("OpenClaw")).toBeVisible();
  });

  test("deletes a dictionary entry", async ({ page }) => {
    await page.getByLabel("When I say").fill("old");
    await page.getByLabel("Write").fill("Old Entry");
    await page.getByRole("button", { name: /Add dictionary entry/i }).click();
    await expect(page.getByText("Old Entry")).toBeVisible();
    await expect(page.getByText(/1 entry/i)).toBeVisible();

    await page
      .getByRole("button", { name: /Remove dictionary entry old/i })
      .click();
    await expect(page.getByText("Old Entry")).not.toBeVisible();
    await expect(page.getByText(/0 entries/i)).toBeVisible();
  });
});
