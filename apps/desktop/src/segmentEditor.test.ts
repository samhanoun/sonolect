import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  applySpeakerTurns,
  assignSpeakerLabel,
  formatTimestamp,
  mergeSegmentRun,
  mergeTranscriptSegments,
  mergeableRun,
  moveTranscriptSegment,
  renameSpeaker,
  resyncSegments,
  segmentAtTime,
  segmentsFromCapture,
  segmentsToText,
  singleCaptureId,
  speakerColorIndex,
  speakerNames,
  splitTranscriptSegment,
  textToSegments,
  typedSpeakerNames,
  type SpeakerTurn,
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

describe("detected speakers", () => {
  const label = (number: number) => `Speaker ${number}`;
  /** Five sentences of one recording, two seconds each. */
  const meeting = (): TranscriptSegment[] =>
    ["One.", "Two.", "Three.", "Four.", "Five."].map((text, index) => ({
      id: `m${index + 1}`,
      text,
      startMs: index * 2000,
      endMs: index * 2000 + 2000,
      captureId: "30-1",
    }));
  // A speaks the first four seconds, B the next five, A again at the end.
  const turns: SpeakerTurn[] = [
    { startMs: 0, endMs: 4100, speaker: 1 },
    { startMs: 4100, endMs: 8900, speaker: 2 },
    { startMs: 9300, endMs: 10_000, speaker: 1 },
  ];
  const speakers = (list: TranscriptSegment[]) =>
    list.map((segment) => segment.speaker);

  it("gives each segment the speaker it overlaps most", () => {
    const labelled = applySpeakerTurns(meeting(), turns, label);
    assert.deepEqual(speakers(labelled), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
      // 8.0-10.0 s: 0.9 s of speaker 2 against 0.7 s of speaker 1.
      "Speaker 2",
    ]);
    // Only the labels change.
    assert.deepEqual(
      labelled.map(({ speaker: _speaker, ...rest }) => rest),
      meeting(),
    );
  });

  it("adds up a speaker's time across the turns a segment spans", () => {
    const [segment] = meeting();
    const long = { ...segment!, endMs: 3000 };
    const split: SpeakerTurn[] = [
      { startMs: 0, endMs: 800, speaker: 1 },
      { startMs: 800, endMs: 2000, speaker: 2 },
      { startMs: 2000, endMs: 3000, speaker: 1 },
    ];
    assert.equal(
      applySpeakerTurns([long], split, label)[0]?.speaker,
      "Speaker 1",
    );
  });

  it("gives a segment between turns the nearest speaker", () => {
    const quiet: TranscriptSegment = {
      id: "q",
      text: "Mm-hmm.",
      startMs: 9000,
      endMs: 9200,
      captureId: "30-1",
    };
    // 8.9 s is nearer than 9.3 s.
    assert.equal(
      applySpeakerTurns([quiet], turns, label)[0]?.speaker,
      "Speaker 2",
    );
    // A segment with no length takes the turn it sits in.
    const point = { ...quiet, startMs: 9500, endMs: 9500 };
    assert.equal(
      applySpeakerTurns([point], turns, label)[0]?.speaker,
      "Speaker 1",
    );
  });

  it("leaves typed text alone and changes nothing without turns", () => {
    const typed = textToSegments("Added later.");
    const list = [...meeting(), ...typed];
    const labelled = applySpeakerTurns(list, turns, label);
    assert.equal(labelled[5], typed[0]);
    assert.equal(applySpeakerTurns(list, [], label), list);
  });

  it("keeps typed names and names a detected speaker after them", () => {
    const list = meeting();
    // Speaker 1 has one typed name, so it is called by it.
    list[0] = assignSpeakerLabel(list[0]!, "Ana");
    // Speaker 2 has two different names, neither on most of its named
    // segments: it keeps its number, and each name stays where it was typed.
    list[2] = assignSpeakerLabel(list[2]!, "Ben");
    list[3] = assignSpeakerLabel(list[3]!, "Cleo");
    assert.deepEqual(typedSpeakerNames(list, label), ["Ana", "Ben", "Cleo"]);
    const kept = applySpeakerTurns(list, turns, label);
    assert.deepEqual(speakers(kept), [
      "Ana",
      "Ana",
      "Ben",
      "Cleo",
      "Speaker 2",
    ]);

    // With one name left on speaker 2, that name covers all of it.
    list[3] = assignSpeakerLabel(list[3]!, "");
    assert.deepEqual(speakers(applySpeakerTurns(list, turns, label)), [
      "Ana",
      "Ana",
      "Ben",
      "Ben",
      "Ben",
    ]);
  });

  it("replaces typed names when asked to", () => {
    const list = meeting();
    list[0] = assignSpeakerLabel(list[0]!, "Ana");
    const replaced = applySpeakerTurns(list, turns, label, {
      replaceTyped: true,
    });
    assert.deepEqual(speakers(replaced), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
      "Speaker 2",
    ]);
  });

  it("treats the labels of an earlier detection as its own", () => {
    // Detected once with three speakers, now with two.
    const earlier = applySpeakerTurns(
      meeting(),
      [...turns.slice(0, 2), { startMs: 9300, endMs: 10_000, speaker: 3 }],
      label,
    );
    assert.deepEqual(typedSpeakerNames(earlier, label), []);
    const again = applySpeakerTurns(
      earlier,
      [
        { startMs: 0, endMs: 6000, speaker: 1 },
        { startMs: 6000, endMs: 10_000, speaker: 2 },
      ],
      label,
    );
    assert.deepEqual(speakers(again), [
      "Speaker 1",
      "Speaker 1",
      "Speaker 1",
      "Speaker 2",
      "Speaker 2",
    ]);
  });

  it("renames a speaker on every segment", () => {
    const list = applySpeakerTurns(meeting(), turns, label);
    const renamed = renameSpeaker(list, "Speaker 2", "  Ben ");
    assert.deepEqual(speakers(renamed), [
      "Speaker 1",
      "Speaker 1",
      "Ben",
      "Ben",
      "Ben",
    ]);
    // The other segments are the same objects.
    assert.equal(renamed[0], list[0]);
    // Renaming into an existing name joins the two.
    assert.deepEqual(speakerNames(renameSpeaker(renamed, "Ben", "Speaker 1")), [
      "Speaker 1",
    ]);
    // An empty name clears the label.
    assert.equal(renameSpeaker(renamed, "Ben", " ")[2]?.speaker, undefined);
    // Nothing to do: the same list comes back.
    assert.equal(renameSpeaker(renamed, "Nobody", "Ana"), renamed);
    assert.equal(renameSpeaker(renamed, "Ben", "Ben"), renamed);
    assert.equal(renameSpeaker(renamed, "", "Ana"), renamed);
  });
});
