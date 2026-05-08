/**
 * Audio capture pipeline — ties VAD, noise cancellation, and whisper-mode
 * preprocessing together into a single frame-processing function.
 *
 * Pipeline order: input → noise reduction → whisper mode preprocessing → VAD → output
 */

import type { AudioPreset } from "./audioPreprocessing";
import {
  getPresetConfig,
  processAudioForWhisper,
  estimateInputLevel,
} from "./audioPreprocessing";
import type { VadConfig, VadState, VadEvent } from "./vad";
import { DEFAULT_VAD_CONFIG, createVadState, processVadFrame } from "./vad";
import type { NoiseProfile, NoiseReductionConfig } from "./noiseCancellation";
import {
  DEFAULT_NOISE_CONFIG,
  createNoiseProfile,
  applySpectralSubtraction,
  updateNoiseProfile,
} from "./noiseCancellation";

export type AudioPipelineConfig = {
  vadEnabled: boolean;
  noiseReductionEnabled: boolean;
  whisperModeEnabled: boolean;
  vadConfig?: VadConfig;
  noiseConfig?: NoiseReductionConfig;
  audioPreset?: AudioPreset;
};

export type AudioPipelineResult = {
  processedSamples: Float32Array;
  vadEvents: VadEvent[];
  noiseReduced: boolean;
  inputLevel: number;
  isSpeaking: boolean;
};

/** Create a default pipeline configuration with all features disabled. */
export function createDefaultPipelineConfig(): AudioPipelineConfig {
  return {
    vadEnabled: false,
    noiseReductionEnabled: false,
    whisperModeEnabled: false,
  };
}

/**
 * Process a single audio frame through the full pipeline.
 *
 * Returns the processed samples, any VAD events, and updated state objects
 * so the caller can feed them back into the next call.
 */
export function processAudioFrame(
  frame: Float32Array,
  vadState: VadState,
  noiseProfile: NoiseProfile,
  config: AudioPipelineConfig,
): {
  result: AudioPipelineResult;
  vadState: VadState;
  noiseProfile: NoiseProfile;
} {
  let samples: Float32Array = new Float32Array(frame);
  let noiseReduced = false;
  let updatedNoiseProfile = noiseProfile;

  // ── Step 1: Measure input level (before any processing) ──
  const inputLevel = estimateInputLevel(frame);

  // ── Step 2: Noise reduction ──
  if (config.noiseReductionEnabled) {
    const noiseConfig = config.noiseConfig ?? DEFAULT_NOISE_CONFIG;
    samples = applySpectralSubtraction(samples, noiseProfile, noiseConfig);
    noiseReduced = true;

    // If the signal is quiet (likely silence/noise), update the noise profile
    // so it stays calibrated. Threshold: input level < 0.02 = "silence".
    if (inputLevel < 0.02) {
      updatedNoiseProfile = updateNoiseProfile(noiseProfile, frame);
    }
  }

  // ── Step 3: Whisper mode preprocessing ──
  if (config.whisperModeEnabled) {
    const preset = config.audioPreset ?? "whisper";
    const presetConfig = getPresetConfig(preset);
    samples = processAudioForWhisper(samples, presetConfig);
  }

  // ── Step 4: VAD ──
  const vadEvents: VadEvent[] = [];
  let updatedVadState = vadState;

  if (config.vadEnabled) {
    const vadConfig = config.vadConfig ?? DEFAULT_VAD_CONFIG;
    // Use a timestamp based on the frame count (assumes ~32ms per 512-sample frame at 16kHz)
    const timestampMs = vadState.frameCount * 32;
    const vadResult = processVadFrame(
      vadState,
      samples,
      timestampMs,
      vadConfig,
    );
    updatedVadState = vadResult.state;
    if (vadResult.event) {
      vadEvents.push(vadResult.event);
    }
  }

  return {
    result: {
      processedSamples: samples,
      vadEvents,
      noiseReduced,
      inputLevel,
      isSpeaking: updatedVadState.isSpeaking,
    },
    vadState: updatedVadState,
    noiseProfile: updatedNoiseProfile,
  };
}

// Re-export factory functions for convenience
export { createVadState, createNoiseProfile };
