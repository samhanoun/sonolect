import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineState,
  sliceAudioIntoChunks,
  assignSpeakerToChunk,
  processChunkResult,
  finalizePipeline,
  getPipelineDurationFormatted,
  DEFAULT_PIPELINE_CONFIG,
  type TranscriptionResult,
} from "./liveMeetingPipeline";

describe("liveMeetingPipeline", () => {
  describe("createPipelineState", () => {
    it("creates idle state without title", () => {
      const state = createPipelineState();
      assert.equal(state.status, "idle");
      assert.equal(state.session, null);
      assert.equal(state.chunksProcessed, 0);
    });

    it("creates state with meeting session when title given", () => {
      const state = createPipelineState("Team Standup");
      assert.equal(state.status, "idle");
      assert.ok(state.session);
      assert.equal(state.session!.config.title, "Team Standup");
    });
  });

  describe("sliceAudioIntoChunks", () => {
    it("slices audio into correct number of chunks", () => {
      const samples = new Float32Array(44100 * 25);
      const chunks = sliceAudioIntoChunks(samples, 44100, 10_000, 1_000);
      assert.ok(chunks.length >= 2);
      assert.equal(chunks[0]!.startMs, 0);
      assert.equal(chunks[0]!.index, 0);
    });

    it("handles audio shorter than chunk duration", () => {
      const samples = new Float32Array(44100 * 5);
      const chunks = sliceAudioIntoChunks(samples, 44100, 10_000, 1_000);
      assert.equal(chunks.length, 1);
    });

    it("each chunk has correct timing", () => {
      const samples = new Float32Array(44100 * 20);
      const chunks = sliceAudioIntoChunks(samples, 44100, 10_000, 0);
      assert.equal(chunks[0]!.startMs, 0);
      assert.equal(chunks[0]!.endMs, 10_000);
      assert.equal(chunks[1]!.startMs, 10_000);
    });

    it("handles empty audio", () => {
      const chunks = sliceAudioIntoChunks(
        new Float32Array(0),
        44100,
        10_000,
        0,
      );
      assert.equal(chunks.length, 0);
    });
  });

  describe("assignSpeakerToChunk", () => {
    const result: TranscriptionResult = {
      text: "hello",
      startMs: 5000,
      endMs: 7000,
      confidence: 0.9,
    };

    it("assigns Speaker 1 for first chunk", () => {
      assert.equal(
        assignSpeakerToChunk(result, 0, "Speaker 1", 2000),
        "Speaker 1",
      );
    });

    it("keeps same speaker when gap is small", () => {
      const r = { ...result, startMs: 3000 };
      assert.equal(
        assignSpeakerToChunk(r, 2000, "Speaker 1", 2000),
        "Speaker 1",
      );
    });

    it("switches speaker when gap exceeds threshold", () => {
      const r = { ...result, startMs: 10000 };
      assert.equal(
        assignSpeakerToChunk(r, 5000, "Speaker 1", 2000),
        "Speaker 2",
      );
    });
  });

  describe("processChunkResult", () => {
    it("adds segment to meeting session", () => {
      const state = createPipelineState("Test Meeting");
      const result: TranscriptionResult = {
        text: "Hello everyone",
        startMs: 0,
        endMs: 2000,
        confidence: 0.95,
      };
      const updated = processChunkResult(
        state,
        result,
        DEFAULT_PIPELINE_CONFIG,
      );
      assert.equal(updated.chunksProcessed, 1);
      assert.equal(updated.session!.segments.length, 1);
      assert.equal(updated.session!.segments[0]!.text, "Hello everyone");
    });

    it("skips empty text", () => {
      const state = createPipelineState("Test");
      const result: TranscriptionResult = {
        text: "   ",
        startMs: 0,
        endMs: 1000,
        confidence: 0.1,
      };
      const updated = processChunkResult(
        state,
        result,
        DEFAULT_PIPELINE_CONFIG,
      );
      assert.equal(updated.chunksProcessed, 0);
    });

    it("returns unchanged state when no session", () => {
      const state = createPipelineState();
      const result: TranscriptionResult = {
        text: "test",
        startMs: 0,
        endMs: 1000,
        confidence: 0.9,
      };
      const updated = processChunkResult(
        state,
        result,
        DEFAULT_PIPELINE_CONFIG,
      );
      assert.equal(updated.session, null);
    });
  });

  describe("finalizePipeline", () => {
    it("sets status to stopped and ends meeting", () => {
      const state = createPipelineState("Final Meeting");
      const final = finalizePipeline(state);
      assert.equal(final.status, "stopped");
      assert.equal(final.session!.status, "completed");
      assert.ok(final.session!.endedAt);
    });

    it("handles null session", () => {
      const state = createPipelineState();
      const final = finalizePipeline(state);
      assert.equal(final.status, "stopped");
    });
  });

  describe("getPipelineDurationFormatted", () => {
    it("formats seconds only", () => {
      assert.equal(getPipelineDurationFormatted(45000), "00:45");
    });

    it("formats minutes and seconds", () => {
      assert.equal(getPipelineDurationFormatted(125000), "02:05");
    });

    it("formats hours", () => {
      assert.equal(getPipelineDurationFormatted(3661000), "1:01:01");
    });

    it("formats zero", () => {
      assert.equal(getPipelineDurationFormatted(0), "00:00");
    });
  });
});
