import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyGain,
  applyNoiseGate,
  normalize,
  preprocessAudio,
  AUDIO_PRESETS,
} from "./audioPreprocessing";

describe("applyGain", () => {
  it("amplifies samples by gain factor", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const result = applyGain(samples, 2.0);
    assert.ok(Math.abs(result[0]! - 0.2) < 1e-6);
    assert.ok(Math.abs(result[1]! - 0.4) < 1e-6);
    assert.ok(Math.abs(result[2]! - 0.6) < 1e-6);
  });

  it("clamps values to [-1, 1]", () => {
    const samples = new Float32Array([0.5, -0.5]);
    const result = applyGain(samples, 3.0);
    assert.equal(result[0], 1);
    assert.equal(result[1], -1);
  });

  it("handles zero gain", () => {
    const samples = new Float32Array([0.5, -0.5]);
    const result = applyGain(samples, 0);
    assert.ok(Object.is(result[0], 0) || Object.is(result[0], -0));
    assert.ok(Object.is(result[1], 0) || Object.is(result[1], -0));
  });
});

describe("applyNoiseGate", () => {
  it("zeroes out samples below threshold", () => {
    const samples = new Float32Array([0.001, 0.5, -0.002, -0.8]);
    const result = applyNoiseGate(samples, 0.01);
    assert.equal(result[0]!, 0);
    assert.ok(Math.abs(result[1]! - 0.5) < 1e-6);
    assert.equal(result[2]!, 0);
    assert.ok(Math.abs(result[3]! - -0.8) < 1e-6);
  });

  it("keeps samples above threshold untouched", () => {
    const samples = new Float32Array([0.05]);
    const result = applyNoiseGate(samples, 0.01);
    assert.ok(Math.abs(result[0]! - 0.05) < 1e-6);
  });
});

describe("normalize", () => {
  it("scales to peak amplitude 1.0", () => {
    const samples = new Float32Array([0.2, -0.4, 0.1]);
    const result = normalize(samples);
    assert.ok(Math.abs(result[1]! - -1.0) < 1e-6);
    assert.ok(Math.abs(result[0]! - 0.5) < 1e-6);
  });

  it("handles already normalized audio", () => {
    const samples = new Float32Array([1.0, -0.5, 0.0]);
    const result = normalize(samples);
    assert.ok(Math.abs(result[0]! - 1.0) < 1e-6);
    assert.ok(Math.abs(result[1]! - -0.5) < 1e-6);
  });

  it("handles all-zero samples", () => {
    const samples = new Float32Array([0, 0, 0]);
    const result = normalize(samples);
    assert.equal(result[0], 0);
    assert.equal(result[1], 0);
    assert.equal(result[2], 0);
  });
});

describe("preprocessAudio", () => {
  it("applies normal preset", () => {
    const samples = new Float32Array([0.005, 0.3, -0.5]);
    const result = preprocessAudio(samples, AUDIO_PRESETS.normal);
    assert.equal(result[0], 0);
    const peak = Math.max(...Array.from(result).map(Math.abs));
    assert.ok(Math.abs(peak - 1.0) < 1e-6);
  });

  it("applies whisper preset with high gain", () => {
    const samples = new Float32Array([0.1, 0.002, -0.05]);
    const result = preprocessAudio(samples, AUDIO_PRESETS.whisper);
    const peak = Math.max(...Array.from(result).map(Math.abs));
    assert.ok(Math.abs(peak - 1.0) < 1e-6);
  });

  it("applies noisy preset with high noise gate", () => {
    const samples = new Float32Array([0.04, 0.1, -0.03]);
    const result = preprocessAudio(samples, AUDIO_PRESETS.noisy);
    assert.equal(result[0], 0);
    assert.equal(result[2], 0);
  });

  it("skips normalization when preset says false", () => {
    const preset = { gain: 1.0, noiseGateThreshold: 0.0, normalize: false };
    const samples = new Float32Array([0.2, 0.4]);
    const result = preprocessAudio(samples, preset);
    assert.ok(Math.abs(result[0]! - 0.2) < 1e-6);
    assert.ok(Math.abs(result[1]! - 0.4) < 1e-6);
  });
});

describe("edge cases", () => {
  it("handles empty Float32Array for applyGain", () => {
    const result = applyGain(new Float32Array([]), 2.0);
    assert.equal(result.length, 0);
  });

  it("handles empty Float32Array for applyNoiseGate", () => {
    const result = applyNoiseGate(new Float32Array([]), 0.01);
    assert.equal(result.length, 0);
  });

  it("handles empty Float32Array for normalize", () => {
    const result = normalize(new Float32Array([]));
    assert.equal(result.length, 0);
  });

  it("handles empty Float32Array for preprocessAudio", () => {
    const result = preprocessAudio(new Float32Array([]), AUDIO_PRESETS.normal);
    assert.equal(result.length, 0);
  });
});
