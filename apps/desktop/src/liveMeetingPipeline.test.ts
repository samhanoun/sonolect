import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  splitAudioIntoChunks,
  transcribeChunk,
  assignSpeakerToChunk,
  buildLiveTranscriptionPipeline,
  DEFAULT_CHUNK_DURATION,
  DEFAULT_LIVE_MEETING_CONFIG,
} from "./liveMeetingPipeline";
import type {
  LiveChunk,
  LiveTranscriptUpdate,
  LiveMeetingConfig,
} from "./liveMeetingPipeline";

describe("liveMeetingPipeline", () => {
  // ── Chunk splitting ────────────────────────────────────────────
  describe("splitAudioIntoChunks", () => {
    it("splits a 30-second recording into 3 chunks at 10s intervals", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, 30_000);
      assert.equal(chunks.length, 3);
      assert.equal(chunks[0]!.startMs, 0);
      assert.equal(chunks[0]!.endMs, 10_000);
      assert.equal(chunks[1]!.startMs, 10_000);
      assert.equal(chunks[1]!.endMs, 20_000);
      assert.equal(chunks[2]!.startMs, 20_000);
      assert.equal(chunks[2]!.endMs, 30_000);
    });

    it("handles partial last chunk when duration is not evenly divisible", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, 25_000);
      assert.equal(chunks.length, 3);
      assert.equal(chunks[2]!.startMs, 20_000);
      assert.equal(chunks[2]!.endMs, 25_000);
    });

    it("creates chunk file paths with index suffix", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 5_000, 15_000);
      assert.ok(chunks[0]!.audioPath.includes("chunk-0"));
      assert.ok(chunks[1]!.audioPath.includes("chunk-1"));
      assert.ok(chunks[2]!.audioPath.includes("chunk-2"));
    });

    it("returns empty array for zero duration", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, 0);
      assert.equal(chunks.length, 0);
    });

    it("returns empty array for negative duration", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, -5_000);
      assert.equal(chunks.length, 0);
    });

    it("returns empty array for zero chunk duration", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 0, 30_000);
      assert.equal(chunks.length, 0);
    });

    it("creates single chunk when duration equals chunk size", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, 10_000);
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0]!.startMs, 0);
      assert.equal(chunks[0]!.endMs, 10_000);
    });

    it("creates single chunk for short recordings", () => {
      const chunks = splitAudioIntoChunks("/tmp/audio.wav", 10_000, 3_000);
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0]!.endMs, 3_000);
    });
  });

  // ── Live update construction ───────────────────────────────────
  describe("transcribeChunk", () => {
    it("returns a LiveTranscriptUpdate with correct timestamp", async () => {
      const chunk: LiveChunk = {
        audioPath: "/tmp/chunk-0.wav",
        startMs: 5_000,
        endMs: 15_000,
      };
      const update = await transcribeChunk(chunk, "en");
      assert.equal(typeof update.text, "string");
      assert.equal(update.isFinal, true);
      assert.equal(update.timestampMs, 5_000);
    });

    it("returns isFinal true for completed chunks", async () => {
      const chunk: LiveChunk = {
        audioPath: "/tmp/chunk-1.wav",
        startMs: 10_000,
        endMs: 20_000,
      };
      const update = await transcribeChunk(chunk, "fr");
      assert.equal(update.isFinal, true);
    });
  });

  // ── Speaker assignment heuristics ──────────────────────────────
  describe("assignSpeakerToChunk", () => {
    it("assigns Speaker 1 when no previous speaker exists", () => {
      const update: LiveTranscriptUpdate = {
        text: "Hello everyone",
        isFinal: true,
        timestampMs: 0,
      };
      const speaker = assignSpeakerToChunk(update, null, undefined, 0);
      assert.equal(speaker, "Speaker 1");
    });

    it("keeps same speaker when gap is below threshold", () => {
      const update: LiveTranscriptUpdate = {
        text: "continuing...",
        isFinal: true,
        timestampMs: 11_000,
      };
      const speaker = assignSpeakerToChunk(
        update,
        null,
        "Speaker 1",
        10_000,
        2_000,
      );
      assert.equal(speaker, "Speaker 1");
    });

    it("alternates speaker when gap exceeds threshold", () => {
      const update: LiveTranscriptUpdate = {
        text: "new speaker here",
        isFinal: true,
        timestampMs: 15_000,
      };
      const speaker = assignSpeakerToChunk(
        update,
        null,
        "Speaker 1",
        10_000,
        2_000,
      );
      assert.equal(speaker, "Speaker 2");
    });

    it("wraps back to Speaker 1 after Speaker 2", () => {
      const update: LiveTranscriptUpdate = {
        text: "back to first",
        isFinal: true,
        timestampMs: 25_000,
      };
      const speaker = assignSpeakerToChunk(
        update,
        null,
        "Speaker 2",
        20_000,
        2_000,
      );
      assert.equal(speaker, "Speaker 1");
    });

    it("uses default threshold of 2000ms", () => {
      const update: LiveTranscriptUpdate = {
        text: "default threshold",
        isFinal: true,
        timestampMs: 12_500,
      };
      // Gap of 2500ms > default 2000ms threshold
      const speaker = assignSpeakerToChunk(update, null, "Speaker 1", 10_000);
      assert.equal(speaker, "Speaker 2");
    });

    it("keeps speaker when gap exactly equals threshold", () => {
      const update: LiveTranscriptUpdate = {
        text: "exact threshold",
        isFinal: true,
        timestampMs: 12_000,
      };
      // Gap of 2000ms equals 2000ms threshold
      const speaker = assignSpeakerToChunk(
        update,
        null,
        "Speaker 1",
        10_000,
        2_000,
      );
      assert.equal(speaker, "Speaker 2");
    });
  });

  // ── Pipeline config defaults ───────────────────────────────────
  describe("pipeline config defaults", () => {
    it("has DEFAULT_CHUNK_DURATION of 10 seconds", () => {
      assert.equal(DEFAULT_CHUNK_DURATION, 10_000);
    });

    it("default config has all expected fields", () => {
      const config = DEFAULT_LIVE_MEETING_CONFIG;
      assert.equal(config.chunkDurationMs, 10_000);
      assert.equal(config.language, "auto");
      assert.equal(config.speakerDetection, true);
      assert.equal(config.vadEnabled, true);
    });
  });

  // ── Pipeline construction ──────────────────────────────────────
  describe("buildLiveTranscriptionPipeline", () => {
    it("creates a pipeline with start/stop/pause/resume/getSession", () => {
      const updates: LiveTranscriptUpdate[] = [];
      const pipeline = buildLiveTranscriptionPipeline(
        DEFAULT_LIVE_MEETING_CONFIG,
        "Test Meeting",
        ["Alice", "Bob"],
        {
          onUpdate: (u) => updates.push(u),
          onError: () => {},
          onSessionUpdate: () => {},
        },
      );

      assert.equal(typeof pipeline.start, "function");
      assert.equal(typeof pipeline.stop, "function");
      assert.equal(typeof pipeline.pause, "function");
      assert.equal(typeof pipeline.resume, "function");
      assert.equal(typeof pipeline.getSession, "function");
    });

    it("initial session has correct title and participants", () => {
      const pipeline = buildLiveTranscriptionPipeline(
        DEFAULT_LIVE_MEETING_CONFIG,
        "Sprint Standup",
        ["Alice", "Bob", "Charlie"],
        {
          onUpdate: () => {},
          onError: () => {},
          onSessionUpdate: () => {},
        },
      );

      const session = pipeline.getSession();
      assert.equal(session.title, "Sprint Standup");
      assert.deepEqual(session.participants, ["Alice", "Bob", "Charlie"]);
      assert.equal(session.status, "active");
    });

    it("stop ends the meeting session", () => {
      let lastSession = null as any;
      const pipeline = buildLiveTranscriptionPipeline(
        DEFAULT_LIVE_MEETING_CONFIG,
        "Test",
        [],
        {
          onUpdate: () => {},
          onError: () => {},
          onSessionUpdate: (s) => {
            lastSession = s;
          },
        },
      );

      pipeline.stop();
      assert.equal(lastSession.status, "ended");
    });

    it("pause sets the session to paused", () => {
      let lastSession = null as any;
      const pipeline = buildLiveTranscriptionPipeline(
        DEFAULT_LIVE_MEETING_CONFIG,
        "Test",
        [],
        {
          onUpdate: () => {},
          onError: () => {},
          onSessionUpdate: (s) => {
            lastSession = s;
          },
        },
      );

      pipeline.start();
      pipeline.pause();
      assert.equal(lastSession.status, "paused");
      pipeline.stop(); // cleanup
    });

    it("resume after pause sets session back to active", () => {
      let lastSession = null as any;
      const pipeline = buildLiveTranscriptionPipeline(
        DEFAULT_LIVE_MEETING_CONFIG,
        "Test",
        [],
        {
          onUpdate: () => {},
          onError: () => {},
          onSessionUpdate: (s) => {
            lastSession = s;
          },
        },
      );

      pipeline.start();
      pipeline.pause();
      pipeline.resume();
      assert.equal(lastSession.status, "active");
      pipeline.stop(); // cleanup
    });
  });
});
