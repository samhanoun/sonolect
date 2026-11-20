import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  assignSpeakerLabel,
  formatTimestamp,
  mergeSegmentRun,
  mergeTranscriptSegments,
  mergeableRun,
  moveTranscriptSegment,
  resyncSegments,
  segmentAtTime,
  segmentsFromCapture,
  segmentsToText,
  singleCaptureId,
  speakerColorIndex,
  speakerNames,
  splitTranscriptSegment,
  textToSegments,
  type TranscriptSegment,
} from "./segmentEditor";

describe("transcript segment editing", () => {
  it("creates timestamped segments from plain transcript text", () => {
    const segments = textToSegments("First thought.\n\nSecond thought.");

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.text, "First thought.");
    assert.equal(segments[1]?.startMs, 1000);
  });

  it("merges adjacent selected segments and preserves speaker label", () => {
    const [a, b, c] = textToSegments("Hello.\n\nWorld.\n\nLater.");
    const merged = mergeTranscriptSegments(
      [assignSpeakerLabel(a!, "Ismail"), b!, c!],
      a!.id,
      b!.id,
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.text, "Hello. World.");
    assert.equal(merged[0]?.speaker, "Ismail");
    assert.equal(merged[0]?.endMs, b!.endMs);
  });

  it("splits a segment at a word boundary", () => {
    const [segment] = textToSegments("Hello world from Sonolect.");
    const result = splitTranscriptSegment([segment!], segment!.id, 11);

    assert.equal(result.length, 2);
    assert.equal(result[0]?.text, "Hello world");
    assert.equal(result[1]?.text, "from Sonolect.");
    assert.ok(result[1]!.startMs > result[0]!.startMs);
  });

  it("assigns and clears speaker labels", () => {
    const [segment] = textToSegments("Bonjour.");
    const assigned = assignSpeakerLabel(segment!, "Speaker 1");
    const cleared = assignSpeakerLabel(assigned, "");

    assert.equal(assigned.speaker, "Speaker 1");
    assert.equal(cleared.speaker, undefined);
  });
});

const recorded = (): TranscriptSegment[] =>
  segmentsFromCapture({
    id: "17-1",
    durationMs: 9000,
    transcript: "ignored when segments exist",
    segments: [
      { startMs: 0, endMs: 2000, text: " Good morning. ", speaker: "Ana" },
      { startMs: 2400, endMs: 5000.4, text: "Shall we start?" },
      { startMs: 5000, endMs: 5000, text: "   " },
      { startMs: 6000, endMs: 9000, text: "Yes, let us begin.", speaker: " " },
    ],
  });

describe("segments of a saved recording", () => {
  it("keeps the engine timings and links every segment to its audio", () => {
    const segments = recorded();
    assert.deepEqual(
      segments.map((s) => [s.startMs, s.endMs, s.text, s.speaker]),
      [
        [0, 2000, "Good morning.", "Ana"],
        [2400, 5000, "Shall we start?", undefined],
        [6000, 9000, "Yes, let us begin.", undefined],
      ],
    );
    assert.ok(segments.every((s) => s.captureId === "17-1" && !s.approx));
    assert.equal(new Set(segments.map((s) => s.id)).size, 3);
    assert.equal(singleCaptureId(segments), "17-1");
  });

  it("spreads an untimed transcript over the recording and marks the estimate", () => {
    const segments = segmentsFromCapture({
      id: "18-1",
      durationMs: 10_000,
      transcript: "Short one. This second sentence is quite a bit longer.",
      segments: [],
    });
    assert.equal(segments.length, 2);
    assert.equal(segments[0]!.startMs, 0);
    assert.equal(segments[0]!.endMs, segments[1]!.startMs);
    assert.equal(segments[1]!.endMs, 10_000);
    assert.ok(segments[0]!.endMs < 5000);
    assert.ok(segments.every((s) => s.approx && s.captureId === "18-1"));
    assert.deepEqual(
      segmentsFromCapture({ id: "19-1", durationMs: 500, transcript: null }),
      [],
    );
  });
});

