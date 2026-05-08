import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  estimateSpeakerFromSegments,
  mergeSpeakerSegments,
  assignSpeakerColors,
} from "./speakerDiarization";
import type { SpeakerProfile } from "./speakerDiarization";
import type { TranscriptSegment } from "./segmentEditor";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LABELED_SEGMENTS: TranscriptSegment[] = [
  {
    id: "s1",
    text: "Good morning.",
    startMs: 0,
    endMs: 2000,
    speaker: "Alice",
  },
  { id: "s2", text: "Hi Alice.", startMs: 2200, endMs: 4000, speaker: "Bob" },
  {
    id: "s3",
    text: "Let's begin.",
    startMs: 4200,
    endMs: 6000,
    speaker: "Alice",
  },
];

const UNLABELED_SEGMENTS: TranscriptSegment[] = [
  { id: "s1", text: "First segment.", startMs: 0, endMs: 2000 },
  { id: "s2", text: "Second segment.", startMs: 2200, endMs: 4000 },
  { id: "s3", text: "Third segment after gap.", startMs: 10000, endMs: 12000 },
  { id: "s4", text: "Fourth segment.", startMs: 12200, endMs: 14000 },
];

// ---------------------------------------------------------------------------
// estimateSpeakerFromSegments
// ---------------------------------------------------------------------------

describe("estimateSpeakerFromSegments", () => {
  it("returns empty result for empty segments", () => {
    const result = estimateSpeakerFromSegments([]);
    assert.equal(result.segments.length, 0);
    assert.equal(result.speakers.length, 0);
    assert.equal(result.confidence, 0);
  });

  it("preserves existing speaker labels with high confidence", () => {
    const result = estimateSpeakerFromSegments(LABELED_SEGMENTS);
    assert.equal(result.confidence, 1);
    assert.equal(result.segments[0]!.speaker, "Alice");
    assert.equal(result.segments[1]!.speaker, "Bob");
    assert.equal(result.segments[2]!.speaker, "Alice");
  });

  it("builds speaker profiles from labeled segments", () => {
    const result = estimateSpeakerFromSegments(LABELED_SEGMENTS);
    assert.equal(result.speakers.length, 2);
    const alice = result.speakers.find((s) => s.label === "Alice");
    assert.ok(alice);
    assert.ok(alice.sampleSegments.length >= 1);
  });

  it("assigns speaker labels to unlabeled segments", () => {
    const result = estimateSpeakerFromSegments(UNLABELED_SEGMENTS);
    assert.equal(result.segments.length, 4);
    for (const seg of result.segments) {
      assert.ok(seg.speaker, `Segment ${seg.id} should have a speaker`);
    }
  });

  it("detects speaker changes at silence gaps", () => {
    const result = estimateSpeakerFromSegments(UNLABELED_SEGMENTS);
    // Segments 1-2 are close together, segment 3 has a large gap
    const speaker12 = result.segments[0]!.speaker;
    const speaker34 = result.segments[2]!.speaker;
    // They should be different speakers due to the gap
    assert.notEqual(speaker12, speaker34);
  });

  it("returns confidence between 0 and 1 for heuristic results", () => {
    const result = estimateSpeakerFromSegments(UNLABELED_SEGMENTS);
    assert.ok(result.confidence > 0);
    assert.ok(result.confidence < 1);
  });

  it("handles a single unlabeled segment", () => {
    const single: TranscriptSegment[] = [
      { id: "s1", text: "Hello.", startMs: 0, endMs: 1000 },
    ];
    const result = estimateSpeakerFromSegments(single);
    assert.equal(result.segments.length, 1);
    assert.ok(result.segments[0]!.speaker);
  });

  it("creates speaker profiles for estimated speakers", () => {
    const result = estimateSpeakerFromSegments(UNLABELED_SEGMENTS);
    assert.ok(result.speakers.length >= 2);
    for (const profile of result.speakers) {
      assert.ok(profile.id.startsWith("speaker-"));
      assert.ok(profile.label.length > 0);
      assert.ok(profile.sampleSegments.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeSpeakerSegments
// ---------------------------------------------------------------------------

describe("mergeSpeakerSegments", () => {
  it("merges consecutive segments from the same speaker", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hello.", startMs: 0, endMs: 1000, speaker: "Alice" },
      {
        id: "s2",
        text: "How are you?",
        startMs: 1200,
        endMs: 3000,
        speaker: "Alice",
      },
      {
        id: "s3",
        text: "I'm fine.",
        startMs: 3200,
        endMs: 5000,
        speaker: "Bob",
      },
    ];
    const merged = mergeSpeakerSegments(segments);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.text, "Hello. How are you?");
    assert.equal(merged[0]!.speaker, "Alice");
    assert.equal(merged[0]!.endMs, 3000);
    assert.equal(merged[1]!.speaker, "Bob");
  });

  it("does not merge segments with different speakers", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hello.", startMs: 0, endMs: 1000, speaker: "Alice" },
      { id: "s2", text: "Hi.", startMs: 1200, endMs: 2000, speaker: "Bob" },
      { id: "s3", text: "Hey.", startMs: 2200, endMs: 3000, speaker: "Alice" },
    ];
    const merged = mergeSpeakerSegments(segments);
    assert.equal(merged.length, 3);
  });

  it("does not merge segments without speakers", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hello.", startMs: 0, endMs: 1000 },
      { id: "s2", text: "World.", startMs: 1200, endMs: 2000 },
    ];
    const merged = mergeSpeakerSegments(segments);
    assert.equal(merged.length, 2);
  });

  it("returns empty array for empty input", () => {
    const merged = mergeSpeakerSegments([]);
    assert.equal(merged.length, 0);
  });

  it("merges multiple consecutive same-speaker segments", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "A.", startMs: 0, endMs: 1000, speaker: "Alice" },
      { id: "s2", text: "B.", startMs: 1200, endMs: 2000, speaker: "Alice" },
      { id: "s3", text: "C.", startMs: 2200, endMs: 3000, speaker: "Alice" },
      { id: "s4", text: "D.", startMs: 3200, endMs: 4000, speaker: "Bob" },
    ];
    const merged = mergeSpeakerSegments(segments);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.text, "A. B. C.");
    assert.equal(merged[0]!.endMs, 3000);
  });

  it("handles single segment", () => {
    const segments: TranscriptSegment[] = [
      { id: "s1", text: "Hello.", startMs: 0, endMs: 1000, speaker: "Alice" },
    ];
    const merged = mergeSpeakerSegments(segments);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.text, "Hello.");
  });
});

