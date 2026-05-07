import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  applyGainToSamples,
  applyNoiseGate,
  normalizeSamples,
  processAudioForWhisper,
  estimateInputLevel,
  isWhisperVolume,
  suggestPreset,
  getPresetConfig,
  DEFAULT_PRESETS,
} from "./audioPreprocessing";

describe("audioPreprocessing", () => {
  describe("applyGainToSamples", () => {
    it("doubles amplitude with gain 2.0", () => {
      const input = new Float32Array([0.1, -0.2, 0.5, 0.0]);
      const result = applyGainToSamples(input, 2.0);

      assert.equal(result.length, 4);
      assert.ok(Math.abs(result[0]! - 0.2) < 1e-6);
      assert.ok(Math.abs(result[1]! - -0.4) < 1e-6);
      assert.ok(Math.abs(result[2]! - 1.0) < 1e-6);
      assert.ok(Math.abs(result[3]! - 0.0) < 1e-6);
    });

    it("does not mutate the original array", () => {
      const input = new Float32Array([0.5]);
      const result = applyGainToSamples(input, 3.0);

      assert.ok(Math.abs(input[0]! - 0.5) < 1e-6);
      assert.ok(Math.abs(result[0]! - 1.5) < 1e-6);
    });

    it("handles gain of 1.0 as identity", () => {
      const input = new Float32Array([0.3, -0.7]);
      const result = applyGainToSamples(input, 1.0);

      assert.ok(Math.abs(result[0]! - 0.3) < 1e-6);
      assert.ok(Math.abs(result[1]! - -0.7) < 1e-6);
    });
  });

  describe("applyNoiseGate", () => {
    it("zeroes samples below threshold", () => {
      const input = new Float32Array([0.001, -0.002, 0.1, -0.5]);
      const result = applyNoiseGate(input, 0.01);

      assert.ok(Math.abs(result[0]!) < 1e-6);
      assert.ok(Math.abs(result[1]!) < 1e-6);
      assert.ok(Math.abs(result[2]! - 0.1) < 1e-6);
      assert.ok(Math.abs(result[3]! - -0.5) < 1e-6);
    });

    it("keeps samples at or above threshold", () => {
      const input = new Float32Array([0.05, -0.05]);
      const result = applyNoiseGate(input, 0.05);

      assert.ok(Math.abs(result[0]! - 0.05) < 1e-6);
      assert.ok(Math.abs(result[1]! - -0.05) < 1e-6);
    });

    it("zeroes everything with a high threshold", () => {
      const input = new Float32Array([0.1, 0.2, -0.3]);
      const result = applyNoiseGate(input, 1.0);

      for (let i = 0; i < result.length; i++) {
        assert.ok(Math.abs(result[i]!) < 1e-6);
      }
    });
  });

  describe("normalizeSamples", () => {
    it("scales peak to target level", () => {
      const input = new Float32Array([0.0, 0.25, -0.5, 0.1]);
      const result = normalizeSamples(input, 1.0);

      // Peak was 0.5, scale by 2.0
      assert.ok(Math.abs(result[2]! - -1.0) < 1e-6);
      assert.ok(Math.abs(result[1]! - 0.5) < 1e-6);
    });

    it("returns unchanged array for silence", () => {
      const input = new Float32Array([0.0, 0.0, 0.0]);
      const result = normalizeSamples(input, 0.9);

      for (let i = 0; i < result.length; i++) {
        assert.ok(Math.abs(result[i]!) < 1e-6);
      }
    });

    it("preserves relative amplitudes", () => {
      const input = new Float32Array([0.2, 0.4]);
      const result = normalizeSamples(input, 0.8);

      // Peak 0.4 → 0.8, scale by 2
      assert.ok(Math.abs(result[0]! - 0.4) < 1e-6);
      assert.ok(Math.abs(result[1]! - 0.8) < 1e-6);
    });
  });

  describe("processAudioForWhisper", () => {
    it("boosts quiet whisper input through the full pipeline", () => {
      // Simulate a very quiet whisper signal
      const input = new Float32Array([0.001, 0.02, -0.03, 0.015, 0.003]);
      const config = getPresetConfig("whisper");
      const result = processAudioForWhisper(input, config);

      // Noise gate (0.005) zeroes 0.001 and 0.003
      // Gain 3.0 boosts remaining samples
      // Normalize to 0.95
      const peak = Math.max(...Array.from(result).map(Math.abs));
      assert.ok(
        Math.abs(peak - 0.95) < 1e-6,
        `Expected peak ~0.95, got ${peak}`,
      );
      // The 0.001 sample should be gated to zero
      assert.ok(
        Math.abs(result[0]!) < 1e-6,
        "Sub-threshold sample should be zeroed",
      );
    });

    it("normal preset leaves moderate signals mostly intact", () => {
      const input = new Float32Array([0.3, -0.5, 0.7]);
      const config = getPresetConfig("normal");
      const result = processAudioForWhisper(input, config);

      const peak = Math.max(...Array.from(result).map(Math.abs));
      assert.ok(Math.abs(peak - 0.9) < 1e-6, `Expected peak ~0.9, got ${peak}`);
    });
  });

  describe("estimateInputLevel", () => {
    it("returns 0 for silence", () => {
      const input = new Float32Array([0, 0, 0, 0]);
      assert.equal(estimateInputLevel(input), 0);
    });

    it("returns 0 for empty buffer", () => {
      assert.equal(estimateInputLevel(new Float32Array(0)), 0);
    });

    it("returns ~0.707 for full-scale sine approximation", () => {
      // RMS of a sine wave = peak / sqrt(2) ≈ 0.707
      const size = 1000;
      const samples = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        samples[i] = Math.sin((2 * Math.PI * i) / size);
      }
      const rms = estimateInputLevel(samples);
      assert.ok(
        Math.abs(rms - Math.SQRT1_2) < 0.01,
        `Expected ~0.707, got ${rms}`,
      );
    });

    it("returns 1 for constant full-scale signal", () => {
      const input = new Float32Array([1, 1, 1, 1]);
      assert.equal(estimateInputLevel(input), 1);
    });

    it("clamps to 1 for overdriven signals", () => {
      const input = new Float32Array([2, 2, 2, 2]);
      assert.equal(estimateInputLevel(input), 1);
    });
  });

  describe("isWhisperVolume", () => {
    it("returns true for very quiet input", () => {
      assert.equal(isWhisperVolume(0.02), true);
      assert.equal(isWhisperVolume(0.0), true);
      assert.equal(isWhisperVolume(0.049), true);
    });

    it("returns false for normal or loud input", () => {
      assert.equal(isWhisperVolume(0.05), false);
      assert.equal(isWhisperVolume(0.1), false);
      assert.equal(isWhisperVolume(0.5), false);
    });
  });

  describe("suggestPreset", () => {
    it("suggests whisper for very quiet input", () => {
      assert.equal(suggestPreset(0.01), "whisper");
      assert.equal(suggestPreset(0.04), "whisper");
    });

    it("suggests normal for moderate input", () => {
      assert.equal(suggestPreset(0.1), "normal");
      assert.equal(suggestPreset(0.2), "normal");
      assert.equal(suggestPreset(0.35), "normal");
    });

    it("suggests noisy for loud input", () => {
      assert.equal(suggestPreset(0.36), "noisy");
      assert.equal(suggestPreset(0.8), "noisy");
    });
  });

  describe("getPresetConfig", () => {
    it("returns a copy that can be modified without affecting defaults", () => {
      const config = getPresetConfig("whisper");
      config.gainBoost = 999;
      assert.equal(DEFAULT_PRESETS.whisper.gainBoost, 3.0);
    });

    it("returns correct values for each preset", () => {
      assert.equal(getPresetConfig("normal").gainBoost, 1.0);
      assert.equal(getPresetConfig("whisper").gainBoost, 3.0);
      assert.equal(getPresetConfig("noisy").gainBoost, 0.8);
    });
  });

  describe("realistic whisper scenario", () => {
    it("processes a quiet recording into usable amplitude", () => {
      // Simulate a realistic quiet whisper: most samples near zero
      // with occasional small bursts
      const size = 480; // ~10ms at 48kHz
      const samples = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        // Most samples are background noise < 0.005
        samples[i] = (Math.random() - 0.5) * 0.004;
      }
      // Add a few "speech" samples
      samples[100] = 0.02;
      samples[101] = -0.025;
      samples[200] = 0.03;
      samples[201] = -0.015;

      const rms = estimateInputLevel(samples);
      assert.ok(isWhisperVolume(rms), "Should detect as whisper volume");

      const preset = suggestPreset(rms);
      assert.equal(preset, "whisper");

      const config = getPresetConfig(preset);
      const processed = processAudioForWhisper(samples, config);

      // After processing, the peak should reach the normalize target
      const peak = Math.max(...Array.from(processed).map(Math.abs));
      assert.ok(
        Math.abs(peak - 0.95) < 1e-6,
        `Expected peak ~0.95, got ${peak}`,
      );
    });
  });
});