describe("editing a recorded transcript as text", () => {
  it("keeps every timing when one paragraph is reworded", () => {
    const before = recorded();
    const after = resyncSegments(
      before,
      "Good morning.\n\nShall we begin?\n\nYes, let us begin.",
    );
    assert.deepEqual(after[0], before[0]);
    assert.deepEqual(after[2], before[2]);
    assert.deepEqual(after[1], { ...before[1]!, text: "Shall we begin?" });
  });

  it("keeps trailing typing from dropping the audio link", () => {
    const before = recorded();
    const after = resyncSegments(before, `${segmentsToText(before)}\n\n`);
    assert.deepEqual(after, before);
  });

  it("shares the time of joined paragraphs and keeps the neighbours", () => {
    const before = recorded();
    const after = resyncSegments(
      before,
      "Good morning. Shall we start?\n\nYes, let us begin.",
    );
    assert.equal(after.length, 2);
    assert.equal(after[0]!.startMs, 0);
    assert.equal(after[0]!.endMs, 5000);
    assert.equal(after[0]!.captureId, "17-1");
    assert.equal(after[0]!.approx, true);
    // Two speakers were joined, so no single label fits.
    assert.equal(after[0]!.speaker, undefined);
    assert.deepEqual(after[1], before[2]);
  });

  it("splits the time of a paragraph broken in two by length", () => {
    const before = recorded();
    const after = resyncSegments(
      before,
      "Good morning.\n\nShall we start?\n\nYes,\n\nlet us begin.",
    );
    assert.equal(after.length, 4);
    assert.equal(after[2]!.startMs, 6000);
    assert.equal(after[2]!.endMs, after[3]!.startMs);
    assert.equal(after[3]!.endMs, 9000);
    assert.ok(after[2]!.endMs < 7500);
    assert.equal(new Set(after.map((s) => s.id)).size, 4);
  });

  it("gives a new paragraph no audio of its own", () => {
    const before = recorded();
    const after = resyncSegments(
      before,
      "Good morning.\n\nA typed note.\n\nShall we start?\n\nYes, let us begin.",
    );
    assert.equal(after.length, 4);
    assert.equal(after[1]!.text, "A typed note.");
    assert.equal(after[1]!.captureId, undefined);
    assert.equal(singleCaptureId(after), "17-1");
    assert.deepEqual(after[2], before[1]);
  });

  it("drops deleted paragraphs and survives clearing everything", () => {
    const before = recorded();
    assert.deepEqual(resyncSegments(before, "Shall we start?"), [before[1]]);
    assert.deepEqual(resyncSegments(before, ""), []);
  });

  it("re-splits text that never came from a recording", () => {
    const typed = textToSegments("One. Two.");
    assert.deepEqual(
      resyncSegments(typed, "One. Two. Three."),
      textToSegments("One. Two. Three."),
    );
  });
});

