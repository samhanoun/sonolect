import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TranscriptTurn } from "./domain";
import { applyRetention } from "./retention";
import { sanitizeTurn, UNKNOWN_DATE } from "./storageCore";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function note(
  id: string,
  ageDays: number,
  extra: Partial<TranscriptTurn> = {},
) {
  return {
    id,
    rawText: id,
    refinedText: id,
    mode: "dictate",
    language: "en-US",
    privacyMode: false,
    createdAt: new Date(NOW - ageDays * DAY).toISOString(),
    durationMs: 1000,
    source: "microphone",
    syncState: "local",
    ...extra,
  } satisfies TranscriptTurn;
}

describe("note retention", () => {
  it("keeps everything when retention is off", () => {
    const history = [note("a", 400), note("b", 0)];
    const result = applyRetention(history, 0, NOW);
    assert.deepEqual(result.kept, history);
    assert.deepEqual(result.expired, []);
  });

  it("expires notes older than the limit and keeps the order of the rest", () => {
    const history = [
      note("today", 0),
      note("six days", 6.9),
      note("eight days", 8),
      note("yesterday", 1),
      note("a month", 31),
    ];
    const result = applyRetention(history, 7, NOW);
    assert.deepEqual(
      result.kept.map((turn) => turn.id),
      ["today", "six days", "yesterday"],
    );
    assert.deepEqual(
      result.expired.map((turn) => turn.id),
      ["eight days", "a month"],
    );
  });

  it("keeps a note that is exactly at the limit", () => {
    const result = applyRetention([note("edge", 1)], 1, NOW);
    assert.equal(result.expired.length, 0);
  });

  it("never expires pinned notes", () => {
    const result = applyRetention(
      [note("pinned", 365, { pinned: true }), note("old", 365)],
      30,
      NOW,
    );
    assert.deepEqual(
      result.kept.map((turn) => turn.id),
      ["pinned"],
    );
    assert.deepEqual(
      result.expired.map((turn) => turn.id),
      ["old"],
    );
  });

  it("keeps notes whose date cannot be read", () => {
    const result = applyRetention(
      [note("broken", 0, { createdAt: "not a date" })],
      1,
      NOW,
    );
    assert.equal(result.kept.length, 1);
    assert.equal(result.expired.length, 0);
  });

  it("keeps a stored note whose date was missing or unreadable", () => {
    // What launch does: storage reads the note first and gives it the
    // unknown date, then retention runs on the result.
    const stored = [
      { id: "no-date", rawText: "kept", refinedText: "kept" },
      { id: "bad-date", rawText: "kept", refinedText: "kept", createdAt: "?" },
      {
        id: "old",
        rawText: "gone",
        refinedText: "gone",
        createdAt: new Date(NOW - 40 * DAY).toISOString(),
      },
    ];
    const history = stored
      .map((value) => sanitizeTurn(value, NOW))
      .filter((turn): turn is TranscriptTurn => turn !== null);
    assert.deepEqual(history.map((turn) => turn.createdAt).slice(0, 2), [
      UNKNOWN_DATE,
      UNKNOWN_DATE,
    ]);
    const result = applyRetention(history, 1, NOW);
    assert.deepEqual(
      result.kept.map((turn) => turn.id),
      ["no-date", "bad-date"],
    );
    assert.deepEqual(
      result.expired.map((turn) => turn.id),
      ["old"],
    );
  });
});