// ---------------------------------------------------------------------------
// assignSpeakerColors
// ---------------------------------------------------------------------------

describe("assignSpeakerColors", () => {
  it("assigns unique colors to each speaker", () => {
    const speakers: SpeakerProfile[] = [
      { id: "speaker-1", label: "Alice", sampleSegments: [0, 2] },
      { id: "speaker-2", label: "Bob", sampleSegments: [1] },
    ];
    const colors = assignSpeakerColors(speakers);
    assert.ok(colors["Alice"]);
    assert.ok(colors["Bob"]);
    assert.notEqual(colors["Alice"], colors["Bob"]);
  });

  it("returns empty map for empty speakers", () => {
    const colors = assignSpeakerColors([]);
    assert.deepEqual(colors, {});
  });

  it("assigns colors starting with #", () => {
    const speakers: SpeakerProfile[] = [
      { id: "speaker-1", label: "Alice", sampleSegments: [0] },
    ];
    const colors = assignSpeakerColors(speakers);
    assert.ok(colors["Alice"]!.startsWith("#"));
  });

  it("wraps around colors for many speakers", () => {
    const speakers: SpeakerProfile[] = Array.from({ length: 12 }, (_, i) => ({
      id: `speaker-${i + 1}`,
      label: `Speaker ${i + 1}`,
      sampleSegments: [i],
    }));
    const colors = assignSpeakerColors(speakers);
    assert.equal(Object.keys(colors).length, 12);
    // Color at index 0 and index 10 should be the same (wrap around)
    assert.equal(colors["Speaker 1"], colors["Speaker 11"]);
  });
});
