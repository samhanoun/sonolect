import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installMockTauri } from "./support/mockTauri";
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

  test("transcripts export as subtitles with timed cues", async ({ page }) => {
    await nav(page, "Transcribe").click();
    await page
      .getByLabel("Transcript editor")
      .fill("Hello there. This is a subtitle test.");
    await page.getByLabel("Export format").selectOption("srt");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export transcript" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("sonolect-transcript.srt");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile((await file.path())!, "utf8");
    expect(content).toContain("1\n00:00:00,000 --> ");
    expect(content).toContain("This is a subtitle test.");
  });

  test("privacy settings keep a retention choice and delete all data", async ({
    page,
  }) => {
    await nav(page, "Settings").click();
    await page.getByLabel("Keep recordings").selectOption("30");
    await page.reload();
    await nav(page, "Settings").click();
    await expect(page.getByLabel("Keep recordings")).toHaveValue("30");

    page.once("dialog", (dialog) => void dialog.accept());
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "Delete all my data" }).click();
    await reloaded;
    const remaining = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("sonolect.")),
    );
    expect(remaining).toEqual([]);
    await nav(page, "Settings").click();
    await expect(page.getByLabel("Keep recordings")).toHaveValue("0");
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

/** Requests that leave the dev server, from the page and its workers. */
function outsideRequests(context: BrowserContext, baseURL: string | undefined) {
  const origin = new URL(baseURL!).origin;
  const seen: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (new URL(url).origin !== origin) seen.push(url);
  });
  return seen;
}

/** Whether the page asked for the microphone or started a recorder (see mockVoice). */
function microphoneUse(page: Page) {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __sonolectE2eMediaConstraints?: MediaStreamConstraints;
      __sonolectE2eRecorderStarted?: boolean;
    };
    return {
      asked: win.__sonolectE2eMediaConstraints !== undefined,
      recorded: win.__sonolectE2eRecorderStarted === true,
    };
  });
}

const PREVIEW_NOTICE =
  /^Browser preview\. You can type, edit and export text here\./;

