import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  processAudioFrame,
  createDefaultPipelineConfig,
  createVadState,
  createNoiseProfile,
  type AudioPipelineConfig,
} from "./audioCapturePipeline";
import { updateNoiseProfile } from "./noiseCancellation";
import { DEFAULT_VAD_CONFIG } from "./vad";

/** Helper: create a Float32Array filled with a constant. */
function constant(value: number, size = 512): Float32Array {
  const f = new Float32Array(size);
  f.fill(value);
  return f;
}

/** Helper: loud frame above VAD threshold. */
function loudFrame(size = 512): Float32Array {
  return constant(0.1, size);
}

/** Helper: quiet frame below VAD threshold. */
function quietFrame(size = 512): Float32Array {
  return constant(0.001, size);
}

/** Helper: compute RMS of a Float32Array. */
function rms(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / arr.length);
}

describe("audioCapturePipeline", () => {
  describe("full pipeline with all features enabled", () => {
    it("processes a frame through noise reduction, whisper mode, and VAD", () => {
      // Build a noise profile first
      let noiseProfile = createNoiseProfile();
      noiseProfile = updateNoiseProfile(noiseProfile, constant(0.02, 512));

      const config: AudioPipelineConfig = {
        vadEnabled: true,
        noiseReductionEnabled: true,
        whisperModeEnabled: true,
        vadConfig: { ...DEFAULT_VAD_CONFIG, speechMinDurationMs: 0 },
        audioPreset: "whisper",
      };

      const vadState = createVadState();
      const frame = loudFrame();

      const {
        result,
        vadState: newVad,
        noiseProfile: newProfile,
      } = processAudioFrame(frame, vadState, noiseProfile, config);

      // Should have processed samples (not empty)
      assert.equal(result.processedSamples.length, 512);
      // Noise reduction was applied
      assert.equal(result.noiseReduced, true);
      // Input level should be measured
      assert.ok(result.inputLevel > 0, "Input level should be positive");
      // VAD should have fired speech-start (speechMinDuration = 0)
      assert.equal(result.vadEvents.length, 1);
      assert.equal(result.vadEvents[0]?.type, "speech-start");
      assert.equal(result.isSpeaking, true);
      // State objects should be returned for next call
      assert.ok(newVad.frameCount > 0);
      assert.ok(newProfile.sampleCount >= 0);
    });
  });

  describe("pipeline with only VAD", () => {
    it("runs VAD without noise reduction or whisper mode", () => {
      const config: AudioPipelineConfig = {
        vadEnabled: true,
        noiseReductionEnabled: false,
        whisperModeEnabled: false,
        vadConfig: { ...DEFAULT_VAD_CONFIG, speechMinDurationMs: 0 },
      };

      const vadState = createVadState();
      const noiseProfile = createNoiseProfile();

      const { result } = processAudioFrame(
        loudFrame(),
        vadState,
        noiseProfile,
        config,
      );

      assert.equal(result.noiseReduced, false);
      assert.equal(result.vadEvents.length, 1);
      assert.equal(result.vadEvents[0]?.type, "speech-start");
      assert.equal(result.isSpeaking, true);

      // Samples should be unchanged (no processing applied)
      const original = loudFrame();
      for (let i = 0; i < original.length; i++) {
        assert.ok(
          Math.abs(result.processedSamples[i]! - original[i]!) < 1e-6,
          `Sample ${i} should be unchanged`,
        );
      }
    });

    it("detects silence with VAD only", () => {
      const config: AudioPipelineConfig = {
        vadEnabled: true,
        noiseReductionEnabled: false,
        whisperModeEnabled: false,
      };

      const vadState = createVadState();
      const noiseProfile = createNoiseProfile();

      const { result } = processAudioFrame(
        quietFrame(),
        vadState,
        noiseProfile,
        config,
      );

      assert.equal(result.isSpeaking, false);
      // No speech-start event for quiet frames
      const speechStarts = result.vadEvents.filter(
        (e) => e.type === "speech-start",
      );
      assert.equal(speechStarts.length, 0);
    });
  });

  describe("pipeline with only noise reduction", () => {
    it("applies noise reduction without VAD", () => {
      let noiseProfile = createNoiseProfile();
      noiseProfile = updateNoiseProfile(noiseProfile, constant(0.05, 512));

      const config: AudioPipelineConfig = {
        vadEnabled: false,
        noiseReductionEnabled: true,
        whisperModeEnabled: false,
      };

      const vadState = createVadState();
      const signal = constant(0.3, 512);

      const { result } = processAudioFrame(
        signal,
        vadState,
        noiseProfile,
        config,
      );

      assert.equal(result.noiseReduced, true);
      assert.equal(result.vadEvents.length, 0);
      assert.equal(result.isSpeaking, false);

      // Processed samples should have lower RMS than input
      const inputRms = rms(signal);
      const outputRms = rms(result.processedSamples);
      assert.ok(
        outputRms < inputRms,
        `Output RMS ${outputRms} should be less than input ${inputRms}`,
      );
    });

    it("auto-calibrates noise profile from quiet frames", () => {
      const config: AudioPipelineConfig = {
        vadEnabled: false,
        noiseReductionEnabled: true,
        whisperModeEnabled: false,
      };

      const vadState = createVadState();
      let noiseProfile = createNoiseProfile();

      // Feed a quiet frame — should update the noise profile
      const { noiseProfile: updatedProfile } = processAudioFrame(
        quietFrame(),
        vadState,
        noiseProfile,
        config,
      );

      assert.ok(
        updatedProfile.sampleCount > 0,
        "Noise profile should have been updated from quiet frame",
      );
    });
  });

  describe("pipeline passthrough (all disabled)", () => {
    it("returns samples unchanged when all features are disabled", () => {
      const config = createDefaultPipelineConfig();
      const vadState = createVadState();
      const noiseProfile = createNoiseProfile();
      const frame = new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5]);

      const { result } = processAudioFrame(
        frame,
        vadState,
        noiseProfile,
        config,
      );

      assert.equal(result.processedSamples.length, frame.length);
      for (let i = 0; i < frame.length; i++) {
        assert.ok(
          Math.abs(result.processedSamples[i]! - frame[i]!) < 1e-6,
          `Sample ${i} should be unchanged`,
        );
      }

      assert.equal(result.noiseReduced, false);
      assert.equal(result.vadEvents.length, 0);
      assert.equal(result.isSpeaking, false);
      assert.ok(result.inputLevel > 0);
    });

    it("returns default config with all features disabled", () => {
      const config = createDefaultPipelineConfig();
      assert.equal(config.vadEnabled, false);
      assert.equal(config.noiseReductionEnabled, false);
      assert.equal(config.whisperModeEnabled, false);
    });
  });

  describe("multi-frame pipeline sequence", () => {
    it("maintains state across multiple frames", () => {
      let noiseProfile = createNoiseProfile();
      noiseProfile = updateNoiseProfile(noiseProfile, constant(0.01, 512));

      const config: AudioPipelineConfig = {
        vadEnabled: true,
        noiseReductionEnabled: true,
        whisperModeEnabled: false,
        vadConfig: {
          ...DEFAULT_VAD_CONFIG,
          speechMinDurationMs: 0,
          silenceDurationMs: 100,
        },
      };

      let vadState = createVadState();
      const allEvents: string[] = [];

      // Feed 3 loud frames
      for (let i = 0; i < 3; i++) {
        const {
          result,
          vadState: vs,
          noiseProfile: np,
        } = processAudioFrame(loudFrame(), vadState, noiseProfile, config);
        vadState = vs;
        noiseProfile = np;
        for (const e of result.vadEvents) allEvents.push(e.type);
      }

      // Feed 5 quiet frames (enough for silence → speech-end at 100ms)
      for (let i = 0; i < 5; i++) {
        const {
          result,
          vadState: vs,
          noiseProfile: np,
        } = processAudioFrame(quietFrame(), vadState, noiseProfile, config);
        vadState = vs;
        noiseProfile = np;
        for (const e of result.vadEvents) allEvents.push(e.type);
      }

      assert.ok(
        allEvents.includes("speech-start"),
        "Should have speech-start event",
      );
      assert.ok(
        allEvents.includes("speech-end"),
        "Should have speech-end event",
      );
    });
  });
});
