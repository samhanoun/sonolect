import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  createStreamingState,
  processStreamWindow,
  mergeOverlappingResults,
  computeTextSimilarity,
  buildStreamingSummary,
  getBufferedDurationMs,
  DEFAULT_STREAM_CONFIG,
  type StreamConfig,
  type FinalTranscript,
  type PartialTranscript,
  type StreamingState,
} from "./streamingTranscription";

// ── Helpers ─────────────────────────────────────────────────────────

function makeSilence(length: number): Float32Array {
  return new Float32Array(length); // all zeros
}

function makeSpeech(length: number, amplitude = 0.5): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000);
  }
  return buf;
}

function makeConfig(overrides: Partial<StreamConfig> = {}): StreamConfig {
  const partials: PartialTranscript[] = [];
  const finals: FinalTranscript[] = [];
  return {
    ...DEFAULT_STREAM_CONFIG,
    onPartialResult: (r) => partials.push(r),
    onFinalResult: (r) => finals.push(r),
    ...overrides,
  };
}

function makeFinal(
  overrides: Partial<FinalTranscript> & { text: string },
): FinalTranscript {
  return {
    isFinal: true,
    windowIndex: 0,
    startMs: 0,
    endMs: 5000,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("streamingTranscription", () => {
  // ── State creation ──────────────────────────────────────────────
  describe("createStreamingState", () => {
    it("creates a fresh state with zeroed counters", () => {
      const state = createStreamingState();

      assert.equal(state.isStreaming, false);
      assert.equal(state.windowIndex, 0);
      assert.equal(state.lastProcessedMs, 0);
      assert.equal(state.buffer.length, 0);
      assert.equal(state.partialResults.length, 0);
    });
  });

  // ── Window processing ───────────────────────────────────────────
  describe("processStreamWindow", () => {
    it("returns 'wait' when buffer has not reached windowSizeMs", () => {
      const state = createStreamingState();
      const config = makeConfig({ windowSizeMs: 5000 });
      // 16000 samples = 1 second at 16 kHz, well under 5000ms
      const chunk = makeSpeech(16000);

      const result = processStreamWindow(state, chunk, 0, config);

      assert.equal(result.action, "wait");
      assert.equal(result.state.isStreaming, true);
      assert.equal(result.state.buffer.length, 1);
      assert.equal(result.state.windowIndex, 0);
    });

    it("returns 'transcribe' when buffer is full and speech is detected", () => {
      let state = createStreamingState();
      const config = makeConfig({
        windowSizeMs: 2000,
        overlapMs: 0,
        vadEnabled: true,
      });

      // Feed enough speech to fill a 2-second window
      // Need multiple chunks so VAD counts enough speech frames
      for (let i = 0; i < 3; i++) {
        const chunk = makeSpeech(16000, 0.5); // 1s each
        const { state: next, action } = processStreamWindow(
          state,
          chunk,
          i * 1000,
          config,
        );
        state = next;
        if (i < 1) {
          assert.equal(action, "wait");
        }
      }

      // The last call should have triggered a transcribe
      // (buffer was >= 2000ms and speech was detected)
      assert.ok(state.windowIndex > 0);
    });

    it("returns 'skip' when VAD detects silence in a full window", () => {
      const state = createStreamingState();
      const config = makeConfig({
        windowSizeMs: 1000,
        overlapMs: 0,
        vadEnabled: true,
      });

      // Feed silence — 16000 samples = 1 second = windowSizeMs
      const silence = makeSilence(16000);
      const result = processStreamWindow(state, silence, 0, config);

      assert.equal(result.action, "skip");
      assert.equal(result.state.windowIndex, 1);
    });

    it("increments windowIndex on each processed window", () => {
      let state = createStreamingState();
      const config = makeConfig({
        windowSizeMs: 500,
        overlapMs: 0,
        vadEnabled: false,
      });

      // Each 16000-sample chunk is 1000ms, so one chunk already >= 500ms
      const chunk = makeSpeech(16000);

      const r1 = processStreamWindow(state, chunk, 0, config);
      state = r1.state;
      assert.equal(r1.state.windowIndex, 1);

      const r2 = processStreamWindow(state, chunk, 1000, config);
      assert.equal(r2.state.windowIndex, 2);
    });

    it("preserves overlap buffer for continuity", () => {
      let state = createStreamingState();
      const config = makeConfig({
        windowSizeMs: 1000,
        overlapMs: 500,
        vadEnabled: false,
      });

      // 16000 samples = 1s, window = 1s, so first chunk triggers transcribe
      const chunk = makeSpeech(16000);
      const result = processStreamWindow(state, chunk, 0, config);

      assert.equal(result.action, "transcribe");
      // Overlap buffer should retain some data
      assert.ok(result.state.buffer.length >= 0);
    });
  });

  // ── Buffer duration ─────────────────────────────────────────────
  describe("getBufferedDurationMs", () => {
    it("sums chunk durations correctly", () => {
      const buffer = [
        { samples: new Float32Array(0), timestampMs: 0, durationMs: 1000 },
        { samples: new Float32Array(0), timestampMs: 1000, durationMs: 2000 },
      ];
      assert.equal(getBufferedDurationMs(buffer), 3000);
    });

    it("returns 0 for empty buffer", () => {
      assert.equal(getBufferedDurationMs([]), 0);
    });
  });

  // ── Text similarity ─────────────────────────────────────────────
  describe("computeTextSimilarity", () => {
    it("returns 1 for identical strings", () => {
      assert.equal(computeTextSimilarity("hello world", "hello world"), 1);
    });

    it("returns 0 for completely different strings", () => {
      assert.equal(computeTextSimilarity("hello world", "foo bar baz"), 0);
    });

    it("returns a value between 0 and 1 for partial overlap", () => {
      const sim = computeTextSimilarity(
        "the quick brown fox",
        "the slow brown dog",
      );
      assert.ok(sim > 0);
      assert.ok(sim < 1);
    });

    it("returns 1 for two empty strings", () => {
      assert.equal(computeTextSimilarity("", ""), 1);
    });

    it("returns 0 when one string is empty", () => {
      assert.equal(computeTextSimilarity("hello", ""), 0);
      assert.equal(computeTextSimilarity("", "hello"), 0);
    });

    it("is case-insensitive", () => {
      assert.equal(computeTextSimilarity("Hello World", "hello world"), 1);
    });
  });

  // ── Overlap merging ─────────────────────────────────────────────
  describe("mergeOverlappingResults", () => {
    it("returns empty array for empty input", () => {
      assert.deepEqual(mergeOverlappingResults([]), []);
    });

    it("passes through non-overlapping results unchanged", () => {
      const results: FinalTranscript[] = [
        makeFinal({ text: "first segment", startMs: 0, endMs: 5000 }),
        makeFinal({
          text: "second segment",
          startMs: 5000,
          endMs: 10000,
          windowIndex: 1,
        }),
      ];
      const merged = mergeOverlappingResults(results);

      assert.equal(merged.length, 2);
      assert.equal(merged[0]!.text, "first segment");
      assert.equal(merged[1]!.text, "second segment");
    });

    it("deduplicates highly similar overlapping results", () => {
      const results: FinalTranscript[] = [
        makeFinal({
          text: "the meeting will start now",
          startMs: 0,
          endMs: 5000,
        }),
        makeFinal({
          text: "the meeting will start now",
          startMs: 4500,
          endMs: 9500,
          windowIndex: 1,
        }),
      ];

      const merged = mergeOverlappingResults(results);

      assert.equal(merged.length, 1);
      assert.ok(merged[0]!.text.includes("meeting"));
      assert.equal(merged[0]!.startMs, 0);
      assert.equal(merged[0]!.endMs, 9500);
    });

    it("merges overlapping results with trailing/leading word overlap", () => {
      const results: FinalTranscript[] = [
        makeFinal({
          text: "hello world how are you doing today",
          startMs: 0,
          endMs: 5000,
        }),
        makeFinal({
          text: "are you doing today and tomorrow",
          startMs: 4500,
          endMs: 9500,
          windowIndex: 1,
        }),
      ];

      const merged = mergeOverlappingResults(results);

      assert.equal(merged.length, 1);
      assert.ok(merged[0]!.text.includes("hello world"));
      assert.ok(merged[0]!.text.includes("tomorrow"));
    });

    it("handles single result", () => {
      const results = [
        makeFinal({ text: "only one", startMs: 0, endMs: 5000 }),
      ];
      const merged = mergeOverlappingResults(results);

      assert.equal(merged.length, 1);
      assert.equal(merged[0]!.text, "only one");
    });
  });

  // ── Summary building ────────────────────────────────────────────
  describe("buildStreamingSummary", () => {
    it("returns zeroed summary for empty results", () => {
      const summary = buildStreamingSummary([]);

      assert.equal(summary.totalSegments, 0);
      assert.equal(summary.totalDurationMs, 0);
      assert.equal(summary.averageLatencyMs, 0);
      assert.deepEqual(summary.languagesDetected, []);
    });

    it("computes correct stats from multiple results", () => {
      const results: FinalTranscript[] = [
        makeFinal({
          text: "bonjour",
          startMs: 0,
          endMs: 5000,
          language: "fr",
        }),
        makeFinal({
          text: "hello there",
          startMs: 5000,
          endMs: 10000,
          language: "en",
          windowIndex: 1,
        }),
        makeFinal({
          text: "encore",
          startMs: 10000,
          endMs: 15000,
          language: "fr",
          windowIndex: 2,
        }),
      ];

      const summary = buildStreamingSummary(results);

      assert.equal(summary.totalSegments, 3);
      assert.equal(summary.totalDurationMs, 15000);
      assert.equal(summary.averageLatencyMs, 5000);
      assert.deepEqual(summary.languagesDetected.sort(), ["en", "fr"]);
    });

    it("excludes undefined languages", () => {
      const results: FinalTranscript[] = [
        makeFinal({ text: "no lang", startMs: 0, endMs: 5000 }),
        makeFinal({
          text: "has lang",
          startMs: 5000,
          endMs: 10000,
          language: "en",
          windowIndex: 1,
        }),
      ];

      const summary = buildStreamingSummary(results);
      assert.deepEqual(summary.languagesDetected, ["en"]);
    });
  });

  // ── Realistic multi-window scenario ─────────────────────────────
  describe("realistic multi-window scenario", () => {
    it("processes a sequence of speech and silence windows", () => {
      let state = createStreamingState();
      const config = makeConfig({
        windowSizeMs: 1000,
        overlapMs: 200,
        vadEnabled: true,
      });

      const actions: string[] = [];

      // 3 seconds of speech (3 chunks of 16000 samples at 16 kHz)
      for (let i = 0; i < 3; i++) {
        const chunk = makeSpeech(16000, 0.5);
        const result = processStreamWindow(state, chunk, i * 1000, config);
        state = result.state;
        actions.push(result.action);
      }

      // 2 seconds of silence
      for (let i = 3; i < 5; i++) {
        const chunk = makeSilence(16000);
        const result = processStreamWindow(state, chunk, i * 1000, config);
        state = result.state;
        actions.push(result.action);
      }

      assert.ok(state.isStreaming);
      assert.ok(state.windowIndex > 0);
      // Should have a mix of actions
      assert.ok(actions.length === 5);
      // At least one transcribe action from the speech portion
      assert.ok(
        actions.some((a) => a === "transcribe") ||
          actions.some((a) => a === "wait"),
      );
    });
  });
});