test.describe("Sonolect dictation in the browser preview", () => {
  test("says it cannot transcribe before the microphone opens", async ({
    page,
    context,
    baseURL,
  }) => {
    const outside = outsideRequests(context, baseURL);
    await installMockVoiceCapture(page);
    await page.goto("/");
    const dock = page.locator(".studio-recording-dock");

    await page.getByRole("button", { name: /Start dictating/ }).click();
    await expect(dock).toContainText("Recording needs attention");
    await expect(dock).toContainText(
      "The browser preview cannot transcribe speech. Use the Sonolect desktop app to record and transcribe. Nothing was recorded or sent.",
    );
    await expect(
      page.getByRole("button", { name: /Stop recording/ }),
    ).toHaveCount(0);
    await expect(page.getByText(PREVIEW_NOTICE)).toBeVisible();

    // Cloud enabled, but this build has no Sonolect API: the keys refuse too.
    await dock.getByRole("button", { name: "Dismiss" }).click();
    await expect(dock).toHaveCount(0);
    await page.getByLabel("Processing mode").selectOption("cloud");
    await expect(page.getByText(PREVIEW_NOTICE)).toBeVisible();
    await page.keyboard.press("Control+Shift+M");
    await expect(dock).toContainText(
      "The browser preview cannot transcribe speech.",
    );
    await dock.getByRole("button", { name: "Dismiss" }).click();
    await expect(dock).toHaveCount(0);
    await page.keyboard.press("Control+Shift+V");
    await expect(dock).toContainText(
      "The browser preview cannot transcribe speech.",
    );

    expect(await microphoneUse(page)).toEqual({
      asked: false,
      recorded: false,
    });
    expect(outside).toEqual([]);
  });

  test("refuses an audio file before reading it", async ({
    page,
    context,
    baseURL,
  }) => {
    const outside = outsideRequests(context, baseURL);
    await page.addInitScript(() => {
      // Counts every read of a file the page was given.
      const win = window as typeof window & { __sonolectE2eFileReads?: number };
      win.__sonolectE2eFileReads = 0;
      const watch = (
        prototype: object,
        methods: string[],
        isFile: (target: unknown) => boolean,
      ) => {
        const methodsOf = prototype as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        for (const method of methods) {
          const original = methodsOf[method];
          if (typeof original !== "function") continue;
          methodsOf[method] = function (this: unknown, ...args: unknown[]) {
            if (isFile(this) || args.some(isFile))
              win.__sonolectE2eFileReads! += 1;
            return original.apply(this, args);
          };
        }
      };
      const isFile = (target: unknown) => target instanceof File;
      watch(
        Blob.prototype,
        ["arrayBuffer", "bytes", "stream", "text", "slice"],
        isFile,
      );
      watch(
        FileReader.prototype,
        [
          "readAsArrayBuffer",
          "readAsBinaryString",
          "readAsDataURL",
          "readAsText",
        ],
        isFile,
      );
    });
    await page.goto("/");
    await nav(page, "Transcribe").click();
    await expect(page.getByText(PREVIEW_NOTICE)).toBeVisible();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import audio" }).click();
    await (
      await chooser
    ).setFiles(fileURLToPath(new URL("./fixtures/tone.wav", import.meta.url)));
    await expect(
      page.getByRole("status").filter({
        hasText:
          "The browser preview cannot transcribe audio files. Open this file in the Sonolect desktop app. Nothing was sent.",
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Transcript editor")).toHaveValue("");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __sonolectE2eFileReads?: number })
            .__sonolectE2eFileReads,
      ),
    ).toBe(0);
    expect(outside).toEqual([]);
  });

  test("leaves the microphone test free after it refuses", async ({ page }) => {
    await page.goto("/");
    const dock = page.locator(".studio-recording-dock");
    await page.getByRole("button", { name: /Start dictating/ }).click();
    await expect(dock).toContainText(
      "The browser preview cannot transcribe speech.",
    );

    // The refusal stays on the dock, and the test still checks a microphone.
    await nav(page, "Settings").click();
    const card = page.locator("section", {
      has: page.getByRole("heading", { name: "Microphone", exact: true }),
    });
    await expect(
      card.getByRole("button", { name: "Test microphone" }),
    ).toBeEnabled();
    await card.getByRole("button", { name: "Test microphone" }).click();
    await expect(card.getByText("Nothing is recorded.")).toBeVisible();
    const meter = card.getByRole("meter", { name: "Microphone level" });
    // Chromium's synthetic microphone beeps: the meter has to move.
    await expect
      .poll(async () => Number(await meter.getAttribute("aria-valuenow")), {
        timeout: 10_000,
        intervals: [50],
      })
      .toBeGreaterThan(5);
    await card.getByRole("button", { name: "Stop test" }).click();
    await expect(dock).toContainText(
      "The browser preview cannot transcribe speech.",
    );
  });
});

test.describe("Sonolect dictation in the browser preview, in French", () => {
  test.use({ locale: "fr-FR" });

  test("says so in French before the microphone opens", async ({
    page,
    context,
    baseURL,
  }) => {
    const outside = outsideRequests(context, baseURL);
    await installMockVoiceCapture(page);
    await page.goto("/");
    const dock = page.locator(".studio-recording-dock");

    await page.getByRole("button", { name: /Commencer à dicter/ }).click();
    await expect(dock).toContainText(
      "L'enregistrement demande votre attention",
    );
    await expect(dock).toContainText(
      "L'aperçu dans le navigateur ne peut pas transcrire la parole. Utilisez l'application de bureau Sonolect pour enregistrer et transcrire. Rien n'a été enregistré ni envoyé.",
    );
    await expect(
      page.getByText(
        /^Aperçu dans le navigateur\. Vous pouvez saisir, modifier et exporter du texte ici\./,
      ),
    ).toBeVisible();

    expect(await microphoneUse(page)).toEqual({
      asked: false,
      recorded: false,
    });
    expect(outside).toEqual([]);
  });
});

test.describe("Sonolect dictation without microphone APIs", () => {
  test("explains that recording is unavailable instead of failing silently", async ({
    page,
  }) => {
    // In the app: the browser preview refuses before it looks for a microphone.
    await installMockTauri(page, []);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Start dictating/ }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Recording needs attention");
    await expect(dock).toContainText(
      "Microphone capture is not available in this environment.",
    );
  });
});
