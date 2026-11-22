import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_CUE_CHARS } from "./noteSegments";
import { cleanParts } from "./refine";
import {
  MAX_LINE_CHARS,
  MIN_CUE_MS,
  SUBTITLE_FILE_TYPES,
  SUBTITLE_FORMATS,
  formatCueTime,
  hasSubtitles,
  subtitleCues,
  toSrt,
  toVtt,
  wrapCueText,
} from "./subtitles";

describe("formatCueTime", () => {
  it("writes HH:MM:SS with the format's separator", () => {
    assert.equal(formatCueTime(0, ","), "00:00:00,000");
    assert.equal(formatCueTime(3_723_004, ","), "01:02:03,004");
    assert.equal(formatCueTime(59_999.6, "."), "00:01:00.000");
    assert.equal(formatCueTime(-5, "."), "00:00:00.000");
  });
});

describe("wrapCueText", () => {
  it("keeps a short line and breaks a long one near the middle", () => {
    assert.equal(wrapCueText("short line"), "short line");
    const long =
      "the quick brown fox jumps over the lazy dog and keeps on running";
    const wrapped = wrapCueText(long);
    const lines = wrapped.split("\n");
    assert.equal(lines.length, 2);
    assert.equal(lines.join(" "), long);
    assert.ok(lines.every((line) => line.length <= MAX_LINE_CHARS));
  });

  it("leaves a single long word alone", () => {
    const word = "x".repeat(MAX_LINE_CHARS + 5);
    assert.equal(wrapCueText(word), word);
  });

  it("keeps both lines of a nearly full cue within 42 characters", () => {
    // The space nearest the middle would make a first line of 44.
    const text = `${"a".repeat(40)} bb ${"c".repeat(38)}`;
    assert.equal(text.length, 82);
    assert.deepEqual(wrapCueText(text).split("\n"), [
      `${"a".repeat(40)}`,
      `bb ${"c".repeat(38)}`,
    ]);
  });
});

describe("cue lines", () => {
  it("gives each cue at most two lines of 42 characters", () => {
    const text =
      "So the plan for this week is to finish the onboarding screens first, " +
      "then the settings page, and after that we look at notifications. " +
      "Marie said the design for the reminder sheet is almost ready, " +
      "but she still wants to test the wording with two or three people. " +
      "I will write the release notes on Thursday, and we ship on Friday " +
      "if the beta testers do not find anything serious in the export flow.";
    const cues = subtitleCues([{ startMs: 0, endMs: 60_000, text }]);
    // Each SRT block: its number, its times, then its lines.
    const blocks = toSrt(cues)
      .trim()
      .split("\n\n")
      .map((block) => block.split("\n").slice(2));
    assert.ok(cues.length > 3);
    for (const block of blocks) {
      assert.ok(block.length <= 2, block.join("|"));
      assert.ok(
        block.every((line) => line.length <= MAX_LINE_CHARS),
        block.join("|"),
      );
    }
  });

  it("wraps a cue the same way in SRT and WebVTT, whatever the escapes", () => {
    const text = "I like A & B & C & D & E very much, says x";
    assert.equal(text.length, MAX_LINE_CHARS);
    const cues = [{ startMs: 0, endMs: 1_000, text }];
    assert.equal(toSrt(cues).split("\n")[2], text);
    assert.equal(
      toVtt(cues).split("\n")[3],
      "I like A &amp; B &amp; C &amp; D &amp; E very much, says x",
    );
    assert.equal(toVtt(cues).split("\n").length, 5);
  });
});

