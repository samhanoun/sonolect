import { expect, test, type Page } from "@playwright/test";
import { installMockVoiceCapture } from "./support/mockVoice";

const PAGES: Array<[string, RegExp]> = [
  ["Overview", /Make room for your thoughts/],
  ["Transcribe", /Find your flow/],
  ["Text to speech", /Give your writing a voice/],
  ["Library", /Your voice library/],
  ["Dictionary", /./],
  ["Snippets", /./],
  ["Models & voices", /Your models, your choice/],
  ["Settings", /Make yourself at home/],
];

function nav(page: Page, name: string) {
  return page
    .getByRole("navigation")
    .getByRole("button", {
      name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`),
    })
    .first();
}

test.describe("Sonolect studio", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("every sidebar page opens without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [name, heading] of PAGES) {
      await nav(page, name).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    expect(errors).toEqual([]);
  });

  test("quick navigation opens with Ctrl+K and jumps to a page", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Control+k");
    const finder = page.getByLabel("Find a page");
    await expect(finder).toBeVisible();
    await finder.fill("library");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Your voice library/,
    );
  });

  test("processing mode switches between local and cloud", async ({ page }) => {
    const mode = page.getByLabel("Processing mode");
    await expect(mode).toHaveValue("local");
    await mode.selectOption("cloud");
    await expect(page.getByText("Cloud enabled").first()).toBeVisible();
    await mode.selectOption("local");
    await expect(page.getByText("Local processing").first()).toBeVisible();
  });

  test("transcript editor supports typing, cleanup, undo and redo", async ({
    page,
  }) => {
    await nav(page, "Transcribe").click();
    const editor = page.getByLabel("Transcript editor");
    await editor.fill("hello  world   from sonolect");
    await expect(page.getByText("4 words")).toBeVisible();
    await page.getByRole("button", { name: "Clean up locally" }).click();
    await expect(editor).toHaveValue("Hello world from sonolect.");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor).toHaveValue("hello  world   from sonolect");
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(editor).toHaveValue("Hello world from sonolect.");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export transcript" }).click();
    expect((await download).suggestedFilename()).toBe(
      "sonolect-transcript.txt",
    );
  });

  test("dictionary entries are saved and applied by cleanup", async ({
    page,
  }) => {
    await nav(page, "Dictionary").click();
    await page
      .getByPlaceholder("A word that needs correcting")
      .fill("sono lect");
    await page.getByPlaceholder("How it should appear").fill("Sonolect");
    await page.getByRole("button", { name: "Add word" }).click();
    await expect(page.getByRole("main").getByText("Sonolect")).toBeVisible();

    await page.reload();
    await nav(page, "Dictionary").click();
    await expect(page.getByRole("main").getByText("Sonolect")).toBeVisible();

    await nav(page, "Transcribe").click();
    await page.getByLabel("Transcript editor").fill("i love sono lect");
    await page.getByRole("button", { name: "Clean up locally" }).click();
    await expect(page.getByLabel("Transcript editor")).toHaveValue(/Sonolect/);
  });

  test("snippets can be added", async ({ page }) => {
    await nav(page, "Snippets").click();
    await page.getByPlaceholder("/signature").fill("sig");
    await page.getByPlaceholder("Your reusable text").fill("Best regards");
    await page.getByRole("button", { name: "Add snippet" }).click();
    await expect(
      page.getByRole("main").getByText("Best regards"),
    ).toBeVisible();
  });

  test("text to speech explains what is missing beside the button", async ({
    page,
  }) => {
    await nav(page, "Text to speech").click();
    const generate = page.getByRole("button", { name: "Generate speech" });
    await expect(generate).toBeDisabled();
    await page.getByLabel("Text to speak").fill("Hello world");
    await generate.click();
    const status = page.getByRole("status").filter({ hasText: /model/i });
    await expect(status).toBeVisible();
    await expect(status).toBeInViewport();
    await expect(status).not.toHaveText(/^Error:/);
  });

  test("models page lists both providers and task tabs", async ({ page }) => {
    await nav(page, "Models & voices").click();
    await expect(page.getByText("OpenRouter").first()).toBeVisible();
    await expect(page.getByText("OpenCode Zen").first()).toBeVisible();
    for (const tab of ["Speech to text", "Text to speech", "Text editing"]) {
      await page
        .getByRole("main")
        .getByRole("button", { name: tab, exact: true })
        .click();
      await expect(
        page.getByRole("main").getByRole("button", { name: tab, exact: true }),
      ).toHaveClass(/active/);
    }
  });
});

test.describe("Sonolect dictation in the browser preview", () => {
  test("records, stops and explains that local speech needs the Windows app", async ({
    page,
  }) => {
    await installMockVoiceCapture(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Start dictating/ }).click();
    await expect(
      page.getByRole("button", { name: /Stop recording/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Stop recording/ }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /runs in the Windows app/ })
        .first(),
    ).toBeVisible();
    const started = await page.evaluate(
      () =>
        (window as typeof window & { __sonolectE2eRecorderStarted?: boolean })
          .__sonolectE2eRecorderStarted,
    );
    expect(started).toBe(true);
  });
});

test.describe("Sonolect dictation without microphone APIs", () => {
  test("explains that recording is unavailable instead of failing silently", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Start dictating/ }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByRole("status").first()).not.toBeEmpty();
  });
});
