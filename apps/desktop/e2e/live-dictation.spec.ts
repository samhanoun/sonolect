import { expect, test, type Page } from "@playwright/test";
import {
  emitNativeEvent,
  installMockTauri,
  nativeCalls,
} from "./support/mockTauri";

function nav(page: Page, name: string) {
  return page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

const BUBBLE_ACTION = "sonolect://bubble/action";

/** Bytes of audio the recorder has received so far. */
async function recordedBytes(page: Page) {
  return (await nativeCalls(page, "capture_append")).reduce(
    (total, call) => total + (call.args as { bytes: number }).bytes,
    0,
  );
}

// Chromium's synthetic microphone stands in for a real one. The mocked
// recorder answers every three seconds of audio with one sentence.
test.describe("dictation with the app's recorder", () => {
  test("text appears while speaking and the recording is saved whole", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Transcribe").click();

    await page.getByRole("button", { name: "Record to add text" }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Listening…");
    // The clock runs, and the first sentence arrives before the recording ends.
    await expect(dock).toContainText(/0:0[1-9]/);
    const live = page.locator(".studio-live-text");
    await expect(live).toContainText("Part 1.", { timeout: 15_000 });
    await expect(live).toContainText("Heard so far");
    await expect(dock.locator(".studio-dock-live")).toContainText("Part 1.");
    await expect(page.getByLabel("Transcript editor")).toHaveValue("");

    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(dock).toContainText("Your words are ready");
    await expect(page.getByLabel("Transcript editor")).toHaveValue(
      /^Part 1\.\n\nPart 2\./,
    );
    await expect(live).toHaveCount(0);

    // One recording through the chunked recorder: 16 kHz mono PCM in half
    // seconds, and nothing through the old three-minute path.
    expect(await nativeCalls(page, "capture_begin")).toHaveLength(1);
    expect(await nativeCalls(page, "capture_finish")).toHaveLength(1);
    expect(await nativeCalls(page, "capture_cancel")).toEqual([]);
    expect(await nativeCalls(page, "transcribe_audio")).toEqual([]);
    const pieces = (await nativeCalls(page, "capture_append")).map(
      (call) => (call.args as { bytes: number }).bytes,
    );
    expect(pieces.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...pieces)).toBe(16000);
    // Nothing is pasted for a dictation started in the app.
    expect(await nativeCalls(page, "insert_text_into_active_app")).toEqual([]);

    // The recording is in the library with its timings.
    await nav(page, "Library").click();
    await expect(page.getByText(/Part 1\. Part 2\./).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a bubble dictation is pasted into the app in front", async ({
    page,
  }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toHaveCount(0);

    await emitNativeEvent(page, BUBBLE_ACTION, "toggle");
    await expect(dock).toContainText("Listening…");
    await expect
      .poll(() => recordedBytes(page), { timeout: 15_000 })
      .toBeGreaterThan(3 * 32000);
    await emitNativeEvent(page, BUBBLE_ACTION, "finish");
    await expect(dock).toContainText("Your words are ready");

    const pasted = await nativeCalls(page, "insert_text_into_active_app");
    expect(pasted).toHaveLength(1);
    expect((pasted[0]!.args as { text: string }).text).toMatch(
      /^Part 1\. Part 2\./,
    );
  });

  test("cancelling from the bubble throws the recording away", async ({
    page,
  }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    await emitNativeEvent(page, BUBBLE_ACTION, "toggle");
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Listening…");
    await expect.poll(() => recordedBytes(page)).toBeGreaterThan(0);

    await emitNativeEvent(page, BUBBLE_ACTION, "cancel");
    await expect(dock).toHaveCount(0);
    expect(await nativeCalls(page, "capture_cancel")).toHaveLength(1);
    expect(await nativeCalls(page, "capture_finish")).toEqual([]);
    expect(await nativeCalls(page, "insert_text_into_active_app")).toEqual([]);
    await nav(page, "Transcribe").click();
    await expect(page.getByLabel("Transcript editor")).toHaveValue("");
    await nav(page, "Library").click();
    await expect(page.getByText("Part 1.")).toHaveCount(0);
  });

  test("without a speech model the short path explains what is missing", async ({
    page,
  }) => {
    await installMockTauri(page, [], { recorder: false });
    await page.goto("/");
    await nav(page, "Transcribe").click();
    await page.getByRole("button", { name: "Record to add text" }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Listening…");
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(dock).toContainText("Recording needs attention");
    // The recorder was tried once and took no audio.
    expect(await nativeCalls(page, "capture_begin")).toHaveLength(1);
    expect(await nativeCalls(page, "capture_append")).toEqual([]);
  });

  test("the meter on the overview follows the microphone", async ({ page }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    await page.getByRole("button", { name: /Start dictating/ }).click();
    const bars = page.locator(".studio-signal-bars");
    await expect(page.locator(".studio-signal.live")).toBeVisible();
    // The synthetic microphone beeps: the level is set and moves.
    await expect
      .poll(
        () =>
          bars.evaluate((element) =>
            Number(
              (element as HTMLElement).style.getPropertyValue("--signal-level"),
            ),
          ),
        { timeout: 10_000, intervals: [50] },
      )
      .toBeGreaterThan(0.3);
    await page
      .getByRole("button", { name: /Stop recording/ })
      .first()
      .click();
    await expect(page.locator(".studio-signal.live")).toHaveCount(0);
  });
});
