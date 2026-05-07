/**
 * Spectral noise reduction — pure functions on Float32Array.
 * Uses time-domain approximation of spectral subtraction suitable
 * for offline / non-realtime processing without Web Audio API.
 */

export type NoiseProfile = {
  noiseFloor: Float32Array;
  sampleCount: number;
};

export type NoiseReductionConfig = {
  reductionStrength: number;
  smoothingFactor: number;
  minGain: number;
};

export const DEFAULT_NOISE_CONFIG: NoiseReductionConfig = {
  reductionStrength: 0.8,
  smoothingFactor: 0.95,
  minGain: 0.1,
};

/** Create an empty noise profile. */
export function createNoiseProfile(): NoiseProfile {
  return {
    noiseFloor: new Float32Array(0),
    sampleCount: 0,
  };
}

/**
 * Update the running noise floor estimate from silence/noise-only frames.
 * Uses an exponential moving average when an existing profile exists,
 * or initializes from the first batch of samples.
 */
export function updateNoiseProfile(
  profile: NoiseProfile,
  noiseSamples: Float32Array,
): NoiseProfile {
  if (noiseSamples.length === 0) return profile;

  const len = noiseSamples.length;
  const absValues = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    absValues[i] = Math.abs(noiseSamples[i] ?? 0);
  }

  if (profile.sampleCount === 0 || profile.noiseFloor.length === 0) {
    // First calibration pass — use absolute values directly
    return {
      noiseFloor: absValues,
      sampleCount: len,
    };
  }

  // Exponential moving average: blend the new samples into the existing floor.
  // If sizes differ, extend or truncate to match the incoming frame size.
  const alpha = 0.1; // weight of new observation
  const outLen = Math.max(profile.noiseFloor.length, len);
  const floor = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const prev =
      i < profile.noiseFloor.length ? (profile.noiseFloor[i] ?? 0) : 0;
    const curr = i < len ? (absValues[i] ?? 0) : 0;
    floor[i] = prev * (1 - alpha) + curr * alpha;
  }

  return {
    noiseFloor: floor,
    sampleCount: profile.sampleCount + len,
  };
}

/**
 * Simple time-domain spectral subtraction.
 *
 * For each sample we estimate how much of its magnitude is noise and subtract
 * that portion, applying a minimum gain floor to prevent musical-noise artifacts.
 *
 * This is a simplified approximation: true spectral subtraction operates in the
 * frequency domain, but for offline processing this time-domain version works
 * well enough and keeps the implementation Web-Audio-free.
 */
export function applySpectralSubtraction(
  samples: Float32Array,
  profile: NoiseProfile,
  config: NoiseReductionConfig = DEFAULT_NOISE_CONFIG,
): Float32Array {
  const len = samples.length;
  const out = new Float32Array(len);

  if (profile.sampleCount === 0 || profile.noiseFloor.length === 0) {
    // No noise profile yet — pass through unchanged
    out.set(samples);
    return out;
  }

  for (let i = 0; i < len; i++) {
    const sample = samples[i] ?? 0;
    const absSample = Math.abs(sample);
    const sign = sample >= 0 ? 1 : -1;

    // Look up the noise floor for this position (wrap if frame is longer)
    const noiseIdx = i % profile.noiseFloor.length;
    const noiseLevel =
      (profile.noiseFloor[noiseIdx] ?? 0) * config.reductionStrength;

    // Subtract noise magnitude from signal magnitude
    const reduced = absSample - noiseLevel;

    if (reduced <= 0) {
      // Signal is at or below the noise floor — apply minimum gain
      out[i] = sign * absSample * config.minGain;
    } else {
      // Smooth the transition to avoid harsh artifacts
      const gain = reduced / absSample;
      const smoothedGain =
        gain * config.smoothingFactor +
        config.minGain * (1 - config.smoothingFactor);
      out[i] = sign * absSample * Math.max(smoothedGain, config.minGain);
    }
  }

  return out;
}

/**
 * Estimate signal-to-noise ratio in decibels.
 * Compares RMS power of the signal to the RMS of the noise floor.
 */
export function estimateSnr(
  signal: Float32Array,
  noiseProfile: NoiseProfile,
): number {
  if (signal.length === 0 || noiseProfile.sampleCount === 0) return Infinity;

  // Signal RMS
  let signalSum = 0;
  for (let i = 0; i < signal.length; i++) {
    const v = signal[i] ?? 0;
    signalSum += v * v;
  }
  const signalRms = Math.sqrt(signalSum / signal.length);

  // Noise RMS from profile
  let noiseSum = 0;
  const noiseLen = noiseProfile.noiseFloor.length;
  if (noiseLen === 0) return Infinity;
  for (let i = 0; i < noiseLen; i++) {
    const v = noiseProfile.noiseFloor[i] ?? 0;
    noiseSum += v * v;
  }
  const noiseRms = Math.sqrt(noiseSum / noiseLen);

  if (noiseRms === 0) return Infinity;
  if (signalRms === 0) return -Infinity;

  return 20 * Math.log10(signalRms / noiseRms);
}

/** Returns true when the estimated SNR suggests a noisy environment (< 15 dB). */
export function isNoisyEnvironment(snr: number): boolean {
  return snr < 15;
}

/**
 * Simple noise gate: zero out samples whose absolute value falls below the
 * threshold. Lighter alternative to spectral subtraction for low-CPU scenarios.
 */
export function applySimpleNoiseGate(
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
