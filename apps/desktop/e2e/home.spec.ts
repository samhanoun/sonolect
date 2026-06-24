import { expect, test } from "@playwright/test";

test.describe("Sonolect desktop web shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("loads the dashboard, command palette, settings, and transcript editor", async ({
    page,
  }) => {
    await expect(page.getByText("Sonolect").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Dictation/i }),
    ).toBeVisible();
    await expect(page.getByText(/offline/i).first()).toBeVisible();

    await page.getByRole("button", { name: /Search a command/i }).click();
    await expect(page.getByRole("dialog", { name: /command/i })).toBeVisible();
    await page.getByPlaceholder(/Search commands/i).fill("privacy");
    await page.getByRole("button", { name: "Open settings" }).click();

    await expect(
      page.getByRole("heading", { name: /Preferences/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cloud-assisted" }).click();
    await expect(page.getByText(/cloud-assisted/i).first()).toBeVisible();
    await page.getByLabel(/Speech-to-text language/i).selectOption("fr");

    await page.getByRole("button", { name: "History" }).click();
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

    await expect(
      page.getByRole("region", { name: /Wispr-style polished preview/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Dictionary$/i }).click();
    await expect(
      page.getByRole("heading", { name: /Personal/i }),
    ).toBeVisible();
    await page.getByLabel(/How you speak it/i).fill("flow");
    await page.getByLabel(/How it should write/i).fill("Wispr Flow");
    await page.getByRole("button", { name: /Add to Dictionary/i }).click();
    await expect(page.getByText("Wispr Flow")).toBeVisible();

    await page.getByRole("button", { name: /Snippets/i }).click();
    await expect(
      page.getByRole("heading", { name: /Shortcuts & Snippets/i }),
    ).toBeVisible();
    await page.getByLabel(/Shortcut Trigger Phrase/i).fill("sig");
    await page.getByLabel(/Expanded Content Body/i).fill("Best, Ismail");
    await page.getByRole("button", { name: /Register Shortcut/i }).click();
    await expect(page.getByText("/sig", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Setup/i }).click();
    await page.getByText("Microphone permission").click();
    await expect(page.getByText(/25% complete/i)).toBeVisible();
  });
});
