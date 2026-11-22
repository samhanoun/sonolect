import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_WHISPER_CONFIG,
  parseWhisperConfig,
  serializeWhisperConfig,
} from "./whisperSetup";

describe("Whisper setup helpers", () => {
  it("round-trips persisted JSON with deterministic defaults", () => {
    assert.deepEqual(parseWhisperConfig(null), DEFAULT_WHISPER_CONFIG);

    const raw = serializeWhisperConfig({
      command: ["python3", "-m", "whisper", "{audio}", "--model", "small"],
      modelPath: "small",
    });

    assert.deepEqual(parseWhisperConfig(raw), {
      command: ["python3", "-m", "whisper", "{audio}", "--model", "small"],
      modelPath: "small",
      modelName: "",
    });
  });

  it("falls back to the defaults for a corrupt saved value", () => {
    assert.deepEqual(parseWhisperConfig("{not-json"), DEFAULT_WHISPER_CONFIG);
  });
});
