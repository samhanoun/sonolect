import { expect, test } from "@playwright/test";

test.describe("Sonolect desktop web shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads the dashboard, command palette, settings, and transcript editor", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: "Voice OS" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Welcome back/i }),
    ).toBeVisible();
    await expect(page.getByText(/offline/i).first()).toBeVisible();

    await page.getByRole("button", { name: /Search a command/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder(/Search commands/i).fill("privacy");
    await page.getByRole("button", { name: /Privacy settings/i }).click();

    await expect(
      page.getByRole("heading", { name: /Voice control/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cloud" }).click();
    await expect(page.getByText(/cloud-assisted/i).first()).toBeVisible();
    await page.getByLabel("STT Language").selectOption("fr");

    await page.getByRole("button", { name: "Home" }).click();
    await page
      .getByRole("button", { name: /Préparer la démo investisseurs/i })
      .first()
      .click();
    const editor = page.getByLabel(/Transcription editor/i);
    await expect(editor).toBeVisible();
    await editor.fill("Sonolect full app E2E edited transcript");
    await expect(page.getByText(/6 words/i)).toBeVisible();

    await page.getByRole("button", { name: /Undo/i }).click();
    await expect(editor).not.toHaveValue(
      "Sonolect full app E2E edited transcript",
    );
    await page.getByRole("button", { name: /Redo/i }).click();
    await expect(editor).toHaveValue("Sonolect full app E2E edited transcript");

    await page.getByRole("button", { name: /^Dictionary$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Teach Sonolect names/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Snippets$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Expand voice shortcuts/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Setup$/i }).click();
    await expect(page.getByText(/Step 1 of 4/i)).toBeVisible();
    await page.getByRole("button", { name: /^Complete$/i }).click();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
  });
});
