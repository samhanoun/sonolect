import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createDesktopWhisperPayload,
  normalizeWhisperSegments,
} from "./desktopWhisper";

describe("desktop Whisper bridge", () => {
  it("creates a Tauri-safe payload from audio metadata and bytes", () => {
    const payload = createDesktopWhisperPayload(
      new Uint8Array([1, 2, 3]),
      { durationMs: 1200, mimeType: "audio/webm", sizeBytes: 3 },
      "fr",
    );

    assert.deepEqual(payload.audioBytes, [1, 2, 3]);
    assert.equal(payload.mimeType, "audio/webm");
    assert.equal(payload.language, "fr");
  });

  it("normalizes Whisper segment payloads into app segments", () => {
    const segments = normalizeWhisperSegments([
      { startMs: 0, endMs: 900, text: " Bonjour ", speaker: " Speaker 1 " },
      { startMs: 900, endMs: 1500, text: "le monde" },
    ]);

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.text, "Bonjour");
    assert.equal(segments[0]?.speaker, "Speaker 1");
    assert.equal(segments[1]?.startMs, 900);
  });

  it("keeps normalized segment end times after start times", () => {
    const [segment] = normalizeWhisperSegments([
      { startMs: 2000.4, endMs: 1500.2, text: "timing" },
    ]);

    assert.equal(segment?.startMs, 2000);
    assert.equal(segment?.endMs, 2001);
  });
});
