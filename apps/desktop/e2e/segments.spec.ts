import { expect, test, type Page } from "@playwright/test";
import {
  installMockTauri,
  nativeCalls,
  type MockCapture,
} from "./support/mockTauri";
import { played, watchPlayback } from "./support/playback";

/** A navigation entry; its label may be followed by a description. */
function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

const segmentList = (page: Page) =>
  page.getByRole("list", { name: "Transcript segments" });
const segmentText = (page: Page, number: number) =>
  page.getByLabel(`Text of segment ${number}`, { exact: true });

const meeting: MockCapture = {
  id: "1700000000000-42",
  createdAtMs: Date.UTC(2026, 10, 19, 9, 30),
  durationMs: 1000,
  transcript: "Good morning everyone. Shall we start? Yes, let us begin.",
  error: null,
  language: "en",
  segments: [
    { startMs: 0, endMs: 300, text: "Good morning everyone." },
    { startMs: 300, endMs: 600, text: "Shall we start?" },
    { startMs: 600, endMs: 1000, text: "Yes, let us begin." },
  ],
};

test.describe("segment editor", () => {
  test("typed text can be merged, split, labelled and reordered", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await nav(page, "Transcribe").click();
    const editor = page.getByLabel("Transcript editor");
    await editor.fill("First point. Second point. Third point.");

    await page.getByRole("button", { name: "Segments", exact: true }).click();
    await expect(segmentList(page).getByRole("listitem")).toHaveCount(3);
    // Typed text has no audio, so there is nothing to play.
    await expect(page.getByRole("button", { name: /^Play from/ })).toHaveCount(
      0,
    );

    const merge = page.getByRole("button", { name: "Merge", exact: true });
    await expect(merge).toBeDisabled();
    await page.getByLabel("Select segment 1", { exact: true }).check();
    await page.getByLabel("Select segment 2", { exact: true }).check();
    await expect(page.getByText("2 segments selected")).toBeVisible();
    await merge.click();
    await expect(segmentList(page).getByRole("listitem")).toHaveCount(2);
    await expect(segmentText(page, 1)).toHaveValue(
      "First point. Second point.",
    );

    // A speaker name with a space, saved when the field is left.
    const speaker = page.getByLabel("Speaker of segment 1", { exact: true });
    await speaker.fill("Ana Maria");
    await speaker.press("Enter");
    await expect(speaker).toHaveValue("Ana Maria");
    await expect(segmentList(page).getByRole("listitem").first()).toHaveClass(
      /speaker-0/,
    );

    await page.getByLabel("Move segment 2 up", { exact: true }).click();
    await expect(segmentText(page, 1)).toHaveValue("Third point.");
    await expect(
      page.getByLabel("Speaker of segment 2", { exact: true }),
    ).toHaveValue("Ana Maria");

    // Split at the cursor with Ctrl+Enter.
    await segmentText(page, 2).focus();
    await segmentText(page, 2).evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(12, 12),
    );
    await page.keyboard.press("Control+Enter");
    await expect(segmentList(page).getByRole("listitem")).toHaveCount(3);
    await expect(segmentText(page, 2)).toHaveValue("First point.");
    await expect(segmentText(page, 3)).toHaveValue("Second point.");

    // Label two segments at once.
    await page.getByLabel("Select segment 1", { exact: true }).check();
    await page.getByLabel("Select segment 3", { exact: true }).check();
    await expect(merge).toBeDisabled();
    await page.getByLabel("Speaker for the selection").fill("Ben");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      page.getByLabel("Speaker of segment 3", { exact: true }),
    ).toHaveValue("Ben");

    await page.getByRole("button", { name: "Text", exact: true }).click();
    await expect(editor).toHaveValue(
      "Third point.\n\nFirst point.\n\nSecond point.",
    );
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    await expect(
      page.getByLabel("Speaker of segment 3", { exact: true }),
    ).toHaveValue("Ana Maria");
    expect(errors).toEqual([]);
  });

  test("a saved recording opens with its timings, plays from a segment and saves edits", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, [meeting]);
    await page.goto("/");
    await nav(page, "Library").click();
    await expect(page.getByText(meeting.transcript!)).toBeVisible();

    // Listening from the library reads the saved audio once, as Opus when
    // the webview can play it.
    await page.getByRole("button", { name: /^Listen/ }).click();
    await expect
      .poll(() => nativeCalls(page, "read_local_capture_audio"))
      .toEqual([
        {
          command: "read_local_capture_audio",
          args: { id: meeting.id, format: "ogg" },
        },
      ]);

    await page.getByRole("button", { name: /^Open editor/ }).click();
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    const items = segmentList(page).getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(segmentText(page, 2)).toHaveValue("Shall we start?");

    // Click-to-play: the segment being heard is highlighted.
    await items.nth(2).getByRole("button", { name: "Play from 0:00" }).click();
    await expect(items.nth(2)).toHaveClass(/active/);
    await expect(items.nth(0)).not.toHaveClass(/active/);
    // The one-second fixture ends by itself.
    await expect(
      items.nth(2).getByRole("button", { name: "Play from 0:00" }),
    ).toBeVisible();

    // Rewording in the text view keeps the audio link of every segment.
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page
      .getByLabel("Transcript editor")
      .fill("Good morning everyone.\n\nShall we begin?\n\nYes, let us begin.");
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Play from/ })).toHaveCount(
      3,
    );

    const speaker = page.getByLabel("Speaker of segment 1", { exact: true });
    await speaker.fill("Ana");
    await speaker.press("Enter");
    await page.getByRole("button", { name: "Save to library" }).click();
    await expect(page.getByText("Saved to your library.")).toBeVisible();
    expect(await nativeCalls(page, "update_local_capture")).toEqual([
      {
        command: "update_local_capture",
        args: {
          id: meeting.id,
          transcript:
            "Good morning everyone.\n\nShall we begin?\n\nYes, let us begin.",
          segments: [
            {
              startMs: 0,
              endMs: 300,
              text: "Good morning everyone.",
              speaker: "Ana",
            },
            { startMs: 300, endMs: 600, text: "Shall we begin?" },
            { startMs: 600, endMs: 1000, text: "Yes, let us begin." },
          ],
        },
      },
    ]);

    await nav(page, "Library").click();
    await expect(page.getByText("Shall we begin?")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a compressed recording plays from the segment that is clicked", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, [meeting], { compressed: [meeting.id] });
    await watchPlayback(page);
    await page.goto("/");
    await nav(page, "Library").click();
    await page.getByRole("button", { name: /^Open editor/ }).click();
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    const items = segmentList(page).getByRole("listitem");
    await expect(items).toHaveCount(3);

    // The third segment starts 600 ms in.
    await items.nth(2).getByRole("button", { name: "Play from 0:00" }).click();
    await expect(items.nth(2)).toHaveClass(/active/);
    // It plays to the end of the one-second fixture.
    await expect
      .poll(async () => Math.max(0, ...(await played(page)).times))
      .toBeGreaterThanOrEqual(0.95);
    await expect(
      items.nth(2).getByRole("button", { name: "Play from 0:00" }),
    ).toBeVisible();
    // From the Opus file, and from where the segment starts.
    expect(await nativeCalls(page, "read_local_capture_audio")).toEqual([
      {
        command: "read_local_capture_audio",
        args: { id: meeting.id, format: "ogg" },
      },
    ]);
    const { types, times } = await played(page);
    expect(types).toEqual(["audio/ogg"]);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0.55);
    expect(errors).toEqual([]);
  });

  test("copy keeps formatting and speaker names", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const copied = () =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const read = async (type: string) => (await item!.getType(type)).text();
        return {
          text: await read("text/plain"),
          html: await read("text/html"),
        };
      });
    await page.goto("/");
    await nav(page, "Transcribe").click();
    const editor = page.getByLabel("Transcript editor");
    const copy = page.getByRole("button", { name: "Copy", exact: true });

    await editor.fill("# Notes\n\n- Ship **Friday**\n- Call Ana");
    await copy.click();
    await expect(page.getByText("Transcript copied.")).toBeVisible();
    let clipboard = await copied();
    expect(clipboard.text).toBe("# Notes\n\n- Ship **Friday**\n- Call Ana");
    expect(clipboard.html).toContain(
      "<h1>Notes</h1><ul><li>Ship <strong>Friday</strong></li><li>Call Ana</li></ul>",
    );

    await editor.fill("Good morning.\n\nShall we start?");
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    const speaker = page.getByLabel("Speaker of segment 1", { exact: true });
    await speaker.fill("Ana");
    await speaker.press("Enter");
    await copy.click();
    // The read can land in the middle of the write; it is simply retried.
    await expect
      .poll(() =>
        copied().then(
          (content) => content.text,
          () => "",
        ),
      )
      .toBe("Ana: Good morning.\n\nShall we start?");
    clipboard = await copied();
    expect(clipboard.html).toContain(
      "<p><strong>Ana:</strong> Good morning.</p><p>Shall we start?</p>",
    );
  });

  test("the segment editor is in French when the interface is", async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    await installMockTauri(page, [meeting]);
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: /^Bibliothèque/ })
      .first()
      .click();
    await page.getByRole("button", { name: /^Écouter/ }).waitFor();
    await page.getByRole("button", { name: /^Ouvrir l'éditeur/ }).click();
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    await expect(
      page.getByRole("list", { name: "Segments de la transcription" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Fusionner", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Écouter à partir de 0:00" }),
    ).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Enregistrer dans la bibliothèque" }),
    ).toBeVisible();
    await context.close();
  });
});
