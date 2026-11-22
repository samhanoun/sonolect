import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CUE_MS,
  MAX_SEGMENTS,
  MAX_SEGMENT_MS,
  SegmentRecorder,
  sanitizeSegments,
  segmentsSayText,
  segmentsToShow,
  type EnginePart,
} from "./noteSegments";
import { TranscriptAccumulator } from "./speechPolicy";

/** Epoch ms of the dictation's first session, as Date.now() would give. */
const T0 = 1_763_650_000_000;

function word(start: number, end: number, segment: string): EnginePart {
  return { startTimeMillis: start, endTimeMillis: end, segment };
}

describe("SegmentRecorder", () => {
  it("times each final result from when it was first heard, marked approx", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.result("hello", false, T0 + 1_000);
    r.result("hello world", true, T0 + 2_500);
    r.result("how", false, T0 + 4_000);
    r.result("how are you", true, T0 + 5_200);
    assert.deepEqual(r.list(), [
      { startMs: 1_000, endMs: 2_500, text: "hello world", approx: true },
      { startMs: 4_000, endMs: 5_200, text: "how are you", approx: true },
    ]);
  });

  it("counts from the native audio start and uses 'speechstart'", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0 + 40);
    r.speechStarted(T0 + 640);
    r.result("bonjour", false, T0 + 1_240);
    r.result("bonjour à tous", true, T0 + 2_040);
    assert.deepEqual(r.list(), [
      { startMs: 600, endMs: 2_000, text: "bonjour à tous", approx: true },
    ]);
  });

  it("uses the recognizer's word times when they fit what the app saw", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("call", false, T0 + 900);
    r.result("call Sam", true, T0 + 1_900, [
      word(500, 800, "call"),
      word(850, 1_300, "Sam"),
    ]);
    assert.deepEqual(r.list(), [
      { startMs: 500, endMs: 1_300, text: "call Sam" },
    ]);
  });

  it("falls back to the app's clock when the word times are all 0", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.result("hi there", true, T0 + 1_500, [
      word(0, 0, "hi"),
      word(0, 0, "there"),
    ]);
    assert.equal(r.list()[0]?.approx, true);
  });

  it("does not trust word times counted from another origin", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.result("first part", true, T0 + 3_000);
    // A second utterance whose times restart at 0 (counted from the
    // utterance, not the session) would land before the first one.
    r.result("second", false, T0 + 8_000);
    r.result("second part", true, T0 + 9_000, [
      word(100, 400, "second"),
      word(450, 800, "part"),
    ]);
    const second = r.list()[1];
    assert.equal(second?.approx, true);
    assert.equal(second?.startMs, 8_000);
  });

  it("splits a long result into cues at pauses and sentence ends", () => {
    // iOS 17 and earlier: one final result for the whole dictation.
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("we", false, T0 + 700);
    const parts = [
      word(500, 800, "We"),
      word(850, 1_200, "start"),
      word(1_250, 1_700, "now."),
      word(2_000, 2_400, "Then"),
      word(2_450, 2_900, "we"),
      word(2_950, 3_400, "test"),
      // A pause of over a second.
      word(4_700, 5_100, "and"),
      word(5_150, 5_600, "ship"),
      word(7_000, 7_600, "today"),
    ];
    r.result(
      "We start now. Then we test and ship today",
      true,
      T0 + 10_000,
      parts,
    );
    const cues = r.list();
    assert.deepEqual(
      cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
      [
        [500, 1_700, "We start now."],
        [2_000, 3_400, "Then we test"],
        [4_700, 5_600, "and ship"],
        [7_000, 7_600, "today"],
      ],
    );
    assert.ok(cues.every((cue) => cue.endMs - cue.startMs <= MAX_CUE_MS));
    assert.ok(cues.every((cue) => cue.approx === undefined));
  });

  it("finds pauses in Android word times, which end at the next word", () => {
    // Android 14+ on device: each word ends 1 ms before the next starts and
    // the last one has no length (expo-speech-recognition 58.0.1).
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("we", false, T0 + 700);
    r.result("We start now and ship it", true, T0 + 9_500, [
      word(500, 849, "We"),
      word(850, 1_249, "start"),
      word(1_250, 4_999, "now"),
      word(5_000, 5_399, "and"),
      word(5_400, 8_999, "ship"),
      word(9_000, 9_000, "it"),
    ]);
    assert.deepEqual(
      r.list().map((cue) => [cue.startMs, cue.endMs, cue.text]),
      [
        [500, 2_750, "We start now"],
        [5_000, 6_900, "and ship"],
        [9_000, 9_300, "it"],
      ],
    );
  });

  it("offsets each restarted session by its own audio start", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("one", false, T0 + 600);
    r.result("one", true, T0 + 1_200, [word(400, 900, "one")]);
    r.commitInterim(T0 + 1_500);
    r.sessionStarted(T0 + 1_800);
    r.audioStarted(T0 + 1_850);
    r.result("two", false, T0 + 2_600);
    r.result("two", true, T0 + 3_200, [word(500, 1_000, "two")]);
    assert.deepEqual(
      r.list().map((cue) => [cue.startMs, cue.endMs, cue.text]),
      [
        [400, 900, "one"],
        [2_350, 2_850, "two"],
      ],
    );
  });

  it("keeps a session's interim text, as the accumulator does", () => {
    const r = new SegmentRecorder();
    const text = new TranscriptAccumulator();
    r.sessionStarted(T0);
    for (const [transcript, isFinal, at] of [
      ["hello", false, 1_000],
      ["hello world", true, 2_000],
      ["how are", false, 3_000],
    ] as const) {
      text.push(transcript, isFinal);
      r.result(transcript, isFinal, T0 + at);
    }
    r.commitInterim(T0 + 3_400);
    const joined = text.commitInterim();
    assert.equal(
      r
        .list()
        .map((segment) => segment.text)
        .join(" "),
      joined,
    );
    assert.deepEqual(r.list()[1], {
      startMs: 3_000,
      endMs: 3_400,
      text: "how are",
      approx: true,
    });
  });

  it("keeps whole milliseconds when the recognizer's times have fractions", () => {
    // iOS reports seconds as doubles; times x 1000 keep their fractions.
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("call", false, T0 + 900);
    r.result("call Sam", true, T0 + 1_900, [
      word(500.4, 800.2, "call"),
      word(850.5, 1_300.6, "Sam"),
    ]);
    assert.deepEqual(r.list(), [
      { startMs: 500, endMs: 1_301, text: "call Sam" },
    ]);
  });

  it("splits a long result with the result's own words", () => {
    // The recognizer's word list may spell words otherwise than its
    // transcript (case, punctuation): the cues say what the note says.
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("we", false, T0 + 700);
    const text = "We start now. Then, we ship.";
    r.result(text, true, T0 + 10_000, [
      word(500, 800, "we"),
      word(850, 1_200, "start"),
      word(1_250, 1_700, "now"),
      word(4_000, 4_400, "then"),
      word(4_450, 4_900, "we"),
      word(8_950, 9_400, "ship"),
    ]);
    const cues = r.list();
    assert.deepEqual(
      cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
      [
        [500, 1_700, "We start now."],
        [4_000, 4_900, "Then, we"],
        [8_950, 9_400, "ship."],
      ],
    );
    assert.equal(segmentsSayText(cues, text), true);
  });

  it("keeps a long result whole when its words do not line up with the recognizer's", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.audioStarted(T0);
    r.result("see", false, T0 + 700);
    const text = "See you in New York tomorrow";
    r.result(text, true, T0 + 10_000, [
      word(500, 800, "see"),
      word(850, 1_200, "you"),
      word(1_250, 1_500, "in"),
      word(4_000, 4_900, "New York"),
      word(8_950, 9_400, "tomorrow"),
    ]);
    assert.deepEqual(r.list(), [{ startMs: 500, endMs: 9_400, text }]);
  });

  it("never lets a segment start before the previous one ends", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.speechStarted(T0 + 500);
    r.result("a b", true, T0 + 2_000);
    r.result("c", true, T0 + 2_100);
    const [first, second] = r.list();
    assert.ok(second!.startMs >= first!.endMs);
  });

  it("ignores empty final results", () => {
    const r = new SegmentRecorder();
    r.sessionStarted(T0);
    r.result("  ", true, T0 + 900);
    assert.deepEqual(r.list(), []);
  });
});

