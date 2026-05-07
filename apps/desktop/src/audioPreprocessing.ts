/**
 * Audio preprocessing for Whisper mode — pure functions on Float32Array
 * so everything is testable without Web Audio API.
 */

export type AudioPreset = "normal" | "whisper" | "noisy" | "custom";

export type AudioConfig = {
  preset: AudioPreset;
  gainBoost: number;
  noiseGateThreshold: number;
  normalizeLevel: number;
};

export const DEFAULT_PRESETS: Record<AudioPreset, AudioConfig> = {
  normal: {
    preset: "normal",
    gainBoost: 1.0,
    noiseGateThreshold: 0.01,
    normalizeLevel: 0.9,
  },
  whisper: {
    preset: "whisper",
    gainBoost: 3.0,
    noiseGateThreshold: 0.005,
    normalizeLevel: 0.95,
  },
  noisy: {
    preset: "noisy",
    gainBoost: 0.8,
    noiseGateThreshold: 0.08,
    normalizeLevel: 0.85,
  },
  custom: {
    preset: "custom",
    gainBoost: 1.0,
    noiseGateThreshold: 0.01,
    normalizeLevel: 0.9,
  },
};

/** Return the AudioConfig for a named preset. */
export function getPresetConfig(preset: AudioPreset): AudioConfig {
  return { ...DEFAULT_PRESETS[preset] };
}

/** Multiply every sample by the gain factor, returning a new array. */
export function applyGainToSamples(
  samples: Float32Array,
  gain: number,
): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = (samples[i] ?? 0) * gain;
  }
  return out;
}

/** Zero out any sample whose absolute value falls below the threshold. */
export function applyNoiseGate(
  samples: Float32Array,
  threshold: number,
): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    out[i] = Math.abs(v) < threshold ? 0 : v;
  }
  return out;
}

/**
 * Normalize peak amplitude to `targetLevel`.
 * If the signal is completely silent the array is returned unchanged.
 */
export function normalizeSamples(
  samples: Float32Array,
  targetLevel: number,
): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i] ?? 0);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return new Float32Array(samples);

  const scale = targetLevel / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = (samples[i] ?? 0) * scale;
  }
  return out;
}

/**
 * Full preprocessing pipeline: noise gate -> gain -> normalize.
 * Order matters: gating first removes low-level noise before boosting.
 */
export function processAudioForWhisper(
  samples: Float32Array,
  config: AudioConfig,
): Float32Array {
  const gated = applyNoiseGate(samples, config.noiseGateThreshold);
  const boosted = applyGainToSamples(gated, config.gainBoost);
  return normalizeSamples(boosted, config.normalizeLevel);
}

/** Compute RMS level of the sample buffer, returning a value in 0-1. */
export function estimateInputLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/** Return true when the input is very quiet (typical whisper territory). */
export function isWhisperVolume(rmsLevel: number): boolean {
  return rmsLevel < 0.05;
}

/** Auto-suggest a preset based on the observed RMS input level. */
export function suggestPreset(rmsLevel: number): AudioPreset {
  if (rmsLevel < 0.05) return "whisper";
  if (rmsLevel > 0.35) return "noisy";
  return "normal";
}
