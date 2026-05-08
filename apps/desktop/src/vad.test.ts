import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  computeFrameEnergy,
  createVadState,
  processVadFrame,
  shouldAutoStopRecording,
  getVadStats,
  DEFAULT_VAD_CONFIG,
  type VadConfig,
  type VadState,
} from "./vad";

/** Helper: create a Float32Array filled with a constant value. */
function constantFrame(value: number, size = 512): Float32Array {
  const f = new Float32Array(size);
  f.fill(value);
  return f;
}

/** Helper: create a "loud" frame above the default energy threshold. */
function loudFrame(size = 512): Float32Array {
  return constantFrame(0.1, size);
}

/** Helper: create a "quiet" frame below the default energy threshold. */
function quietFrame(size = 512): Float32Array {
  return constantFrame(0.001, size);
}

describe("vad", () => {
  describe("computeFrameEnergy", () => {
    it("returns 0 for silence", () => {
      assert.equal(computeFrameEnergy(new Float32Array(512)), 0);
    });

    it("returns 0 for empty buffer", () => {
      assert.equal(computeFrameEnergy(new Float32Array(0)), 0);
    });

    it("returns correct RMS for constant signal", () => {
      const frame = constantFrame(0.5, 100);
      const energy = computeFrameEnergy(frame);
      assert.ok(Math.abs(energy - 0.5) < 1e-6, `Expected 0.5, got ${energy}`);
    });

    it("returns correct RMS for mixed signal", () => {
      // RMS of [0.3, -0.3, 0.3, -0.3] = 0.3
      const frame = new Float32Array([0.3, -0.3, 0.3, -0.3]);
      const energy = computeFrameEnergy(frame);
      assert.ok(Math.abs(energy - 0.3) < 1e-6, `Expected 0.3, got ${energy}`);
    });
  });

  describe("speech detection with loud frames", () => {
    it("detects speech-start after speechMinDuration", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 300,
      };
      let state = createVadState();
      let event = null;

      // Feed loud frames advancing time by 100ms each.
      // Speech-start should fire once we pass 300ms.
      for (let t = 0; t <= 400; t += 100) {
        const result = processVadFrame(state, loudFrame(), t, config);
        state = result.state;
        if (result.event?.type === "speech-start") {
          event = result.event;
        }
      }

      assert.ok(event !== null, "Should have emitted speech-start");
      assert.equal(event!.type, "speech-start");
      assert.ok(state.isSpeaking, "State should be speaking");
    });

    it("does not emit speech-start before speechMinDuration", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 500,
      };
      let state = createVadState();

      // Only 200ms of loud frames — not enough
      for (let t = 0; t <= 200; t += 100) {
        const result = processVadFrame(state, loudFrame(), t, config);
        state = result.state;
        assert.ok(
          result.event === null || result.event.type !== "speech-start",
          `Should not emit speech-start at t=${t}`,
        );
      }
      assert.ok(!state.isSpeaking, "Should not be speaking yet");
    });
  });

  describe("silence detection with quiet frames", () => {
    it("detects speech-end after silence duration", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0, // immediate speech detection
        silenceDurationMs: 500,
      };
      let state = createVadState();

      // Start with loud frame to trigger speech-start
      const r1 = processVadFrame(state, loudFrame(), 0, config);
      state = r1.state;
      assert.equal(r1.event?.type, "speech-start");

      // Now feed quiet frames for 600ms — should trigger speech-end
      let endEvent = null;
      for (let t = 100; t <= 600; t += 100) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
        if (result.event?.type === "speech-end") {
          endEvent = result.event;
        }
      }

      assert.ok(endEvent !== null, "Should have emitted speech-end");
      assert.ok(!state.isSpeaking, "Should no longer be speaking");
    });

    it("emits silence-detected events before speech-end", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0,
        silenceDurationMs: 500,
      };
      let state = createVadState();

      // Start speaking
      const r = processVadFrame(state, loudFrame(), 0, config);
      state = r.state;

      // First quiet frame should emit silence-detected
      const r2 = processVadFrame(state, quietFrame(), 100, config);
      state = r2.state;
      assert.equal(r2.event?.type, "silence-detected");
    });
  });

  describe("speech-start event timing", () => {
    it("fires at the frame that crosses speechMinDuration", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 200,
      };
      let state = createVadState();
      let speechStartTime: number | null = null;

      for (let t = 0; t <= 300; t += 100) {
        const result = processVadFrame(state, loudFrame(), t, config);
        state = result.state;
        if (result.event?.type === "speech-start") {
          speechStartTime = result.event.timestampMs;
        }
      }

      assert.ok(speechStartTime !== null, "speech-start should have fired");
      assert.ok(
        speechStartTime! >= 200,
        `speech-start should fire at or after 200ms, got ${speechStartTime}`,
      );
    });
  });

  describe("speech-end after silence duration", () => {
    it("fires at the frame that crosses silenceDurationMs", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0,
        silenceDurationMs: 300,
      };
      let state = createVadState();

      // Trigger speech
      const r = processVadFrame(state, loudFrame(), 0, config);
      state = r.state;

      // Feed silence
      let endTime: number | null = null;
      for (let t = 100; t <= 500; t += 100) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
        if (result.event?.type === "speech-end") {
          endTime = result.event.timestampMs;
          break;
        }
      }

      assert.ok(endTime !== null, "speech-end should have fired");
      assert.ok(
        endTime! >= 400,
        `speech-end should fire after silence started at 100 + 300ms duration, got ${endTime}`,
      );
    });
  });

  describe("false pause rejection", () => {
    it("resets silence timer when speech resumes mid-pause", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0,
        silenceDurationMs: 500,
      };
      let state = createVadState();

      // Start speaking
      const r = processVadFrame(state, loudFrame(), 0, config);
      state = r.state;
      assert.equal(r.event?.type, "speech-start");

      // 200ms of silence (not enough for speech-end)
      for (let t = 100; t <= 200; t += 100) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
        assert.ok(
          result.event?.type !== "speech-end",
          "Should not end speech during brief pause",
        );
      }

      // Speech resumes
      const r2 = processVadFrame(state, loudFrame(), 300, config);
      state = r2.state;
      assert.ok(state.isSpeaking, "Should still be speaking after false pause");
      assert.equal(state.silenceStartMs, null, "Silence timer should be reset");

      // Another 400ms of silence — still not enough since timer was reset
      for (let t = 400; t <= 700; t += 100) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
      }
      // At t=700, silence started at 400, duration = 300 < 500 → no speech-end
      assert.ok(
        state.isSpeaking,
        "Should still be speaking (silence timer was reset)",
      );

      // More silence to finally trigger speech-end
      for (let t = 800; t <= 1000; t += 100) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
      }
      // At t=1000, silence started at 400, duration = 600 >= 500
      assert.ok(!state.isSpeaking, "Should have ended speech now");
    });
  });

  describe("shouldAutoStopRecording", () => {
    it("returns false for initial state", () => {
      assert.equal(shouldAutoStopRecording(createVadState()), false);
    });

    it("returns true after speech-end has been emitted", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0,
        silenceDurationMs: 100,
      };
      let state = createVadState();

      // Speech
      const r = processVadFrame(state, loudFrame(), 0, config);
      state = r.state;

      // Silence to trigger speech-end
      for (let t = 50; t <= 200; t += 50) {
        const result = processVadFrame(state, quietFrame(), t, config);
        state = result.state;
      }

      assert.ok(!state.isSpeaking, "Speech should have ended");
      assert.ok(state.speechFrames > 0, "Should have recorded speech frames");
      assert.equal(shouldAutoStopRecording(state, config), true);
    });

    it("returns false when no speech has occurred", () => {
      let state = createVadState();
      // Feed only silence
      for (let t = 0; t <= 500; t += 100) {
        const result = processVadFrame(state, quietFrame(), t);
        state = result.state;
      }
      assert.equal(shouldAutoStopRecording(state), false);
    });
  });

  describe("getVadStats", () => {
    it("returns zeroes for initial state", () => {
      const stats = getVadStats(createVadState());
      assert.equal(stats.speechPercentage, 0);
      assert.equal(stats.silencePercentage, 0);
      assert.equal(stats.averageEnergy, 0);
    });

    it("calculates correct speech/silence percentages", () => {
      const state: VadState = {
        isSpeaking: false,
        silenceStartMs: null,
        speechStartMs: null,
        frameCount: 10,
        speechFrames: 3,
        silenceFrames: 7,
      };
      const stats = getVadStats(state);
      assert.ok(
        Math.abs(stats.speechPercentage - 30) < 0.1,
        `Expected 30%, got ${stats.speechPercentage}`,
      );
      assert.ok(
        Math.abs(stats.silencePercentage - 70) < 0.1,
        `Expected 70%, got ${stats.silencePercentage}`,
      );
    });

    it("shows 100% speech when only speech frames", () => {
      const state: VadState = {
        isSpeaking: true,
        silenceStartMs: null,
        speechStartMs: 0,
        frameCount: 5,
        speechFrames: 5,
        silenceFrames: 0,
      };
      const stats = getVadStats(state);
      assert.equal(stats.speechPercentage, 100);
      assert.equal(stats.silencePercentage, 0);
    });
  });

  describe("realistic audio patterns", () => {
    it("handles alternating speech and silence blocks", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 200,
        silenceDurationMs: 500,
      };
      let state = createVadState();
      const events: Array<{ type: string; t: number }> = [];

      // Block 1: 400ms speech
      for (let t = 0; t <= 400; t += 50) {
        const r = processVadFrame(state, loudFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      // Block 2: 300ms silence (not enough for speech-end)
      for (let t = 450; t <= 700; t += 50) {
        const r = processVadFrame(state, quietFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      // Block 3: 200ms speech (false pause recovery)
      for (let t = 750; t <= 900; t += 50) {
        const r = processVadFrame(state, loudFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      // Block 4: 800ms silence (triggers speech-end)
      for (let t = 950; t <= 1700; t += 50) {
        const r = processVadFrame(state, quietFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      // Should have exactly one speech-start and one speech-end
      const starts = events.filter((e) => e.type === "speech-start");
      const ends = events.filter((e) => e.type === "speech-end");

      assert.equal(starts.length, 1, "Should have exactly one speech-start");
      assert.equal(ends.length, 1, "Should have exactly one speech-end");
      assert.ok(
        starts[0]!.t < ends[0]!.t,
        "speech-start should come before speech-end",
      );
    });

    it("handles multiple speech segments", () => {
      const config: VadConfig = {
        ...DEFAULT_VAD_CONFIG,
        speechMinDurationMs: 0,
        silenceDurationMs: 200,
      };
      let state = createVadState();
      const events: Array<{ type: string; t: number }> = [];

      // Segment 1: speech then silence
      const r1 = processVadFrame(state, loudFrame(), 0, config);
      state = r1.state;
      if (r1.event) events.push({ type: r1.event.type, t: 0 });

      for (let t = 100; t <= 300; t += 100) {
        const r = processVadFrame(state, quietFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      // Segment 2: speech again then silence
      const r2 = processVadFrame(state, loudFrame(), 400, config);
      state = r2.state;
      if (r2.event) events.push({ type: r2.event.type, t: 400 });

      for (let t = 500; t <= 700; t += 100) {
        const r = processVadFrame(state, quietFrame(), t, config);
        state = r.state;
        if (r.event) events.push({ type: r.event.type, t });
      }

      const starts = events.filter((e) => e.type === "speech-start");
      const ends = events.filter((e) => e.type === "speech-end");

      assert.equal(starts.length, 2, "Should have two speech-start events");
      assert.equal(ends.length, 2, "Should have two speech-end events");
    });
  });
});
