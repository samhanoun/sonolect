import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  assignSpeakersByGap,
  mergeSpeakerSegments,
  getSpeakerStats,
  type SpeakerSegment,
} from "./speakerDiarization";

describe("assignSpeakersByGap", () => {
  it("assigns new speaker when gap exceeds threshold", () => {
    const segments = [
      { text: "Hello there.", startMs: 0, endMs: 2000 },
      { text: "How are you?", startMs: 5000, endMs: 7000 },
      { text: "I am fine.", startMs: 10000, endMs: 12000 },
    ];
    const result = assignSpeakersByGap(segments, 2000);
    assert.equal(result.length, 3);
    assert.equal(result[0]!.speaker, "Speaker 1");
    assert.equal(result[1]!.speaker, "Speaker 2");
    assert.equal(result[2]!.speaker, "Speaker 3");
  });

  it("keeps same speaker when gaps are small", () => {
    const segments = [
      { text: "Hello.", startMs: 0, endMs: 2000 },
      { text: "World.", startMs: 2500, endMs: 4000 },
      { text: "Goodbye.", startMs: 4200, endMs: 5000 },
    ];
    const result = assignSpeakersByGap(segments, 2000);
    assert.equal(result.length, 3);
    assert.equal(result[0]!.speaker, "Speaker 1");
    assert.equal(result[1]!.speaker, "Speaker 1");
    assert.equal(result[2]!.speaker, "Speaker 1");
  });

  it("uses default 2000ms threshold", () => {
    const segments = [
      { text: "First.", startMs: 0, endMs: 1000 },
      { text: "Second.", startMs: 3500, endMs: 5000 },
    ];
    const result = assignSpeakersByGap(segments);
    assert.equal(result[0]!.speaker, "Speaker 1");
    assert.equal(result[1]!.speaker, "Speaker 2");
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(assignSpeakersByGap([]), []);
  });

  it("preserves text and timestamps", () => {
    const segments = [{ text: "Test.", startMs: 100, endMs: 500 }];
    const result = assignSpeakersByGap(segments);
    assert.equal(result[0]!.text, "Test.");
    assert.equal(result[0]!.startMs, 100);
    assert.equal(result[0]!.endMs, 500);
  });
});

describe("mergeSpeakerSegments", () => {
  it("merges consecutive segments from the same speaker", () => {
    const segments: SpeakerSegment[] = [
      { speaker: "Speaker 1", startMs: 0, endMs: 2000, text: "Hello." },
      {
        speaker: "Speaker 1",
        startMs: 2500,
        endMs: 4000,
        text: "How are you?",
      },
      { speaker: "Speaker 2", startMs: 5000, endMs: 7000, text: "I am fine." },
    ];
    const result = mergeSpeakerSegments(segments);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.speaker, "Speaker 1");
    assert.equal(result[0]!.text, "Hello. How are you?");
    assert.equal(result[0]!.startMs, 0);
    assert.equal(result[0]!.endMs, 4000);
    assert.equal(result[1]!.speaker, "Speaker 2");
    assert.equal(result[1]!.text, "I am fine.");
  });

  it("does not merge segments from different speakers", () => {
    const segments: SpeakerSegment[] = [
      { speaker: "Speaker 1", startMs: 0, endMs: 1000, text: "A" },
      { speaker: "Speaker 2", startMs: 1500, endMs: 2500, text: "B" },
      { speaker: "Speaker 1", startMs: 3000, endMs: 4000, text: "C" },
    ];
    const result = mergeSpeakerSegments(segments);
    assert.equal(result.length, 3);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(mergeSpeakerSegments([]), []);
  });
});

describe("getSpeakerStats", () => {
  it("calculates stats per speaker", () => {
    const segments: SpeakerSegment[] = [
      { speaker: "Alice", startMs: 0, endMs: 5000, text: "Hello world today." },
      {
        speaker: "Bob",
        startMs: 5500,
        endMs: 10000,
        text: "Good morning everyone here.",
      },
      { speaker: "Alice", startMs: 10500, endMs: 15000, text: "Let us begin." },
    ];
    const stats = getSpeakerStats(segments);
    assert.equal(stats.length, 2);

    const alice = stats.find((s) => s.speaker === "Alice");
    const bob = stats.find((s) => s.speaker === "Bob");
    assert.ok(alice);
    assert.ok(bob);

    assert.equal(alice.totalMs, 9500);
    assert.equal(alice.segmentCount, 2);
    assert.equal(alice.wordCount, 6);

    assert.equal(bob.totalMs, 4500);
    assert.equal(bob.segmentCount, 1);
    assert.equal(bob.wordCount, 4);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(getSpeakerStats([]), []);
  });
});