describe("reordering, merging and speakers", () => {
  it("moves a segment up or down and stops at the ends", () => {
    const [a, b, c] = recorded();
    const list = [a!, b!, c!];
    assert.deepEqual(moveTranscriptSegment(list, b!.id, "up"), [b, a, c]);
    assert.deepEqual(moveTranscriptSegment(list, b!.id, "down"), [a, c, b]);
    assert.equal(moveTranscriptSegment(list, a!.id, "up"), list);
    assert.equal(moveTranscriptSegment(list, c!.id, "down"), list);
    assert.equal(moveTranscriptSegment(list, "missing", "up"), list);
  });

  it("merges any run of neighbours, whatever order they were ticked in", () => {
    const list = recorded();
    const ids = [list[2]!.id, list[0]!.id, list[1]!.id];
    assert.equal(mergeableRun(list, ids).length, 3);
    const merged = mergeSegmentRun(list, ids);
    assert.equal(merged.length, 1);
    assert.equal(
      merged[0]!.text,
      "Good morning. Shall we start? Yes, let us begin.",
    );
    assert.equal(merged[0]!.startMs, 0);
    assert.equal(merged[0]!.endMs, 9000);
    assert.equal(merged[0]!.speaker, "Ana");
    assert.equal(merged[0]!.captureId, "17-1");
  });

  it("covers all the source audio when merging segments that were moved", () => {
    const [a, b, c] = recorded();
    // The second segment now sits above the first one.
    const moved = moveTranscriptSegment([a!, b!, c!], b!.id, "up");
    const merged = mergeSegmentRun(moved, [a!.id, b!.id]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.startMs, a!.startMs);
    assert.equal(merged[0]!.endMs, b!.endMs);
    assert.equal(merged[0]!.captureId, "17-1");
  });

  it("keeps the recording's timing when typed text is merged into it", () => {
    const [a] = recorded();
    const [typed] = textToSegments("A note added by hand.");
    const merged = mergeSegmentRun([typed!, a!], [typed!.id, a!.id]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.captureId, "17-1");
    assert.equal(merged[0]!.startMs, a!.startMs);
    assert.equal(merged[0]!.endMs, a!.endMs);
    assert.equal(singleCaptureId(merged), "17-1");
  });

  it("gives a merge across two recordings no recording of its own", () => {
    const first = segmentsFromCapture({
      id: "17-1",
      durationMs: 2000,
      transcript: "From the first.",
    });
    const second = segmentsFromCapture({
      id: "20-1",
      durationMs: 1000,
      transcript: "From the second.",
    });
    const list = [...first, ...second];
    const merged = mergeSegmentRun(list, [list[0]!.id, list[1]!.id]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.text, "From the first. From the second.");
    assert.equal(merged[0]!.captureId, undefined);
    assert.equal(merged[0]!.mixed, true);
    // Nothing can be saved over the first recording any more, even after
    // more edits to the merged segment.
    assert.equal(singleCaptureId(merged), undefined);
    const split = splitTranscriptSegment(merged, merged[0]!.id, 15);
    assert.equal(split.length, 2);
    assert.equal(singleCaptureId(split), undefined);
    const again = mergeSegmentRun(
      [...recorded(), ...split],
      [recorded()[2]!.id, split[0]!.id],
    );
    assert.equal(singleCaptureId(again), undefined);
  });

  it("marks paragraphs joined in the text view across two recordings", () => {
    const first = segmentsFromCapture({
      id: "17-1",
      durationMs: 2000,
      transcript: "From the first.",
    });
    const second = segmentsFromCapture({
      id: "20-1",
      durationMs: 1000,
      transcript: "From the second.",
    });
    const after = resyncSegments(
      [...first, ...second],
      "From the first. From the second.",
    );
    assert.equal(after.length, 1);
    assert.equal(after[0]!.captureId, undefined);
    assert.equal(after[0]!.mixed, true);
    assert.equal(singleCaptureId(after), undefined);
  });

  it("does not merge segments that are apart, or a single one", () => {
    const list = recorded();
    assert.equal(mergeSegmentRun(list, [list[0]!.id, list[2]!.id]), list);
    assert.equal(mergeSegmentRun(list, [list[0]!.id]), list);
    assert.deepEqual(mergeableRun(list, []), []);
  });

  it("lists speakers by first appearance and gives each a steady colour", () => {
    const [a, b, c] = recorded();
    const list = [
      a!,
      assignSpeakerLabel(b!, "Ben"),
      assignSpeakerLabel(c!, "Ana"),
    ];
    assert.deepEqual(speakerNames(list), ["Ana", "Ben"]);
    assert.equal(speakerColorIndex(list, "Ana"), 0);
    assert.equal(speakerColorIndex(list, "Ben"), 1);
    assert.equal(speakerColorIndex(list, undefined), undefined);
    assert.equal(speakerColorIndex(list, "Nobody"), undefined);
  });

  it("has no single recording for a transcript built from several", () => {
    const other = segmentsFromCapture({
      id: "20-1",
      durationMs: 1000,
      transcript: "Later.",
    });
    assert.equal(singleCaptureId([...recorded(), ...other]), undefined);
    assert.equal(singleCaptureId(textToSegments("Typed.")), undefined);
  });
});

describe("playback position", () => {
  it("formats times with hours only when needed", () => {
    assert.equal(formatTimestamp(0), "0:00");
    assert.equal(formatTimestamp(83_000), "1:23");
    assert.equal(formatTimestamp(3_723_999), "1:02:03");
    assert.equal(formatTimestamp(-5), "0:00");
  });

  it("finds the segment being heard, and keeps the last one in a pause", () => {
    const list = recorded();
    assert.equal(segmentAtTime(list, "17-1", 0), list[0]!.id);
    assert.equal(segmentAtTime(list, "17-1", 2200), list[0]!.id);
    assert.equal(segmentAtTime(list, "17-1", 2400), list[1]!.id);
    assert.equal(segmentAtTime(list, "17-1", 8999), list[2]!.id);
    assert.equal(segmentAtTime(list, "other", 100), undefined);
    assert.equal(segmentAtTime(list, undefined, 100), undefined);
  });
});
