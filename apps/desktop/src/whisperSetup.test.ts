import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_WHISPER_CONFIG,
  WHISPER_MODEL_CATALOG,
  buildWhisperCommandPreview,
  buildWhisperInstallerGuidance,
  commandArgsJsonForEnv,
  getDefaultWhisperInstallPlan,
  getWhisperAssetStatus,
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

  it("publishes a deterministic local model catalog without binary payloads", () => {
    assert.ok(WHISPER_MODEL_CATALOG.length >= 3);
    assert.deepEqual(
      WHISPER_MODEL_CATALOG.map((model) => model.id),
      ["tiny.en", "base.en", "small.en"],
    );
    const recommended = WHISPER_MODEL_CATALOG.find(
      (model) => model.recommended,
    );
    assert.equal(recommended?.id, "base.en");
    assert.equal(recommended?.filename, "ggml-base.en.bin");
    assert.match(recommended?.downloadUrl ?? "", /^https:\/\//);
    assert.ok(
      WHISPER_MODEL_CATALOG.every((model) => model.sizeBytes > 0),
      "catalog contains metadata only, not checked-in model blobs",
    );
  });

  it("builds portable app-data install plans for bundled/downloaded assets", () => {
    const mac = getDefaultWhisperInstallPlan({
      platform: "darwin",
      homeDir: "/Users/alex",
    });
    assert.equal(
      mac.rootDir,
      "/Users/alex/Library/Application Support/Sonolect/whisper",
    );
    assert.equal(
      mac.binaryPath,
      "/Users/alex/Library/Application Support/Sonolect/whisper/bin/whisper-cli",
    );
    assert.equal(
      mac.modelPath,
      "/Users/alex/Library/Application Support/Sonolect/whisper/models/ggml-base.en.bin",
    );
    assert.deepEqual(mac.config.command, [
      "/Users/alex/Library/Application Support/Sonolect/whisper/bin/whisper-cli",
      "--model",
      "{model}",
      "--file",
      "{audioPath}",
      "--output-json",
    ]);

    const linux = getDefaultWhisperInstallPlan({
      platform: "linux",
      homeDir: "/home/alex",
      modelId: "tiny.en",
    });
    assert.equal(linux.rootDir, "/home/alex/.local/share/sonolect/whisper");
    assert.equal(linux.modelPath.endsWith("ggml-tiny.en.bin"), true);

    const windows = getDefaultWhisperInstallPlan({
      platform: "win32",
      homeDir: "C:/Users/Alex",
      appDataDir: "C:/Users/Alex/AppData/Roaming",
    });
    assert.equal(
      windows.binaryPath,
      "C:/Users/Alex/AppData/Roaming/Sonolect/whisper/bin/whisper-cli.exe",
    );
  });

  it("summarizes asset setup states for onboarding", () => {
    assert.deepEqual(getWhisperAssetStatus({}), {
      state: "not-installed",
      ready: false,
      message: "Whisper binary and model are not installed yet.",
    });
    assert.deepEqual(getWhisperAssetStatus({ downloading: true }), {
      state: "downloading",
      ready: false,
      message: "Downloading Whisper assets…",
    });
    assert.deepEqual(
      getWhisperAssetStatus({ binaryExists: true, modelExists: false }),
      {
        state: "not-installed",
        ready: false,
        message: "Whisper model is missing.",
      },
    );
    assert.deepEqual(
      getWhisperAssetStatus({ invalidReason: "Checksum mismatch" }),
      {
        state: "invalid",
        ready: false,
        message: "Whisper assets need attention: Checksum mismatch",
      },
    );
    assert.deepEqual(
      getWhisperAssetStatus({ binaryExists: true, modelExists: true }),
      {
        state: "ready",
        ready: true,
        message: "Whisper binary and model are installed locally.",
      },
    );
  });

  it("renders installer guidance with download URLs and command preview", () => {
    const plan = getDefaultWhisperInstallPlan({
      platform: "linux",
      homeDir: "/home/alex",
    });
    const guidance = buildWhisperInstallerGuidance(plan);

    assert.match(guidance.summary, /whisper\.cpp/i);
    assert.match(guidance.steps.join("\n"), /ggml-base\.en\.bin/);
    assert.match(guidance.steps.join("\n"), /https:\/\//);
    assert.match(guidance.commandPreview, /--model/);
    assert.match(guidance.commandPreview, /sonolect-sample\.wav/);
  });
});
