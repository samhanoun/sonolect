import { expect, test } from "@playwright/test";

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("opens via the toolbar button and displays all commands", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Search a command/i }).click();
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();

    // Verify commands from different categories are listed
    await expect(
      page.getByRole("button", { name: /Start Recording/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open Dictionary/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Privacy Settings/i }),
    ).toBeVisible();
  });

  test("opens via Ctrl+K keyboard shortcut", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();
  });

  test("closes via Escape key", async ({ page }) => {
    await page.getByRole("button", { name: /Search a command/i }).click();
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: /command/i }),
    ).not.toBeVisible();
  });

  test("searches for a command and filters the list", async ({ page }) => {
    await page.getByRole("button", { name: /Search a command/i }).click();
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();

    await page.getByPlaceholder(/Search commands/i).fill("dictionary");
    await expect(
      page.getByRole("button", { name: /Open Dictionary/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Import Dictionary/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Export Dictionary/i }),
    ).toBeVisible();

    // Non-matching commands should be filtered out
    await expect(
      page.getByRole("button", { name: /Start Recording/i }),
    ).not.toBeVisible();
  });

  test("shows no-results message for unmatched search", async ({ page }) => {
    await page.getByRole("button", { name: /Search a command/i }).click();
    await page.getByPlaceholder(/Search commands/i).fill("zzzznotacommand");
    await expect(page.getByText(/No results/i)).toBeVisible();
  });

  test("executes a command and closes the palette", async ({ page }) => {
    await page.getByRole("button", { name: /Search a command/i }).click();
    await page.getByPlaceholder(/Search commands/i).fill("privacy");
    await page.getByRole("button", { name: /Privacy Settings/i }).click();

    // Palette should close
    await expect(
      page.getByRole("dialog", { name: /command/i }),
    ).not.toBeVisible();

    // The Privacy Settings command navigates to settings view
    await expect(
      page.getByRole("heading", { name: /Voice control/i }),
    ).toBeVisible();
  });
});
