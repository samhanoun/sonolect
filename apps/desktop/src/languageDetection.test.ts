import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectLanguageFromWhisperOutput,
  getLanguageDisplayName,
  buildAutoDetectConfig,
  shouldSuggestLanguageLock,
  trackLanguageSwitch,
  type DetectedLanguage,
} from "./languageDetection";
import type { WhisperConfig } from "./whisperSetup";

/* ── detectLanguageFromWhisperOutput ─────────────────────────── */

describe("detectLanguageFromWhisperOutput", () => {
  it("returns DetectedLanguage for a known language code", () => {
    const result = detectLanguageFromWhisperOutput({
      language: "fr",
      text: "Bonjour",
    });
    assert.ok(result);
    assert.equal(result.code, "fr");
    assert.equal(result.name, "French");
    assert.equal(typeof result.confidence, "number");
    assert.ok(result.confidence > 0 && result.confidence <= 1);
  });

  it("returns DetectedLanguage for an unknown language code", () => {
    const result = detectLanguageFromWhisperOutput({
      language: "sw",
      text: "Habari",
    });
    assert.ok(result);
    assert.equal(result.code, "sw");
    // Falls back to the raw code when not in STT_LANGUAGES
    assert.equal(result.name, "sw");
  });

  it("normalizes language code to lowercase", () => {
    const result = detectLanguageFromWhisperOutput({
      language: "EN",
      text: "Hello",
    });
    assert.ok(result);
    assert.equal(result.code, "en");
    assert.equal(result.name, "English");
  });

  it("returns null when language field is missing", () => {
    const result = detectLanguageFromWhisperOutput({ text: "Hello" });
    assert.equal(result, null);
  });

  it("returns null when language field is empty string", () => {
    const result = detectLanguageFromWhisperOutput({
      language: "",
      text: "Hello",
    });
    assert.equal(result, null);
  });

  it("returns null when language field is whitespace", () => {
    const result = detectLanguageFromWhisperOutput({
      language: "   ",
      text: "Hello",
    });
    assert.equal(result, null);
  });

  it("returns null for null input", () => {
    assert.equal(detectLanguageFromWhisperOutput(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(detectLanguageFromWhisperOutput(undefined), null);
  });
});

/* ── getLanguageDisplayName ──────────────────────────────────── */

describe("getLanguageDisplayName", () => {
  it("returns display name for a known code", () => {
    assert.equal(getLanguageDisplayName("en"), "English");
    assert.equal(getLanguageDisplayName("fr"), "French");
    assert.equal(getLanguageDisplayName("ja"), "Japanese");
  });

  it("returns 'Auto' for the auto code", () => {
    assert.equal(getLanguageDisplayName("auto"), "Auto");
  });

  it("returns raw code for an unknown language", () => {
    assert.equal(getLanguageDisplayName("xyz"), "xyz");
  });

  it("handles case-insensitive lookup", () => {
    assert.equal(getLanguageDisplayName("EN"), "English");
    assert.equal(getLanguageDisplayName("Fr"), "French");
  });
});

/* ── buildAutoDetectConfig ───────────────────────────────────── */

describe("buildAutoDetectConfig", () => {
  it("replaces {language} token with auto", () => {
    const config: WhisperConfig = {
      command: ["whisper-cli", "--file", "{audioPath}", "-l", "{language}"],
      modelPath: "/models/ggml-base.bin",
      modelName: "base.en",
    };
    const result = buildAutoDetectConfig(config);
    assert.deepEqual(result.command, [
      "whisper-cli",
      "--file",
      "{audioPath}",
      "-l",
      "auto",
    ]);
    // Original config should not be mutated
    assert.equal(config.command[4], "{language}");
  });

  it("preserves config without {language} token", () => {
    const config: WhisperConfig = {
      command: ["whisper-cli", "--file", "{audioPath}"],
      modelPath: "/models/ggml-base.bin",
      modelName: "base.en",
    };
    const result = buildAutoDetectConfig(config);
    assert.deepEqual(result.command, config.command);
  });

  it("preserves modelPath and modelName", () => {
    const config: WhisperConfig = {
      command: ["whisper-cli", "-l", "{language}"],
      modelPath: "/models/ggml-base.bin",
      modelName: "base.en",
    };
    const result = buildAutoDetectConfig(config);
    assert.equal(result.modelPath, "/models/ggml-base.bin");
    assert.equal(result.modelName, "base.en");
  });
});

/* ── shouldSuggestLanguageLock ───────────────────────────────── */

describe("shouldSuggestLanguageLock", () => {
  function makeDetection(code: string): DetectedLanguage {
    return { code, name: code, confidence: 0.85 };
  }

  it("suggests lock when same language detected 5+ times", () => {
    const detections = Array.from({ length: 5 }, () => makeDetection("fr"));
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, true);
    assert.equal(result.language, "fr");
  });

  it("suggests lock when same language detected more than 5 times", () => {
    const detections = Array.from({ length: 8 }, () => makeDetection("es"));
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, true);
    assert.equal(result.language, "es");
  });

  it("checks only last 5 detections", () => {
    const detections = [
      makeDetection("en"),
      makeDetection("en"),
      makeDetection("fr"),
      makeDetection("fr"),
      makeDetection("fr"),
      makeDetection("fr"),
      makeDetection("fr"),
    ];
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, true);
    assert.equal(result.language, "fr");
  });

  it("does not suggest when fewer than 5 detections", () => {
    const detections = Array.from({ length: 3 }, () => makeDetection("fr"));
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, false);
  });

  it("does not suggest when languages are mixed in last 5", () => {
    const detections = [
      makeDetection("fr"),
      makeDetection("en"),
      makeDetection("fr"),
      makeDetection("en"),
      makeDetection("fr"),
    ];
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, false);
  });

  it("does not suggest lock for 'auto'", () => {
    const detections = Array.from({ length: 5 }, () => makeDetection("auto"));
    const result = shouldSuggestLanguageLock(detections);
    assert.equal(result.suggest, false);
  });

  it("returns empty string for language when no suggestion", () => {
    const result = shouldSuggestLanguageLock([]);
    assert.equal(result.suggest, false);
    assert.equal(result.language, "");
  });
});

/* ── trackLanguageSwitch ─────────────────────────────────────── */

describe("trackLanguageSwitch", () => {
  it("returns event when current and detected differ", () => {
    const result = trackLanguageSwitch("en", "fr");
    assert.ok(result);
    assert.equal(result.from, "en");
    assert.equal(result.to, "fr");
    assert.equal(typeof result.timestamp, "number");
    assert.ok(result.timestamp > 0);
  });

  it("returns null when languages match", () => {
    assert.equal(trackLanguageSwitch("en", "en"), null);
  });

  it("returns null when current is auto", () => {
    assert.equal(trackLanguageSwitch("auto", "fr"), null);
  });

  it("returns null when detected is auto", () => {
    assert.equal(trackLanguageSwitch("en", "auto"), null);
  });

  it("returns null when current is null", () => {
    assert.equal(trackLanguageSwitch(null, "fr"), null);
  });

  it("returns null when detected is undefined", () => {
    assert.equal(trackLanguageSwitch("en", undefined), null);
  });

  it("normalizes case when comparing", () => {
    assert.equal(trackLanguageSwitch("EN", "en"), null);
  });

  it("detects switch with different casing", () => {
    const result = trackLanguageSwitch("EN", "FR");
    assert.ok(result);
    assert.equal(result.from, "en");
    assert.equal(result.to, "fr");
  });
});
