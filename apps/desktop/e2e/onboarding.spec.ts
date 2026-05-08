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
    await expect(page.getByText(/Allow Microphone Access/i)).toBeVisible();
  });

  test("completes a step and advances the wizard", async ({ page }) => {
    await expect(page.getByText(/Step 1 of 4/i)).toBeVisible();
    await page.getByRole("button", { name: /^Complete$/i }).click();

    await expect(page.getByText(/Step 2 of 4/i)).toBeVisible();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
    await expect(page.getByText(/Learn Your Shortcuts/i)).toBeVisible();
  });

  test("skips a step when allowed", async ({ page }) => {
    // Step 1 (micPermission) does not allow skip — complete it first
    await page.getByRole("button", { name: /^Complete$/i }).click();

    // Step 2 (shortcutPrimer) allows skip
    await expect(page.getByText(/Learn Your Shortcuts/i)).toBeVisible();
    await page.getByRole("button", { name: /^Skip$/i }).click();

    // Wizard advances — step 2 was skipped, so progress stays at 25%
    await expect(page.getByText(/Step 3 of 4/i)).toBeVisible();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
  });

  test("reaches the completion screen after all steps", async ({ page }) => {
    // Complete step 1 (micPermission)
    await page.getByRole("button", { name: /^Complete$/i }).click();
    // Skip step 2 (shortcutPrimer)
    await page.getByRole("button", { name: /^Skip$/i }).click();
    // Skip step 3 (whisperSetup)
    await page.getByRole("button", { name: /^Skip$/i }).click();
    // Complete step 4 (privacyChoice)
    await page.getByRole("button", { name: /^Complete$/i }).click();

    await expect(
      page.getByRole("heading", { name: /Sonolect is ready for dictation/i }),
    ).toBeVisible();
    await expect(page.getByText(/2\/4 steps completed/i)).toBeVisible();
  });
});
