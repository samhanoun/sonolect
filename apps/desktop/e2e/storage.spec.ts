import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  installMockTauri,
  microphoneRequests,
  nativeCalls,
  releaseHeldReads,
  watchMicrophoneRequests,
  type MockCapture,
} from "./support/mockTauri";
import { played, watchPlayback } from "./support/playback";

function nav(page: Page, name: string) {
  return page.getByRole("navigation").getByRole("button", { name }).first();
}

function capture(id: string, durationMs: number): MockCapture {
  return {
    id,
    createdAtMs: 1_700_000_000_000,
    durationMs,
    transcript: "Saved words.",
    error: null,
    language: "en",
  };
}

/** A 16 kHz mono WAV file holding a quiet tone of the given length. */
function toneWav(seconds: number) {
  const samples = seconds * 16000;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    bytes.writeInt16LE(
      Math.round(3000 * Math.sin((index * 2 * Math.PI * 220) / 16000)),
      44 + index * 2,
    );
  return bytes;
}

function privacyCard(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Privacy & retention" }),
  });
}

test.describe("compressed recordings", () => {
  test("choosing compressed storage offers to compress what is saved", async ({
    page,
  }) => {
    // Ten minutes and five minutes of WAV: 19.2 MB and 9.6 MB.
    await installMockTauri(page, [
      capture("1700000000000-1", 600_000),
      capture("1700000000000-2", 300_000),
    ]);
    await page.goto("/");
    await nav(page, "Settings").click();
    const card = privacyCard(page);
    const format = card.getByLabel("Save recordings as");
    await expect(format).toHaveValue("wav");
    await expect(
      card.getByRole("button", { name: "Compress saved recordings" }),
    ).toHaveCount(0);
    // Nothing is compressed while the choice is WAV.
    expect(await nativeCalls(page, "compress_local_captures")).toEqual([]);

    await format.selectOption("opus");
    await expect(card.getByRole("status")).toHaveText(
      "New recordings are compressed once they are transcribed. You can still play them and transcribe them again.",
    );
    const compress = card.getByRole("button", {
      name: "Compress saved recordings",
    });
    await compress.click();
    await expect(card.getByRole("status")).toHaveText(
      "2 recordings compressed, 26.1 MB freed.",
    );
    await compress.click();
    await expect(card.getByRole("status")).toHaveText(
      "Every saved recording is already compressed.",
    );
    expect(await nativeCalls(page, "compress_local_captures")).toHaveLength(2);

    // Back to WAV: the button goes and the choice is explained.
    await format.selectOption("wav");
    await expect(card.getByRole("status")).toHaveText(
      "New recordings are kept as WAV, in speech quality. Recordings already compressed stay compressed.",
    );
    await expect(compress).toHaveCount(0);
  });

  test("an imported file is compressed once it is transcribed", async ({
    page,
  }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Settings").click();
    await privacyCard(page)
      .getByLabel("Save recordings as")
      .selectOption("opus");

    await nav(page, "Transcribe").click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "memo.wav",
      mimeType: "audio/wav",
      buffer: toneWav(6),
    });
    await expect(page.getByText("Audio transcribed and saved.")).toBeVisible({
      timeout: 20_000,
    });
    // After the recording was finished, never before.
    await expect
      .poll(
        async () => (await nativeCalls(page, "compress_local_captures")).length,
      )
      .toBe(1);
    expect(await nativeCalls(page, "capture_finish")).toHaveLength(1);
  });

  test("a recording is compressed as soon as it is finished", async ({
    page,
  }) => {
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Settings").click();
    await privacyCard(page)
      .getByLabel("Save recordings as")
      .selectOption("opus");
    await nav(page, "Transcribe").click();
    const before = (await nativeCalls(page, "compress_local_captures")).length;
    await page.getByRole("button", { name: "Record to add text" }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(dock).toContainText(/0:0[1-9]/);
    // Not while it records.
    expect(await nativeCalls(page, "compress_local_captures")).toHaveLength(
      before,
    );
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(dock).toContainText("Your words are ready");
    // Without dismissing the dock or starting another recording.
    await expect
      .poll(
        async () => (await nativeCalls(page, "compress_local_captures")).length,
      )
      .toBe(before + 1);
  });
});

