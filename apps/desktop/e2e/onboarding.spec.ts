import { expect, test } from "@playwright/test";

test.describe("Onboarding wizard view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Setup$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Complete setup before relying/i }),
    ).toBeVisible();
  });

  test("displays progress indicator and current step", async ({ page }) => {
    await expect(page.getByText(/Step 1 of 4/i)).toBeVisible();
    await expect(page.getByText(/0% complete/i)).toBeVisible();
  });

  test("completes a step and advances the wizard", async ({ page }) => {
    await expect(page.getByText(/Step 1 of 4/i)).toBeVisible();
    await page.getByRole("button", { name: /^Complete$/i }).click();

    await expect(page.getByText(/Step 2 of 4/i)).toBeVisible();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
  });

  test("skips a step when allowed", async ({ page }) => {
    await page.getByRole("button", { name: /^Complete$/i }).click();
    await expect(page.getByText(/Step 2 of 4/i)).toBeVisible();

    await page.getByRole("button", { name: /^Skip$/i }).click();
    await expect(page.getByText(/Step 3 of 4/i)).toBeVisible();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
  });

  test("reaches the completion screen after all steps", async ({ page }) => {
    await page.getByRole("button", { name: /^Complete$/i }).click();
    await page.getByRole("button", { name: /^Skip$/i }).click();
    await page.getByRole("button", { name: /^Skip$/i }).click();
    await page.getByRole("button", { name: /^Complete$/i }).click();

    await expect(
      page.getByRole("heading", { name: /Sonolect is ready for dictation/i }),
    ).toBeVisible();
  });
});
