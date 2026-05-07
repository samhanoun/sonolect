import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createNoiseProfile,
  updateNoiseProfile,
  applySpectralSubtraction,
  estimateSnr,
  isNoisyEnvironment,
  applySimpleNoiseGate,
  DEFAULT_NOISE_CONFIG,
} from "./noiseCancellation";

/** Helper: create a Float32Array filled with a constant. */
function constant(value: number, size = 256): Float32Array {
  const f = new Float32Array(size);
  f.fill(value);
  return f;
}

/** Helper: generate a sine wave. */
function sineWave(
  amplitude: number,
  frequency: number,
  sampleRate: number,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return out;
}

/** Helper: add two Float32Arrays element-wise. */
function addArrays(a: Float32Array, b: Float32Array): Float32Array {
  const len = Math.min(a.length, b.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }
  return out;
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

describe("noiseCancellation", () => {
  describe("createNoiseProfile", () => {
    it("returns an empty profile", () => {
      const profile = createNoiseProfile();
      assert.equal(profile.sampleCount, 0);
      assert.equal(profile.noiseFloor.length, 0);
    });
  });

  describe("updateNoiseProfile", () => {
    it("initializes from first batch of samples", () => {
      const profile = createNoiseProfile();
      const noise = new Float32Array([0.01, -0.02, 0.015, -0.005]);
      const updated = updateNoiseProfile(profile, noise);

      assert.equal(updated.sampleCount, 4);
      assert.equal(updated.noiseFloor.length, 4);
      // Should store absolute values
      assert.ok(Math.abs(updated.noiseFloor[0]! - 0.01) < 1e-6);
      assert.ok(Math.abs(updated.noiseFloor[1]! - 0.02) < 1e-6);
    });

    it("blends subsequent samples via moving average", () => {
      let profile = createNoiseProfile();
      const noise1 = constant(0.01, 4);
      profile = updateNoiseProfile(profile, noise1);

      const noise2 = constant(0.05, 4);
      profile = updateNoiseProfile(profile, noise2);

      // After blending: 0.01 * 0.9 + 0.05 * 0.1 = 0.014
      assert.ok(
        Math.abs(profile.noiseFloor[0]! - 0.014) < 1e-6,
        `Expected ~0.014, got ${profile.noiseFloor[0]}`,
      );
    });

    it("handles empty noise samples gracefully", () => {
      const profile = createNoiseProfile();
      const updated = updateNoiseProfile(profile, new Float32Array(0));
      assert.equal(updated.sampleCount, 0);
    });
  });

  describe("applySpectralSubtraction", () => {
    it("passes through unchanged when no noise profile exists", () => {
      const profile = createNoiseProfile();
      const signal = new Float32Array([0.5, -0.3, 0.7]);
      const result = applySpectralSubtraction(signal, profile);

      assert.ok(Math.abs(result[0]! - 0.5) < 1e-6);
      assert.ok(Math.abs(result[1]! - -0.3) < 1e-6);
      assert.ok(Math.abs(result[2]! - 0.7) < 1e-6);
    });

    it("reduces noise from signal", () => {
      // Create a noise profile from quiet background
      const noise = constant(0.05, 256);
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      // Create a signal with noise floor + speech
      const signal = constant(0.3, 256);
      const result = applySpectralSubtraction(signal, profile);

      // Result should have lower RMS than input (noise removed)
      const inputRms = rms(signal);
      const outputRms = rms(result);
      assert.ok(
        outputRms < inputRms,
        `Output RMS ${outputRms} should be less than input ${inputRms}`,
      );
    });

    it("preserves signal polarity", () => {
      const noise = constant(0.01, 4);
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      const signal = new Float32Array([0.5, -0.5, 0.3, -0.3]);
      const result = applySpectralSubtraction(signal, profile);

      assert.ok(result[0]! > 0, "Positive sample should stay positive");
      assert.ok(result[1]! < 0, "Negative sample should stay negative");
      assert.ok(result[2]! > 0, "Positive sample should stay positive");
      assert.ok(result[3]! < 0, "Negative sample should stay negative");
    });
  });

  describe("estimateSnr", () => {
    it("returns Infinity for empty signal", () => {
      const profile = createNoiseProfile();
      assert.equal(estimateSnr(new Float32Array(0), profile), Infinity);
    });

    it("returns Infinity when no noise profile", () => {
      const signal = constant(0.5, 100);
      assert.equal(estimateSnr(signal, createNoiseProfile()), Infinity);
    });

    it("returns high SNR for clean signal with low noise floor", () => {
      const noise = constant(0.001, 100);
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      const signal = constant(0.5, 100);
      const snr = estimateSnr(signal, profile);
      // 20 * log10(0.5 / 0.001) = 20 * log10(500) ≈ 54 dB
      assert.ok(snr > 40, `Expected high SNR, got ${snr}`);
    });

    it("returns low SNR for noisy signal", () => {
      const noise = constant(0.3, 100);
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      const signal = constant(0.35, 100);
      const snr = estimateSnr(signal, profile);
      // 20 * log10(0.35 / 0.3) ≈ 1.3 dB
      assert.ok(snr < 5, `Expected low SNR, got ${snr}`);
    });
  });

  describe("isNoisyEnvironment", () => {
    it("returns true for SNR below 15 dB", () => {
      assert.equal(isNoisyEnvironment(10), true);
      assert.equal(isNoisyEnvironment(0), true);
      assert.equal(isNoisyEnvironment(14.9), true);
      assert.equal(isNoisyEnvironment(-5), true);
    });

    it("returns false for SNR at or above 15 dB", () => {
      assert.equal(isNoisyEnvironment(15), false);
      assert.equal(isNoisyEnvironment(20), false);
      assert.equal(isNoisyEnvironment(50), false);
    });
  });

  describe("applySimpleNoiseGate", () => {
    it("zeroes samples below threshold", () => {
      const input = new Float32Array([0.001, -0.002, 0.1, -0.5]);
      const result = applySimpleNoiseGate(input, 0.01);

      assert.ok(Math.abs(result[0]!) < 1e-9);
      assert.ok(Math.abs(result[1]!) < 1e-9);
      assert.ok(Math.abs(result[2]! - 0.1) < 1e-6);
      assert.ok(Math.abs(result[3]! - -0.5) < 1e-6);
    });

    it("keeps all samples when threshold is 0", () => {
      const input = new Float32Array([0.001, 0.5, -0.3]);
      const result = applySimpleNoiseGate(input, 0);
      for (let i = 0; i < input.length; i++) {
        assert.ok(Math.abs(result[i]! - input[i]!) < 1e-6);
      }
    });
  });

  describe("min gain prevents artifacts", () => {
    it("output is never fully zero when signal present and minGain > 0", () => {
      // Build a noise profile that matches the signal amplitude
      const noise = constant(0.1, 128);
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      // Signal at noise floor level
      const signal = constant(0.1, 128);
      const config = { ...DEFAULT_NOISE_CONFIG, minGain: 0.1 };
      const result = applySpectralSubtraction(signal, profile, config);

      // Every sample should be >= minGain * abs(sample)
      for (let i = 0; i < result.length; i++) {
        const absResult = Math.abs(result[i]!);
        assert.ok(
          absResult >= 0.1 * 0.1 - 1e-6,
          `Sample ${i} too low: ${absResult}`,
        );
      }
    });
  });

  describe("synthetic noise + signal combination", () => {
    it("reduces constant-level noise from a mixed signal", () => {
      const len = 1024;

      // Pure signal: 440Hz sine wave at amplitude 0.3
      const cleanSignal = sineWave(0.3, 440, 16000, len);

      // Significant constant noise
      const noise = constant(0.15, len);

      // Mixed = signal + noise
      const mixed = addArrays(cleanSignal, noise);

      // Build noise profile from the noise alone
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, noise);

      // Apply subtraction
      const cleaned = applySpectralSubtraction(mixed, profile);

      // Overall energy should decrease — noise was removed
      const mixedRms = rms(mixed);
      const cleanedRms = rms(cleaned);
      assert.ok(
        cleanedRms < mixedRms,
        `Cleaned RMS (${cleanedRms}) should be less than mixed RMS (${mixedRms})`,
      );

      // Signal should still be present (not zeroed out)
      assert.ok(
        cleanedRms > 0.01,
        `Cleaned signal should retain energy, got RMS ${cleanedRms}`,
      );
    });

    it("reduces broadband noise energy overall", () => {
      const len = 512;

      // Signal with some speech-like content
      const signal = sineWave(0.4, 300, 16000, len);

      // Broadband noise simulated as sum of multiple frequencies
      const noise1 = sineWave(0.03, 50, 16000, len);
      const noise2 = sineWave(0.03, 120, 16000, len);
      const broadbandNoise = addArrays(noise1, noise2);

      const mixed = addArrays(signal, broadbandNoise);

      // Build profile from noise
      let profile = createNoiseProfile();
      profile = updateNoiseProfile(profile, broadbandNoise);

      const cleaned = applySpectralSubtraction(mixed, profile);

      // Overall energy should decrease
      const mixedEnergy = rms(mixed);
      const cleanedEnergy = rms(cleaned);
      assert.ok(
        cleanedEnergy < mixedEnergy,
        `Cleaned energy (${cleanedEnergy}) should be less than mixed (${mixedEnergy})`,
      );
    });
  });
});