describe("sanitizeSegments", () => {
  it("keeps valid segments, sorted, without unknown fields", () => {
    assert.deepEqual(
      sanitizeSegments(
        [
          { startMs: 2_000, endMs: 3_000, text: "b", speaker: "x" },
          { startMs: 0, endMs: 1_000, text: "a", approx: true },
        ],
        1_000,
      ),
      [
        { startMs: 0, endMs: 1_000, text: "a", approx: true },
        { startMs: 2_000, endMs: 3_000, text: "b" },
      ],
    );
  });

  it("drops broken entries, never the rest", () => {
    assert.deepEqual(
      sanitizeSegments(
        [
          null,
          "a",
          { startMs: -1, endMs: 10, text: "negative" },
          { startMs: 10, endMs: 5, text: "backwards" },
          { startMs: 0, endMs: Number.NaN, text: "nan" },
          { startMs: 0, endMs: 10, text: "   " },
          { startMs: 0, endMs: 10, text: 7 },
          { startMs: 0, endMs: 10, text: "ok", approx: "yes" },
        ],
        1_000,
      ),
      [{ startMs: 0, endMs: 10, text: "ok" }],
    );
    assert.equal(sanitizeSegments("nope", 1_000), undefined);
    assert.equal(sanitizeSegments([], 1_000), undefined);
  });

  it("caps how many segments and how much text are kept", () => {
    const many = Array.from({ length: MAX_SEGMENTS + 5 }, (_, i) => ({
      startMs: i,
      endMs: i + 1,
      text: "w",
    }));
    assert.equal(sanitizeSegments(many, 1_000_000)?.length, MAX_SEGMENTS);
    assert.equal(sanitizeSegments(many, 3)?.length, 3);
  });
});

