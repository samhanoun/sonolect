import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createVadState,
  computeEnergy,
  processVadFrame,
  DEFAULT_VAD_CONFIG,
} from "./vad";
import type { VadConfig } from "./vad";

function makeSilentFrame(length = 160): Float32Array {
  return new Float32Array(length);
}

function makeLoudFrame(length = 160, amplitude = 0.5): Float32Array {
  const frame = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    frame[i] = amplitude;
  }
  return frame;
}

describe("vad", () => {
  describe("DEFAULT_VAD_CONFIG", () => {
    it("has expected default values", () => {
      assert.equal(DEFAULT_VAD_CONFIG.energyThreshold, 0.01);
      assert.equal(DEFAULT_VAD_CONFIG.silenceFrames, 30);
      assert.equal(DEFAULT_VAD_CONFIG.minSpeechFrames, 3);
    });
  });

  describe("createVadState", () => {
    it("returns a fresh initial state", () => {
      const state = createVadState();
      assert.equal(state.isSpeaking, false);
      assert.equal(state.speechFrameCount, 0);
      assert.equal(state.silenceFrameCount, 0);
      assert.equal(state.lastEnergy, 0);
    });
  });

  describe("computeEnergy", () => {
    it("returns 0 for an empty buffer", () => {
      assert.equal(computeEnergy(new Float32Array(0)), 0);
    });

    it("returns 0 for a silent (all-zero) buffer", () => {
      assert.equal(computeEnergy(makeSilentFrame()), 0);
    });

    it("computes RMS correctly for a constant-amplitude buffer", () => {
      const frame = makeLoudFrame(100, 0.5);
      const energy = computeEnergy(frame);
      assert.ok(Math.abs(energy - 0.5) < 1e-6);
    });

    it("computes RMS correctly for a mixed buffer", () => {
      const frame = new Float32Array([0.3, -0.3, 0.3, -0.3]);
      const energy = computeEnergy(frame);
      const expected = Math.sqrt((4 * 0.09) / 4);
      assert.ok(Math.abs(energy - expected) < 1e-6);
    });

    it("returns the absolute value for a single-sample buffer", () => {
      const frame = new Float32Array([0.7]);
      const energy = computeEnergy(frame);
      assert.ok(Math.abs(energy - 0.7) < 1e-6);
    });
  });

  describe("processVadFrame", () => {
    const fastConfig: VadConfig = {
      energyThreshold: 0.01,
      silenceFrames: 2,
      minSpeechFrames: 2,
    };

    it("does not flag speech for a single loud frame (below minSpeechFrames)", () => {
      const state = createVadState();
      const { state: next, result } = processVadFrame(
        state,
        makeLoudFrame(),
        fastConfig,
      );
      assert.equal(result.isSpeech, false);
      assert.equal(next.speechFrameCount, 1);
      assert.equal(next.silenceFrameCount, 0);
    });

    it("flags speech after minSpeechFrames consecutive loud frames", () => {
      let state = createVadState();
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      const { result } = processVadFrame(state, makeLoudFrame(), fastConfig);
      assert.equal(result.isSpeech, true);
      assert.equal(result.speechFrameCount, 2);
    });

    it("remains in speech state during continued loud frames", () => {
      let state = createVadState();
      for (let i = 0; i < 5; i++) {
        const out = processVadFrame(state, makeLoudFrame(), fastConfig);
        state = out.state;
        if (i >= 1) {
          assert.equal(out.result.isSpeech, true);
        }
      }
      assert.equal(state.speechFrameCount, 5);
    });

    it("ends speech after silenceFrames consecutive silent frames", () => {
      let state = createVadState();
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      assert.equal(state.isSpeaking, true);

      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      assert.equal(state.isSpeaking, true);

      const { state: final, result } = processVadFrame(
        state,
        makeSilentFrame(),
        fastConfig,
      );
      assert.equal(result.isSpeech, false);
      assert.equal(final.isSpeaking, false);
      assert.equal(final.speechFrameCount, 0);
    });

    it("tracks energy in state.lastEnergy", () => {
      const state = createVadState();
      const loud = makeLoudFrame(100, 0.4);
      const { state: next } = processVadFrame(state, loud, fastConfig);
      assert.ok(Math.abs(next.lastEnergy - 0.4) < 1e-6);
    });

    it("increments silenceFrameCount for below-threshold frames", () => {
      let state = createVadState();
      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      assert.equal(state.silenceFrameCount, 1);
      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      assert.equal(state.silenceFrameCount, 2);
    });

    it("resets silenceFrameCount on loud frame", () => {
      let state = createVadState();
      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      assert.equal(state.silenceFrameCount, 2);
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      assert.equal(state.silenceFrameCount, 0);
    });

    it("uses DEFAULT_VAD_CONFIG when no config is provided", () => {
      const state = createVadState();
      const { result } = processVadFrame(state, makeLoudFrame());
      assert.equal(result.isSpeech, false);
      assert.ok(result.energy > 0);
    });

    it("speech requires re-accumulation after silence ends speech", () => {
      let state = createVadState();
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      state = processVadFrame(state, makeLoudFrame(), fastConfig).state;
      assert.equal(state.isSpeaking, true);

      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      state = processVadFrame(state, makeSilentFrame(), fastConfig).state;
      assert.equal(state.isSpeaking, false);
      assert.equal(state.speechFrameCount, 0);

      const { result: oneFrame } = processVadFrame(
        state,
        makeLoudFrame(),
        fastConfig,
      );
      assert.equal(oneFrame.isSpeech, false);
      assert.equal(oneFrame.speechFrameCount, 1);
    });

    it("handles threshold-boundary energy correctly", () => {
      const config: VadConfig = {
        energyThreshold: 0.5,
        silenceFrames: 2,
        minSpeechFrames: 1,
      };
      const state = createVadState();
      const atThreshold = makeLoudFrame(100, 0.5);
      const { result } = processVadFrame(state, atThreshold, config);
      assert.equal(result.isSpeech, true);

      const belowThreshold = makeLoudFrame(100, 0.49);
      const { result: below } = processVadFrame(
        createVadState(),
        belowThreshold,
        config,
      );
      assert.equal(below.isSpeech, false);
    });
  });
});
