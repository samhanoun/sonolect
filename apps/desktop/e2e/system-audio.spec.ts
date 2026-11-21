import { expect, test, type Page } from "@playwright/test";
import {
  emitNativeEvent,
  installMockTauri,
  microphoneRequests,
  nativeCalls,
  pressShortcut,
  watchMicrophoneRequests,
} from "./support/mockTauri";

function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

const BUBBLE_ACTION = "sonolect://bubble/action";

// The mocked desktop app records "this computer's sound" natively: a second
// of audio every 100 ms, and one sentence for every three seconds of it.
test.describe("recording this computer's sound", () => {
  test("the record button records what is playing, without the microphone", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, [], { systemAudio: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    const source = page.getByLabel("Record from");
    await expect(source).toHaveValue("microphone");
    await source.selectOption("system");
    await expect(
      page.getByText("The record button records what is playing"),
    ).toHaveText(
      "The record button records what is playing on this computer, such as a meeting or a video. So does a dictation shortcut pressed while Sonolect is in front. Dictation into other apps and the bubble always use the microphone.",
    );

    await nav(page, "Transcribe").click();
    await page.getByRole("button", { name: "Record to add text" }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Recording computer sound…");
    // Two sentences of live text before stopping: stopping at exactly three
    // seconds of audio would leave only the first.
    const live = page.locator(".studio-live-text");
    await expect(live).toContainText("Part 2.");

    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(dock).toContainText("Your words are ready");
    await expect(page.getByLabel("Transcript editor")).toHaveValue(
      /^Part 1\.\n\nPart 2\./,
    );

    // The audio went from the native feed into the recording: the window
    // sent none of its own, and the feed was stopped before the recording.
    expect(await nativeCalls(page, "start_system_audio_capture")).toHaveLength(
      1,
    );
    expect(await nativeCalls(page, "stop_system_audio_capture")).toHaveLength(
      1,
    );
    expect(await nativeCalls(page, "capture_append")).toEqual([]);
    expect(await nativeCalls(page, "capture_finish")).toHaveLength(1);
    expect(await nativeCalls(page, "transcribe_audio")).toEqual([]);

    // The choice is kept for the next launch, and the recording is saved.
    await nav(page, "Library").click();
    await expect(page.getByText(/Part 1\. Part 2\./).first()).toBeVisible();
    await nav(page, "Settings").click();
    await expect(page.getByLabel("Record from")).toHaveValue("system");
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("sonolect.captureSource"),
      ),
    ).toBe("system");
    expect(errors).toEqual([]);
  });

  test("a feed that ends by itself keeps the recording and says why", async ({
    page,
  }) => {
    await installMockTauri(page, [], { systemAudio: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Record from").selectOption("system");
    await nav(page, "Transcribe").click();
    await page.getByRole("button", { name: "Record to add text" }).click();
    await expect(page.locator(".studio-live-text")).toContainText("Part 1.");

    const [begin] = await nativeCalls(page, "start_system_audio_capture");
    await emitNativeEvent(page, "system-audio-ended", {
      id: (begin!.args as { id: string }).id,
      message: "System audio stopped unexpectedly.",
    });
    // What was recorded is kept, and the dock says why it stopped.
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText("Your words are ready");
    await expect(dock).toContainText("System audio stopped unexpectedly.");
    await expect(page.getByLabel("Transcript editor")).toHaveValue(/^Part 1\./);
    expect(await nativeCalls(page, "capture_finish")).toHaveLength(1);
    expect(await nativeCalls(page, "capture_cancel")).toEqual([]);
  });

  test("a dictation from the bubble still uses the microphone", async ({
    page,
  }) => {
    await installMockTauri(page, [], { systemAudio: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Record from").selectOption("system");

    await emitNativeEvent(page, BUBBLE_ACTION, "toggle");
    await expect
      .poll(async () => (await nativeCalls(page, "capture_append")).length)
      .toBeGreaterThan(0);
    await emitNativeEvent(page, BUBBLE_ACTION, "cancel");
    await expect
      .poll(async () => (await nativeCalls(page, "capture_cancel")).length)
      .toBe(1);
    expect(await nativeCalls(page, "start_system_audio_capture")).toEqual([]);
  });

  test("a dictation shortcut pressed while Sonolect is in front records the computer's sound", async ({
    page,
  }) => {
    await installMockTauri(page, [], { systemAudio: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Record from").selectOption("system");
    await watchMicrophoneRequests(page);
    const dock = page.locator(".studio-recording-dock");

    // The toggle shortcut: press to start, press again to stop.
    await pressShortcut(page, "toggle", "Pressed", true);
    await expect(dock).toContainText("Recording computer sound…");
    await expect(dock.locator(".studio-dock-live")).toContainText("Part 1.");
    await pressShortcut(page, "toggle", "Released", true);
    await pressShortcut(page, "toggle", "Pressed", true);
    await expect(dock).toContainText("Your words are ready");

    // Hold to talk: recording while held.
    await pressShortcut(page, "hold", "Pressed", true);
    await expect(dock).toContainText("Recording computer sound…");
    await expect
      .poll(
        async () =>
          (await nativeCalls(page, "start_system_audio_capture")).length,
      )
      .toBe(2);
    await pressShortcut(page, "hold", "Released", true);
    await expect
      .poll(async () => (await nativeCalls(page, "capture_finish")).length)
      .toBe(2);

    // Both followed "Record from": no microphone, nothing pasted elsewhere.
    expect(await nativeCalls(page, "stop_system_audio_capture")).toHaveLength(
      2,
    );
    expect(await microphoneRequests(page)).toEqual([]);
    expect(await nativeCalls(page, "capture_append")).toEqual([]);
    expect(await nativeCalls(page, "insert_text_into_active_app")).toEqual([]);
  });

  test("a dictation shortcut pressed in another app uses the microphone and pastes", async ({
    page,
  }) => {
    await installMockTauri(page, [], { systemAudio: true });
    await page.goto("/");
    await nav(page, "Settings").click();
    await page.getByLabel("Record from").selectOption("system");
    await watchMicrophoneRequests(page);
    const pasted = async () =>
      (await nativeCalls(page, "insert_text_into_active_app")).length;

    await pressShortcut(page, "toggle", "Pressed", false);
    await expect
      .poll(async () => (await nativeCalls(page, "capture_append")).length)
      .toBeGreaterThan(0);
    await pressShortcut(page, "toggle", "Pressed", false);
    await expect.poll(pasted).toBe(1);

    await pressShortcut(page, "hold", "Pressed", false);
    await expect
      .poll(async () => (await nativeCalls(page, "capture_begin")).length)
      .toBe(2);
    const sent = (await nativeCalls(page, "capture_append")).length;
    await expect
      .poll(async () => (await nativeCalls(page, "capture_append")).length)
      .toBeGreaterThan(sent);
    await pressShortcut(page, "hold", "Released", false);
    await expect.poll(pasted).toBe(2);

    // Each dictation opened the microphone; the computer's sound was never
    // recorded, though it is the Studio's choice.
    expect(await microphoneRequests(page)).toHaveLength(2);
    expect(await nativeCalls(page, "start_system_audio_capture")).toEqual([]);
    const texts = (await nativeCalls(page, "insert_text_into_active_app")).map(
      (call) => (call.args as { text: string }).text,
    );
    expect(texts).toEqual([
      expect.stringMatching(/^Part 1\./),
      expect.stringMatching(/^Part 1\./),
    ]);
  });

  test("the choice is not offered where the sound cannot be recorded", async ({
    page,
  }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Settings").click();
    await expect(page.getByLabel("Record with")).toBeVisible();
    await expect(page.getByLabel("Record from")).toHaveCount(0);
  });

  test("a recorder that cannot start says so, in French too", async ({
    page,
  }) => {
    // The choice was saved on a computer whose sound could be recorded then.
    await installMockTauri(page, []);
    await page.addInitScript(() => {
      window.localStorage.setItem("sonolect.captureSource", "system");
      window.localStorage.setItem("sonolect.locale", "fr");
    });
    await page.goto("/");
    await nav(page, "Transcrire").click();
    await page
      .getByRole("button", { name: "Enregistrer pour ajouter du texte" })
      .click();
    await expect(page.locator(".studio-recording-dock")).toContainText(
      "Aucun périphérique de lecture à enregistrer.",
    );
    // The recording that was begun for it is thrown away.
    expect(await nativeCalls(page, "capture_cancel")).toHaveLength(1);
  });
});
