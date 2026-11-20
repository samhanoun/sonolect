import { expect, test, type Page } from "@playwright/test";
import { installMockTauri, nativeCalls } from "./support/mockTauri";

function nav(page: Page, name: string) {
  return page
    .getByRole("navigation")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
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

test.describe("long recordings", () => {
  test("an audio file longer than three minutes is transcribed in pieces", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installMockTauri(page, []);
    await page.goto("/");
    await nav(page, "Transcribe").click();

    // Four minutes: over the old three-minute limit.
    await page.locator('input[type="file"]').setInputFiles({
      name: "meeting.wav",
      mimeType: "audio/wav",
      buffer: toneWav(240),
    });
    await expect(page.getByText("Audio transcribed and saved.")).toBeVisible({
      timeout: 20_000,
    });

    // One recording, sent half a second at a time, nothing lost.
    expect(await nativeCalls(page, "transcribe_audio")).toEqual([]);
    const begin = await nativeCalls(page, "capture_begin");
    expect(begin).toHaveLength(1);
    expect(begin[0]!.args).toMatchObject({ language: "auto" });
    const pieces = (await nativeCalls(page, "capture_append")).map(
      (call) => (call.args as { bytes: number }).bytes,
    );
    expect(pieces.length).toBe(480);
    expect(Math.max(...pieces)).toBe(16000);
    expect(pieces.reduce((total, bytes) => total + bytes, 0)).toBe(240 * 32000);
    expect(await nativeCalls(page, "capture_finish")).toHaveLength(1);

    // The transcript opens with its timings and audio links.
    await expect(page.getByLabel("Transcript editor")).toHaveValue(
      /^Part 1\.\n\nPart 2\.[\s\S]*Part 80\.$/,
    );
    await page.getByRole("button", { name: "Segments", exact: true }).click();
    const items = page
      .getByRole("list", { name: "Transcript segments" })
      .getByRole("listitem");
    await expect(items).toHaveCount(80);
    await expect(
      items.last().getByRole("button", { name: "Play from 3:57" }),
    ).toBeVisible();

    await nav(page, "Library").click();
    await expect(page.getByText(/Part 79\. Part 80\./)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
