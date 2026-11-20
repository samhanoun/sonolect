import { expect, test, type Page } from "@playwright/test";
import {
  installMockTauri,
  nativeCalls,
  type MockCapture,
} from "./support/mockTauri";

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
      "New recordings are kept in original quality. Recordings already compressed stay compressed.",
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