test.describe("high-quality recordings", () => {
  test("choosing high quality records the microphone at 48 kHz and keeps it as Opus", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Overview").click();
    await expect(page.locator(".studio-signal-meta")).toHaveText(
      "16 kHz · mono · on device",
    );
    await nav(page, "Settings").click();
    const card = privacyCard(page);
    const format = card.getByLabel("Save recordings as");
    await expect(format.locator("option")).toHaveText([
      "Speech quality (WAV, 16 kHz mono)",
      "Speech quality, compressed (Opus, 10× smaller)",
      "High quality (Opus, 48 kHz, stereo when the source has it)",
    ]);
    await format.selectOption("hq");
    await expect(card.getByRole("status")).toHaveText(
      "New recordings are kept at 48 kHz, in stereo when the source has it. Imported files and older recordings are compressed in speech quality.",
    );
    // What is still WAV can be compressed, in speech quality.
    await expect(
      card.getByRole("button", { name: "Compress saved recordings" }),
    ).toBeVisible();
    await nav(page, "Overview").click();
    await expect(page.locator(".studio-signal-meta")).toHaveText(
      "48 kHz · stereo when available · on device",
    );

    await watchMicrophoneRequests(page);
    await nav(page, "Transcribe").click();
    await page.getByRole("button", { name: "Record to add text" }).click();
    const dock = page.locator(".studio-recording-dock");
    await expect(page.locator(".studio-live-text")).toContainText("Part 1.", {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(dock).toContainText("Your words are ready");
    await expect(page.getByLabel("Transcript editor")).toHaveValue(/^Part 1\./);

    // The microphone is asked for 48 kHz stereo, voice processing left on.
    expect(await microphoneRequests(page)).toEqual([
      { audio: { channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } } },
    ]);
    const [begin] = await nativeCalls(page, "capture_begin");
    expect(begin!.args).toMatchObject({ quality: "high" });
    // Pieces at the webview's 48 kHz, half a second of whole frames each.
    const pieces = (await nativeCalls(page, "capture_append")).map(
      (call) => call.args as { bytes: number; rate: number; channels: number },
    );
    expect(pieces.length).toBeGreaterThanOrEqual(6);
    const { channels } = pieces[0]!;
    expect([1, 2]).toContain(channels);
    for (const piece of pieces) {
      expect(piece).toMatchObject({ rate: 48000, channels });
      expect(piece.bytes % (2 * channels)).toBe(0);
    }
    expect(Math.max(...pieces.map((piece) => piece.bytes))).toBe(
      48000 * channels,
    );
    expect(await nativeCalls(page, "capture_cancel")).toEqual([]);
    expect(errors).toEqual([]);

    // Saving its audio gives the Opus file, read from the device.
    await nav(page, "Library").click();
    const saving = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save audio" }).first().click();
    const download = await saving;
    expect(download.suggestedFilename()).toMatch(
      /^sonolect-recording-\d{4}-\d{2}-\d{2}-\d{4}\.opus$/,
    );
    const saved = await readFile((await download.path())!);
    expect(saved.subarray(0, 4).toString("latin1")).toBe("OggS");
    const reads = await nativeCalls(page, "read_local_capture_audio");
    expect(reads.at(-1)!.args).toMatchObject({ format: "file" });
  });

  test("saving the audio of a recording kept as WAV gives the WAV", async ({
    page,
  }) => {
    await installMockTauri(
      page,
      [capture("1700000000000-1", 1000), capture("1700000000000-2", 1000)],
      { compressed: ["1700000000000-2"] },
    );
    await page.goto("/");
    await nav(page, "Library").click();
    const cards = page.locator(".studio-card");
    await expect(cards).toHaveCount(2);

    const wav = page.waitForEvent("download");
    await cards.nth(0).getByRole("button", { name: "Save audio" }).click();
    const first = await wav;
    expect(first.suggestedFilename()).toMatch(/\.wav$/);
    expect(
      (await readFile((await first.path())!)).subarray(0, 4).toString("latin1"),
    ).toBe("RIFF");

    const opus = page.waitForEvent("download");
    await cards.nth(1).getByRole("button", { name: "Save audio" }).click();
    const second = await opus;
    expect(second.suggestedFilename()).toMatch(/\.opus$/);
    expect(
      (await readFile((await second.path())!))
        .subarray(0, 4)
        .toString("latin1"),
    ).toBe("OggS");
    expect(
      (await nativeCalls(page, "read_local_capture_audio")).map(
        (call) => call.args,
      ),
    ).toEqual([
      { id: "1700000000000-1", format: "file" },
      { id: "1700000000000-2", format: "file" },
    ]);
  });

  test("Save audio is offered only where the recording's audio is", async ({
    page,
  }) => {
    // Recordings do not sync: this note's audio stays on the phone.
    const fromPhone: MockCapture = {
      ...capture("1700000000000-9", 2000),
      transcript: "From the phone.",
      origin: "mobile",
      hasAudio: false,
    };
    // Made here, but its audio was removed from this device.
    const gone: MockCapture = {
      ...capture("1700000000000-5", 1000),
      transcript: "Its audio is gone.",
      hasAudio: false,
    };
    await installMockTauri(page, [
      fromPhone,
      gone,
      capture("1700000000000-1", 1000),
    ]);
    await page.goto("/");
    await nav(page, "Library").click();
    const cards = page.locator(".studio-card");
    await expect(cards).toHaveCount(3);
    const saveAudio = (text: string) =>
      cards
        .filter({ hasText: text })
        .getByRole("button", { name: "Save audio" });

    await expect(cards.filter({ hasText: "From the phone." })).toContainText(
      "The recording stays on the device that made it.",
    );
    await expect(saveAudio("From the phone.")).toHaveCount(0);
    await expect(cards.filter({ hasText: "Its audio is gone." })).toContainText(
      "The audio of this recording is no longer on this device.",
    );
    await expect(saveAudio("Its audio is gone.")).toHaveCount(0);
    // A recording whose audio is here still has it.
    await expect(saveAudio("Saved words.")).toBeVisible();
    expect(await nativeCalls(page, "read_local_capture_audio")).toEqual([]);
  });
});

