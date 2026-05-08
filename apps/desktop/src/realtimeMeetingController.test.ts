import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  createRealtimeMeeting,
  handleStreamResult,
  pauseRealtimeMeeting,
  resumeRealtimeMeeting,
  endRealtimeMeeting,
  computeWpm,
  getRealtimeTranscriptText,
  type RealtimeMeetingState,
} from "./realtimeMeetingController";

import type { FinalTranscript } from "./streamingTranscription";

// ── Helpers ─────────────────────────────────────────────────────────

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

describe("realtimeMeetingController", () => {
  // ── Meeting creation ────────────────────────────────────────────
  describe("createRealtimeMeeting", () => {
    it("creates an active meeting with correct title and language", () => {
      const state = createRealtimeMeeting({
        title: "Daily Standup",
        language: "en",
      });

      assert.equal(state.isActive, true);
      assert.equal(state.meeting.config.title, "Daily Standup");
      assert.equal(state.meeting.config.language, "en");
      assert.equal(state.meeting.status, "active");
      assert.equal(state.streaming.isStreaming, true);
      assert.equal(state.liveTranscript.length, 0);
      assert.equal(state.stats.totalWords, 0);
      assert.equal(state.stats.wordsPerMinute, 0);
    });

    it("uses provided meeting config overrides", () => {
      const state = createRealtimeMeeting({
        title: "Review",
        language: "fr",
        meetingConfig: { speakerCount: 3, autoSave: false },
      });

      assert.equal(state.meeting.config.speakerCount, 3);
      assert.equal(state.meeting.config.autoSave, false);
    });
  });

  // ── Result handling ─────────────────────────────────────────────
  describe("handleStreamResult", () => {
    it("adds a result to the live transcript and updates stats", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      const result = makeFinal({
        text: "hello world from the meeting",
        startMs: 0,
        endMs: 5000,
      });

      const updated = handleStreamResult(state, result);

      assert.equal(updated.liveTranscript.length, 1);
      assert.equal(updated.stats.totalWords, 5);
      assert.ok(updated.stats.latencyMs > 0);
      assert.equal(updated.meeting.segments.length, 1);
      assert.equal(
        updated.meeting.segments[0]!.text,
        "hello world from the meeting",
      );
    });

    it("accumulates multiple results correctly", () => {
      let state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      state = handleStreamResult(
        state,
        makeFinal({ text: "first segment here", startMs: 0, endMs: 5000 }),
      );
      state = handleStreamResult(
        state,
        makeFinal({
          text: "second segment there",
          startMs: 5000,
          endMs: 10000,
          windowIndex: 1,
        }),
      );

      assert.equal(state.liveTranscript.length, 2);
      assert.equal(state.stats.totalWords, 6);
      assert.equal(state.meeting.segments.length, 2);
    });

    it("preserves speaker information in segments", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      const result = makeFinal({
        text: "I think we should proceed",
        startMs: 0,
        endMs: 5000,
        speaker: "Alice",
      });

      const updated = handleStreamResult(state, result);
      assert.equal(updated.meeting.segments[0]!.speaker, "Alice");
    });
  });

  // ── WPM calculation ─────────────────────────────────────────────
  describe("computeWpm", () => {
    it("returns 0 for empty transcript", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });
      assert.equal(computeWpm(state), 0);
    });

    it("computes words per minute correctly", () => {
      let state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      // 10 words over 1 minute (60000ms)
      state = handleStreamResult(
        state,
        makeFinal({
          text: "one two three four five six seven eight nine ten",
          startMs: 0,
          endMs: 60000,
        }),
      );

      const wpm = computeWpm(state);
      assert.equal(wpm, 10);
    });

    it("handles multiple segments spanning time", () => {
      let state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      // 5 words at 0-30s + 5 words at 30s-60s = 10 words in 1 min
      state = handleStreamResult(
        state,
        makeFinal({
          text: "one two three four five",
          startMs: 0,
          endMs: 30000,
        }),
      );
      state = handleStreamResult(
        state,
        makeFinal({
          text: "six seven eight nine ten",
          startMs: 30000,
          endMs: 60000,
          windowIndex: 1,
        }),
      );

      assert.equal(computeWpm(state), 10);
    });
  });

  // ── Pause / Resume ──────────────────────────────────────────────
  describe("pause and resume", () => {
    it("pauses the meeting and stops streaming", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      const paused = pauseRealtimeMeeting(state);

      assert.equal(paused.isActive, false);
      assert.equal(paused.meeting.status, "paused");
      assert.equal(paused.streaming.isStreaming, false);
    });

    it("resumes the meeting and restarts streaming", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      const paused = pauseRealtimeMeeting(state);
      const resumed = resumeRealtimeMeeting(paused);

      assert.equal(resumed.isActive, true);
      assert.equal(resumed.meeting.status, "active");
      assert.equal(resumed.streaming.isStreaming, true);
    });

    it("preserves transcript across pause/resume cycle", () => {
      let state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      state = handleStreamResult(
        state,
        makeFinal({ text: "before pause", startMs: 0, endMs: 5000 }),
      );

      const paused = pauseRealtimeMeeting(state);
      const resumed = resumeRealtimeMeeting(paused);

      assert.equal(resumed.liveTranscript.length, 1);
      assert.equal(resumed.liveTranscript[0]!.text, "before pause");
    });
  });

  // ── End meeting ─────────────────────────────────────────────────
  describe("endRealtimeMeeting", () => {
    it("ends the meeting and finalizes stats", () => {
      let state = createRealtimeMeeting({
        title: "Sprint Review",
        language: "en",
      });

      state = handleStreamResult(
        state,
        makeFinal({
          text: "the sprint went well overall",
          startMs: 0,
          endMs: 30000,
        }),
      );

      const ended = endRealtimeMeeting(state);

      assert.equal(ended.isActive, false);
      assert.equal(ended.meeting.status, "completed");
      assert.equal(ended.streaming.isStreaming, false);
      assert.equal(ended.stats.totalWords, 5);
      assert.ok(ended.stats.wordsPerMinute > 0);
    });

    it("handles ending an empty meeting", () => {
      const state = createRealtimeMeeting({
        title: "Empty",
        language: "en",
      });

      const ended = endRealtimeMeeting(state);

      assert.equal(ended.isActive, false);
      assert.equal(ended.meeting.status, "completed");
      assert.equal(ended.stats.totalWords, 0);
    });
  });

  // ── Transcript text ─────────────────────────────────────────────
  describe("getRealtimeTranscriptText", () => {
    it("returns empty string for empty transcript", () => {
      const state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });
      assert.equal(getRealtimeTranscriptText(state), "");
    });

    it("concatenates transcript segments with double newlines", () => {
      let state = createRealtimeMeeting({
        title: "Test",
        language: "en",
      });

      state = handleStreamResult(
        state,
        makeFinal({ text: "First segment", startMs: 0, endMs: 5000 }),
      );
      state = handleStreamResult(
        state,
        makeFinal({
          text: "Second segment",
          startMs: 5000,
          endMs: 10000,
          windowIndex: 1,
        }),
      );

      const text = getRealtimeTranscriptText(state);
      assert.equal(text, "First segment\n\nSecond segment");
    });
  });

  // ── Full lifecycle ──────────────────────────────────────────────
  describe("full meeting lifecycle", () => {
    it("create → results → pause → resume → results → end", () => {
      let state = createRealtimeMeeting({
        title: "Team Sync",
        language: "en",
      });

      // Initial results
      state = handleStreamResult(
        state,
        makeFinal({
          text: "let us start with updates",
          startMs: 0,
          endMs: 5000,
        }),
      );
      assert.equal(state.liveTranscript.length, 1);

      // Pause
      state = pauseRealtimeMeeting(state);
      assert.equal(state.isActive, false);

      // Resume
      state = resumeRealtimeMeeting(state);
      assert.equal(state.isActive, true);

      // More results
      state = handleStreamResult(
        state,
        makeFinal({
          text: "the backend migration is complete",
          startMs: 5000,
          endMs: 10000,
          windowIndex: 1,
        }),
      );
      assert.equal(state.liveTranscript.length, 2);

      // End
      state = endRealtimeMeeting(state);
      assert.equal(state.isActive, false);
      assert.equal(state.meeting.status, "completed");
      assert.equal(state.stats.totalWords, 10);

      const text = getRealtimeTranscriptText(state);
      assert.ok(text.includes("let us start"));
      assert.ok(text.includes("backend migration"));
    });
  });
});
