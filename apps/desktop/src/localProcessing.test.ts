import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitCapturedAudio, submitCapturedAudioCloud } from "./voiceApi";
import { createDesktopWhisperPayload } from "./desktopWhisper";
import { polishDictation } from "./wisprWorkflow";

const audio = new Blob([new Uint8Array([1])], { type: "audio/wav" });
const metadata = { durationMs: 1000, mimeType: "audio/wav", sizeBytes: 1 };

describe("local processing boundary", () => {
  for (const submit of [submitCapturedAudio, submitCapturedAudioCloud]) {
    for (const mode of [undefined, "local"] as const) {
      it(`${submit.name} never uploads after a local failure in ${mode ?? "default"} mode`, async () => {
        let requests = 0;
        const options = {
          processingMode: mode,
          apiUrl: "https://example.test",
          desktopTranscriber: async () => { throw new Error("Model missing"); },
          fetchImpl: async () => {
            requests++;
            return new Response("{}", { status: 503 });
          },
        };
        const result = await submit(audio, metadata, options);
        assert.equal(requests, 0);
        assert.equal(result.status, "offline");
        assert.match(result.message ?? "", /local|model/i);
      });
    }
  }

  it("rechecks consent after waiting for local inference", async () => {
    let allowed = true;
    let requests = 0;
    const options = {
      processingMode: "cloud" as const,
      canUseCloud: () => allowed,
      apiUrl: "https://example.test",
      desktopTranscriber: async () => { allowed = false; return undefined; },
      fetchImpl: async () => { requests++; return new Response("{}", { status: 503 }); },
    };
    await submitCapturedAudioCloud(audio, metadata, options);
    assert.equal(requests, 0);
  });

  it("passes the selected model path to the native engine", () => {
    const payload = createDesktopWhisperPayload(
      new Uint8Array([1]), metadata, "fr",
      // New native model argument must replace the environment-only setup.
      "C:/Models/ggml-base.bin",
    );
    assert.equal(payload.modelPath, "C:/Models/ggml-base.bin");
    assert.equal(payload.language, "fr");
  });
});

describe("conservative local formatting", () => {
  it("preserves ordinary uses of filler-like words", () => {
    assert.equal(polishDictation("I like this kind of music."), "I like this kind of music.");
    assert.equal(polishDictation("Do you know the answer?"), "Do you know the answer?");
  });
  it("preserves paragraphs", () => {
    assert.equal(polishDictation("First paragraph.\n\nSecond paragraph."), "First paragraph.\n\nSecond paragraph.");
  });
  it("inserts dictionary replacement text literally", () => {
    assert.equal(polishDictation("price", { dictionary: [{ id: "1", spoken: "price", replacement: "$&" }] }), "$&.");
  });
});