test.describe("playing compressed recordings", () => {
  const id = "1700000000000-1";

  /** Plays the saved one-second recording from the library to its end. */
  async function listenToTheEnd(page: Page) {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await nav(page, "Library").click();
    const listen = page.locator(".studio-card-actions button").first();
    await expect(listen).toHaveText("Listen");
    await listen.click();
    // The playhead reaches the end of the tone, then playback stops.
    await expect(listen).toHaveText(/^Listen\s*0:01$/);
    await expect(page.locator(".studio-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  }

  test("a compressed recording plays from its Opus file", async ({ page }) => {
    await installMockTauri(page, [capture(id, 1000)], { compressed: [id] });
    await watchPlayback(page);
    await listenToTheEnd(page);
    expect(await nativeCalls(page, "read_local_capture_audio")).toEqual([
      { command: "read_local_capture_audio", args: { id, format: "ogg" } },
    ]);
    expect((await played(page)).types).toEqual(["audio/ogg"]);
  });

  test("an Opus file the webview cannot play is read again as WAV", async ({
    page,
  }) => {
    await installMockTauri(page, [capture(id, 1000)], {
      compressed: [id],
      unplayableOpus: true,
    });
    await watchPlayback(page);
    await listenToTheEnd(page);
    expect(await nativeCalls(page, "read_local_capture_audio")).toEqual([
      { command: "read_local_capture_audio", args: { id, format: "ogg" } },
      { command: "read_local_capture_audio", args: { id, format: "wav" } },
    ]);
    expect((await played(page)).types).toEqual(["audio/ogg", "audio/wav"]);
  });

  test("pausing while the WAV is read keeps it from playing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, [capture(id, 1000)], {
      compressed: [id],
      unplayableOpus: true,
      holdWavReads: true,
    });
    await watchPlayback(page);
    const read = (format: string) => ({
      command: "read_local_capture_audio",
      args: { id, format },
    });
    await page.goto("/");
    await nav(page, "Library").click();
    const listen = page.locator(".studio-card-actions button").first();
    await listen.click();
    // The Opus file cannot be played, and the WAV takes a while to read.
    await expect
      .poll(() => nativeCalls(page, "read_local_capture_audio"))
      .toEqual([read("ogg"), read("wav")]);
    await expect(listen).toHaveText(/^Pause/);
    await listen.click();
    await expect(listen).toHaveText(/^Listen/);
    await releaseHeldReads(page);
    // The page has had time to act on the WAV, and has not played it: only
    // the Opus file was asked to play.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    expect(await played(page)).toMatchObject({
      types: ["audio/ogg"],
      plays: 1,
    });
    await expect(listen).toHaveText(/^Listen/);

    // Listening again reads the WAV again and plays it to the end.
    await listen.click();
    await expect
      .poll(() => nativeCalls(page, "read_local_capture_audio"))
      .toEqual([read("ogg"), read("wav"), read("wav")]);
    await releaseHeldReads(page);
    await expect(listen).toHaveText(/^Listen\s*0:01$/);
    expect((await played(page)).types).toEqual(["audio/ogg", "audio/wav"]);
    await expect(page.locator(".studio-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a webview without Opus asks for WAV", async ({ page }) => {
    await installMockTauri(page, [capture(id, 1000)], { compressed: [id] });
    await page.addInitScript(() => {
      const canPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        return /ogg|opus/i.test(type) ? "" : canPlayType.call(this, type);
      };
    });
    await watchPlayback(page);
    await listenToTheEnd(page);
    expect(await nativeCalls(page, "read_local_capture_audio")).toEqual([
      { command: "read_local_capture_audio", args: { id, format: "wav" } },
    ]);
    expect((await played(page)).types).toEqual(["audio/wav"]);
  });
});

test.describe("compressed recordings in French", () => {
  test.use({ locale: "fr-FR" });

  test("sizes and counts follow the language", async ({ page }) => {
    await installMockTauri(page, [capture("1700000000000-1", 600_000)]);
    await page.goto("/");
    await nav(page, "Réglages").click();
    const card = page.locator("section", {
      has: page.getByRole("heading", {
        name: "Confidentialité et conservation",
      }),
    });
    await card.getByLabel("Format des enregistrements").selectOption("opus");
    await card
      .getByRole("button", { name: "Compresser les enregistrements" })
      .click();
    await expect(card.getByRole("status")).toHaveText(
      /^1 enregistrement compressé, 17,4\sMo libérés\.$/,
    );
  });
});