describe("subtitleCues", () => {
  it("cleans the segments as one transcript and drops what is left empty", () => {
    const cues = subtitleCues(
      [
        { startMs: 0, endMs: 1_000, text: "um hello   there" },
        { startMs: 1_200, endMs: 2_000, text: "um" },
      ],
      (texts) => cleanParts(texts),
    );
    assert.deepEqual(cues, [
      { startMs: 0, endMs: 1_000, text: "Hello there." },
    ]);
  });

  it("keeps a sentence going into the next segment, with its own time", () => {
    const cues = subtitleCues(
      [
        { startMs: 0, endMs: 2_000, text: "i went to the store and" },
        { startMs: 2_200, endMs: 4_000, text: "bought some milk" },
      ],
      (texts) => cleanParts(texts),
    );
    assert.deepEqual(cues, [
      { startMs: 0, endMs: 2_000, text: "I went to the store and" },
      { startMs: 2_200, endMs: 4_000, text: "bought some milk." },
    ]);
  });

  it("replaces a phrase said across segments, over their time", () => {
    const context = {
      dictionary: [{ id: "d1", spoken: "new york", replacement: "New York" }],
      snippets: [
        { id: "s1", trigger: "insert my address", body: "1 Main Street" },
      ],
    };
    const cues = subtitleCues(
      [
        // Out of order on purpose: the clean-up reads them in time order.
        { startMs: 3_000, endMs: 3_400, text: "address" },
        { startMs: 0, endMs: 1_000, text: "we moved to new" },
        { startMs: 2_600, endMs: 2_900, text: "insert my" },
        { startMs: 1_100, endMs: 2_500, text: "york. please" },
      ],
      (texts) => cleanParts(texts, context),
    );
    assert.deepEqual(cues, [
      { startMs: 0, endMs: 2_500, text: "We moved to New York. Please" },
      { startMs: 2_600, endMs: 3_400, text: "1 Main Street." },
    ]);
  });

  it("splits a long segment, sharing its time by length", () => {
    const sentence = "This sentence is long enough to end a cue on its own.";
    const text = `${sentence} ${sentence}`;
    assert.ok(text.length > MAX_CUE_CHARS);
    const cues = subtitleCues([{ startMs: 1_000, endMs: 5_000, text }]);
    assert.deepEqual(
      cues.map((cue) => cue.text),
      [sentence, sentence],
    );
    assert.equal(cues[0]?.startMs, 1_000);
    assert.equal(cues[0]?.endMs, 3_000);
    assert.equal(cues[1]?.startMs, 3_000);
    assert.equal(cues[1]?.endMs, 5_000);
  });

  it("orders cues, never overlaps them and shows each long enough", () => {
    const cues = subtitleCues([
      { startMs: 5_000, endMs: 5_100, text: "late" },
      { startMs: 0, endMs: 100, text: "first" },
      { startMs: 400, endMs: 6_000, text: "overlapping" },
    ]);
    assert.deepEqual(cues, [
      { startMs: 0, endMs: 400, text: "first" },
      { startMs: 400, endMs: 5_000, text: "overlapping" },
      { startMs: 5_000, endMs: 5_000 + MIN_CUE_MS, text: "late" },
    ]);
  });

  it("gives a zero-length segment a visible cue", () => {
    const [cue] = subtitleCues([{ startMs: 800, endMs: 800, text: "hi" }]);
    assert.deepEqual(cue, {
      startMs: 800,
      endMs: 800 + MIN_CUE_MS,
      text: "hi",
    });
  });
});

describe("toSrt", () => {
  it("numbers cues and writes SubRip times", () => {
    assert.equal(
      toSrt([
        { startMs: 0, endMs: 1_500, text: "Hello there." },
        { startMs: 2_000, endMs: 3_250, text: "a --> b" },
      ]),
      "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n" +
        "2\n00:00:02,000 --> 00:00:03,250\na → b\n",
    );
    assert.equal(toSrt([]), "");
  });
});

describe("toVtt", () => {
  it("writes a WEBVTT header, an optional note and escaped cues", () => {
    assert.equal(
      toVtt([{ startMs: 61_000, endMs: 62_000, text: "<b>Tom & Jerry</b>" }]),
      "WEBVTT\n\n00:01:01.000 --> 00:01:02.000\n&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;\n",
    );
    assert.equal(
      toVtt([], "Timings are approximate --> roughly"),
      "WEBVTT\n\nNOTE Timings are approximate → roughly\n",
    );
  });
});

describe("subtitle files", () => {
  it("has a file type for every format and knows which notes have timings", () => {
    for (const format of SUBTITLE_FORMATS) {
      assert.ok(SUBTITLE_FILE_TYPES[format].extension === format);
    }
    assert.equal(hasSubtitles({}), false);
    assert.equal(hasSubtitles({ segments: [] }), false);
    assert.equal(
      hasSubtitles({ segments: [{ startMs: 0, endMs: 1, text: "a" }] }),
      true,
    );
  });
});
