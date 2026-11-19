import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createDesktopWhisperRequest,
  normalizeWhisperSegments,
} from "./desktopWhisper";

describe("desktop Whisper bridge", () => {
  it("sends audio as a raw binary body with settings in headers", () => {
    const audio = new Uint8Array([1, 2, 3]);
    const request = createDesktopWhisperRequest(
      audio,
      { durationMs: 1200.4, mimeType: "audio/webm", sizeBytes: 3 },
      "fr",
    );

    // The same bytes, not a JSON number array copy.
    assert.equal(request.body, audio);
    assert.equal(request.headers["x-sonolect-duration-ms"], "1200");
    assert.equal(request.headers["x-sonolect-language"], "fr");
    assert.equal(request.headers["x-sonolect-model-path"], undefined);
  });

  it("omits automatic language and encodes non-ASCII model paths", () => {
    const request = createDesktopWhisperRequest(
      new Uint8Array([1]),
      { durationMs: 0, mimeType: "audio/wav", sizeBytes: 1 },
      "auto",
      " C:/Users/Zoé/models/ggml-base.bin ",
    );

    assert.equal(request.headers["x-sonolect-language"], undefined);
    assert.equal(request.headers["x-sonolect-duration-ms"], "1");
    assert.equal(
      request.headers["x-sonolect-model-path"],
      "C%3A%2FUsers%2FZo%C3%A9%2Fmodels%2Fggml-base.bin",
    );
    // Header values must be ISO-8859-1 for fetch-based IPC.
    for (const value of Object.values(request.headers))
      assert.match(value, /^[\x20-\x7e]*$/);
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
