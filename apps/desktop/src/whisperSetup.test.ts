import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_WHISPER_CONFIG,
  buildWhisperCommandPreview,
  commandArgsJsonForEnv,
  getWhisperSetupStatus,
  parseWhisperConfig,
  serializeWhisperConfig,
  validateWhisperConfig,
} from "./whisperSetup";

describe("Whisper setup helpers", () => {
  it("reports missing command and model as setup needed", () => {
    const status = getWhisperSetupStatus({ command: [], modelPath: "" });

    assert.equal(status.ready, false);
    assert.equal(status.code, "missing-command");
    assert.match(status.message, /command/i);
  });

  it("accepts an argv command and model path as ready", () => {
    const config = {
      command: [
        "/opt/whisper.cpp/build/bin/whisper-cli",
        "--model",
        "{model}",
        "--file",
        "{audio}",
        "--output-json",
      ],
      modelPath: "/Users/me/Models/ggml-base.en.bin",
      modelName: "base.en",
    };

    assert.deepEqual(validateWhisperConfig(config), []);
    const status = getWhisperSetupStatus(config);
    assert.equal(status.ready, true);
    assert.equal(status.code, "ready");
    assert.match(buildWhisperCommandPreview(config), /ggml-base\.en\.bin/);
    assert.match(buildWhisperCommandPreview(config), /sample\.wav/);
    assert.equal(
      commandArgsJsonForEnv(config),
      '["/opt/whisper.cpp/build/bin/whisper-cli","--model","/Users/me/Models/ggml-base.en.bin","--file","{audioPath}","--output-json"]',
    );
  });

  it("flags unsafe shell strings and missing placeholders", () => {
    const errors = validateWhisperConfig({
      command: ["whisper-cli --model model.bin --file audio.wav"],
      modelPath: "/models/model.bin",
    });

    assert.ok(errors.some((error) => error.code === "command-not-argv"));
    assert.ok(
      errors.some((error) => error.code === "missing-audio-placeholder"),
    );
  });

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
});