describe("segments of a note that came through sync", () => {
  const desktop = [
    { startMs: 0, endMs: 1_200, text: "first", speaker: "A" },
    { startMs: 1_200, endMs: 3_000, text: "speaker said hello" },
  ];

  it("shows every segment that fits, without the fields the phone does not use", () => {
    assert.deepEqual(segmentsToShow(desktop, 1_000), [
      { startMs: 0, endMs: 1_200, text: "first" },
      { startMs: 1_200, endMs: 3_000, text: "speaker said hello" },
    ]);
    // An empty segment says nothing: leaving it out loses no words.
    assert.equal(
      segmentsToShow(
        [...desktop, { startMs: 3_000, endMs: 3_100, text: " " }],
        1_000,
      )?.length,
      2,
    );
    assert.equal(segmentsToShow(undefined, 1_000), undefined);
    assert.equal(segmentsToShow([], 1_000), undefined);
  });

  it("shows none when the phone's limits would cut one with words", () => {
    const many = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({
      startMs: i * 10,
      endMs: i * 10 + 5,
      text: "w",
    }));
    assert.equal(segmentsToShow(many, 1_000_000), undefined);
    assert.equal(segmentsToShow(desktop, 10), undefined, "past the text limit");
    assert.equal(
      segmentsToShow(
        [
          ...desktop,
          {
            startMs: MAX_SEGMENT_MS,
            endMs: MAX_SEGMENT_MS + 1_000,
            text: "eleven hours in",
          },
        ],
        1_000,
      ),
      undefined,
      "past six hours",
    );
  });

  it("tells whether segments say a text's words, whatever the spacing", () => {
    const segments = [
      { startMs: 0, endMs: 1, text: "Buy milk." },
      { startMs: 1, endMs: 2, text: " Then  call Ana" },
    ];
    assert.equal(segmentsSayText(segments, "Buy milk. Then call Ana"), true);
    assert.equal(segmentsSayText(segments, "Buy milk.\n\nThen call Ana"), true);
    assert.equal(segmentsSayText(segments, "Buy milk. Then call Ben"), false);
    assert.equal(segmentsSayText(segments, "Buy milk. Then call"), false);
    assert.equal(segmentsSayText(segments, "buy milk. Then call Ana"), false);
    assert.equal(segmentsSayText([], ""), true);
  });
});
