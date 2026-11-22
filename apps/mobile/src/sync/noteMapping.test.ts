import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Hlc,
  type SyncNote,
  noteFingerprint,
  parseSyncNote,
} from "@sonolect/sync-core";

import type { NoteSegment, TranscriptTurn } from "../domain";
import { MAX_SEGMENTS } from "../noteSegments";
import { MAX_TEXT_LENGTH, sanitizeTurn } from "../storageCore";
import { noteToTurn, parseCompanion, turnToNote } from "./noteMapping";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const HLC: Hlc = { t: NOW - 1000, c: 2, d: "deviceA" };

const phoneTurn = (patch: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  id: "turn_1763640000000_abc123",
  rawText: "buy milk and bread",
  refinedText: "Buy milk and bread.",
  mode: "dictate",
  language: "en-US",
  privacyMode: false,
  createdAt: "2026-11-20T11:00:00.000Z",
  durationMs: 4200,
  source: "microphone",
  syncState: "local",
  ...patch,
});

/** A desktop capture as note/1, with fields the phone has no place for. */
const desktopNote = (patch: Partial<SyncNote> = {}): SyncNote => ({
  createdAt: "2026-11-19T08:30:00Z",
  updatedAt: "2026-11-19T09:00:00Z",
  rawText: "first speaker said hello",
  title: "Standup",
  language: "fr",
  mode: "meeting_notes",
  durationMs: 61_000,
  origin: "desktop",
  source: "system",
  segments: [
    { startMs: 0, endMs: 1200, text: "first", speaker: "A", gain: 0.5 },
    { startMs: 1200, endMs: 3000, text: "speaker said hello" },
  ],
  futureField: { nested: [1, 2, 3] },
  ...patch,
});

/** A dictation's segments, as the capture loop records them. */
const SEGMENTS: NoteSegment[] = [
  { startMs: 400, endMs: 1_300, text: "buy milk" },
  { startMs: 1_900, endMs: 2_600, text: "and bread", approx: true },
];

/** The turn as the next launch reads it back from storage. */
const reloaded = (turn: TranscriptTurn): TranscriptTurn =>
  sanitizeTurn(JSON.parse(JSON.stringify(turn)), NOW)!;

/** What the phone sends back for a note it received and did not change. */
function roundTrip(note: SyncNote, id = "note-1") {
  const { turn, companion } = noteToTurn(id, note, HLC, NOW);
  return {
    turn,
    companion,
    back: turnToNote(turn, parseCompanion(companion)),
  };
}

describe("note mapping: phone notes", () => {
  it("sends a phone note as a valid note/1 and reads it back unchanged", () => {
    const turn = phoneTurn({ pinned: true });
    const note = turnToNote(turn, null);
    assert.deepEqual(parseSyncNote(note), note);
    assert.deepEqual(note, {
      createdAt: turn.createdAt,
      rawText: turn.rawText,
      refinedText: turn.refinedText,
      language: "en-US",
      mode: "dictate",
      durationMs: 4200,
      source: "microphone",
      pinned: true,
      privacyMode: false,
      origin: "mobile",
    });
    const back = noteToTurn(turn.id, note, HLC, NOW);
    assert.deepEqual(back.turn, { ...turn, hlc: HLC });
    assert.equal(back.companion, null, "a phone note needs no companion");
  });

  it("leaves out what note/1 leaves out: auto language, equal texts, unpinned", () => {
    const turn = phoneTurn({
      language: "auto",
      refinedText: "buy milk and bread",
      source: "typed",
      durationMs: 0,
    });
    const note = turnToNote(turn, null);
    assert.equal("language" in note, false);
    assert.equal("refinedText" in note, false);
    assert.equal("pinned" in note, false);
    assert.equal("conflictOf" in note, false);
    const back = noteToTurn(turn.id, note, HLC, NOW);
    assert.deepEqual(back.turn, { ...turn, hlc: HLC });
    assert.equal(back.companion, null);
  });

  it("keeps the local-only sync state of the note it replaces", () => {
    const previous = phoneTurn({ syncState: "queued" });
    const { turn } = noteToTurn(
      previous.id,
      turnToNote(previous, null),
      HLC,
      NOW,
      previous,
    );
    assert.equal(turn.syncState, "queued");
    assert.equal(
      noteToTurn(previous.id, turnToNote(previous, null), HLC, NOW).turn
        .syncState,
      "local",
    );
  });

  it("carries a conflict copy's original id both ways", () => {
    const turn = phoneTurn({ conflictOf: "turn_1_aaaaaa" });
    const note = turnToNote(turn, null);
    assert.equal(note.conflictOf, "turn_1_aaaaaa");
    assert.equal(
      noteToTurn("copy", note, HLC, NOW).turn.conflictOf,
      "turn_1_aaaaaa",
    );
  });
});

describe("note mapping: notes from other devices", () => {
  it("gives back every field of a desktop note the phone did not change", () => {
    const note = desktopNote();
    const { turn, companion, back } = roundTrip(note);
    assert.equal(turn.source, "remote", "a system capture shows as remote");
    assert.equal(turn.language, "fr");
    assert.equal(turn.mode, "meeting_notes");
    assert.equal(turn.refinedText, note.rawText);
    assert.equal(turn.privacyMode, false);
    assert.deepEqual(turn.hlc, HLC);
    assert.notEqual(companion, null);
    assert.deepEqual(back, note);
  });

  it("keeps a desktop note's absent privacy mode absent", () => {
    const { back } = roundTrip(desktopNote());
    assert.equal("privacyMode" in back, false);
  });

  it("keeps a mode and a source the phone does not know", () => {
    const note = desktopNote({ mode: "brainstorm", source: "file" });
    const { turn, back } = roundTrip(note);
    assert.equal(turn.mode, "dictate");
    assert.equal(turn.source, "remote");
    assert.equal(back.mode, "brainstorm");
    assert.equal(back.source, "file");
  });

  it("restores a text the phone cut at its length limit", () => {
    const long = "word ".repeat(50_000);
    assert.ok(long.length > MAX_TEXT_LENGTH);
    const note = desktopNote({ rawText: long });
    const { turn, back } = roundTrip(note);
    assert.equal(turn.rawText.length, MAX_TEXT_LENGTH);
    assert.equal(back.rawText, long);
    assert.equal("refinedText" in back, false);
  });

  it("restores a date the phone moved back from the future", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    const { turn, back } = roundTrip(desktopNote({ createdAt: future }));
    assert.equal(turn.createdAt, new Date(NOW).toISOString());
    assert.equal(back.createdAt, future);
  });

  it("keeps an explicit pinned false and a refined text equal to the transcript", () => {
    const note = desktopNote({ pinned: false, refinedText: "same" });
    const { back } = roundTrip({ ...note, rawText: "same" });
    assert.equal(back.pinned, false);
    assert.equal(back.refinedText, "same");
  });

  it("sends the phone's value once the user changed a field here", () => {
    const note = desktopNote({ mode: "brainstorm", pinned: false });
    const { turn, companion } = noteToTurn("note-1", note, HLC, NOW);
    const parsed = parseCompanion(companion);
    const edited: TranscriptTurn = {
      ...turn,
      mode: "summarize",
      refinedText: "A summary.",
      pinned: true,
    };
    const sent = turnToNote(edited, parsed);
    assert.equal(sent.mode, "summarize");
    assert.equal(sent.refinedText, "A summary.");
    assert.equal(sent.pinned, true);
    // Unchanged fields still carry the desktop's values.
    assert.equal(sent.source, "system");
    assert.equal(sent.title, "Standup");
    assert.deepEqual(sent.segments, note.segments);
    assert.deepEqual(sent.futureField, note.futureField);
    assert.equal(sent.origin, "desktop");
    assert.deepEqual(parseSyncNote(sent), sent);
  });

  it("sends the cut text once the user changed the transcript here", () => {
    const long = "x".repeat(MAX_TEXT_LENGTH + 10);
    const { turn, companion } = noteToTurn(
      "note-1",
      desktopNote({ rawText: long }),
      HLC,
      NOW,
    );
    const sent = turnToNote(
      { ...turn, rawText: "short now", refinedText: "Short now." },
      parseCompanion(companion),
    );
    assert.equal(sent.rawText, "short now");
    assert.equal(sent.refinedText, "Short now.");
  });

  it("unpins: a pinned note sent unpinned leaves pinned out", () => {
    const { turn, companion } = noteToTurn(
      "note-1",
      desktopNote({ pinned: true }),
      HLC,
      NOW,
    );
    assert.equal(turn.pinned, true);
    const { pinned: _pinned, ...unpinned } = turn;
    const sent = turnToNote(unpinned, parseCompanion(companion));
    assert.equal("pinned" in sent, false);
  });
});

describe("note mapping: the companion value", () => {
  it("reads only a valid companion", () => {
    assert.equal(parseCompanion(null), null);
    assert.equal(parseCompanion(undefined), null);
    assert.equal(parseCompanion("{"), null);
    assert.equal(parseCompanion('{"v":2,"extra":{},"kept":{}}'), null);
    assert.equal(parseCompanion("[1]"), null);
    assert.deepEqual(parseCompanion('{"v":1}'), { v: 1, extra: {}, kept: {} });
  });

  it("ignores shown fields in extra and malformed kept entries", () => {
    const parsed = parseCompanion(
      JSON.stringify({
        v: 1,
        extra: { rawText: "not here", title: "kept" },
        kept: {
          mode: { shown: 3 },
          source: "system",
          language: { shown: "x.y" },
          rawText: { shown: "a.b", value: "full" },
          bogus: { shown: "c.d", value: 1 },
        },
      }),
    );
    assert.deepEqual(parsed, {
      v: 1,
      extra: { title: "kept" },
      kept: {
        language: { shown: "x.y" },
        rawText: { shown: "a.b", value: "full" },
      },
    });
  });

  it("keeps every field of a very long note, which a pin then sends back whole", () => {
    // Over 1.5 MB of segments and a text over what the phone shows.
    const huge = "y".repeat(MAX_TEXT_LENGTH + 500_000);
    const segments = Array.from({ length: 6_500 }, (_, index) => ({
      startMs: index * 6_000,
      endMs: index * 6_000 + 5_900,
      text: "the budget for next quarter, and the launch date we should review.",
      speaker: index % 2 ? "Ana" : "Ben",
    }));
    const note = desktopNote({ rawText: huge, segments });
    const { turn, companion } = noteToTurn("note-1", note, HLC, NOW);
    assert.ok(companion !== null && companion.length > 1_500_000);
    assert.equal(turn.segments, undefined, "too many for the phone to show");
    const pinned = turnToNote(
      { ...turn, pinned: true },
      parseCompanion(companion),
    );
    assert.equal(pinned.rawText, huge, "the whole transcript");
    assert.deepEqual(pinned.segments, segments, "every segment");
    assert.equal(pinned.pinned, true);
    assert.equal(
      noteFingerprint(pinned),
      noteFingerprint(note),
      "a pin changes no content",
    );
  });
});

describe("note mapping: segments", () => {
  it("sends a dictation's segments, with the approx mark, and reads them back with no companion", () => {
    const turn = phoneTurn({ segments: SEGMENTS });
    const note = turnToNote(turn, null);
    assert.deepEqual(note.segments, SEGMENTS);
    assert.deepEqual(parseSyncNote(note), note, "a valid note/1");
    const back = noteToTurn(turn.id, note, HLC, NOW);
    assert.deepEqual(back.turn, { ...turn, hlc: HLC });
    assert.equal(back.companion, null);
    // Read again after a launch, it is the same note: same content hash.
    assert.deepEqual(turnToNote(reloaded(back.turn), null), note);
    assert.equal(
      noteFingerprint(turnToNote(reloaded(back.turn), null)),
      noteFingerprint(note),
    );
  });

  it("keeps a dictation's segments through a refine, which changes only the refined text", () => {
    const turn = phoneTurn({ segments: SEGMENTS });
    for (const mode of ["summarize", "task_creation", "rewrite"] as const) {
      const refined: TranscriptTurn = {
        ...turn,
        mode,
        refinedText: "- Buy milk\n- Buy bread",
      };
      const sent = turnToNote(refined, null);
      assert.deepEqual(sent.segments, SEGMENTS, mode);
      assert.equal(sent.rawText, turn.rawText);
    }
  });

  it("does not send segments that do not say the note's words, and keeps them here", () => {
    const turn = phoneTurn({
      segments: [{ startMs: 0, endMs: 900, text: "buy oat milk" }],
    });
    const note = turnToNote(turn, null);
    assert.equal("segments" in note, false);
    assert.equal(turn.segments?.length, 1);
  });

  it("shows a desktop note's segments without speakers, and sends them back with them", () => {
    const note = desktopNote();
    const { turn, back } = roundTrip(note);
    assert.deepEqual(turn.segments, [
      { startMs: 0, endMs: 1_200, text: "first" },
      { startMs: 1_200, endMs: 3_000, text: "speaker said hello" },
    ]);
    assert.deepEqual(back.segments, note.segments);
    assert.equal(noteFingerprint(back), noteFingerprint(note));
  });

  it("sends a desktop note's segments back as they came after a refine, a pin and a launch", () => {
    const note = desktopNote();
    const { turn, companion } = noteToTurn("note-1", note, HLC, NOW);
    const changed = reloaded({
      ...turn,
      mode: "summarize",
      refinedText: "A summary.",
      pinned: true,
    });
    const sent = turnToNote(changed, parseCompanion(companion));
    assert.deepEqual(sent.segments, note.segments);
    assert.equal(sent.refinedText, "A summary.");
    // Even if the phone came to show them otherwise, they go back whole.
    assert.ok(changed.segments);
    const shownOtherwise = turnToNote(
      { ...changed, segments: changed.segments.slice(0, 1) },
      parseCompanion(companion),
    );
    assert.deepEqual(shownOtherwise.segments, note.segments);
  });

  it("shows no segments when one would not fit, and keeps every one for sync", () => {
    const segments = Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({
      startMs: i * 1_000,
      endMs: i * 1_000 + 900,
      text: `word${i}`,
    }));
    const note = desktopNote({
      rawText: segments.map((segment) => segment.text).join(" "),
      segments,
    });
    const { turn, back } = roundTrip(note);
    assert.equal(turn.segments, undefined, "no Subtitles for part of a note");
    assert.deepEqual(back.segments, segments);
    // Past six hours on the phone's clock: none shown, all kept.
    const late = desktopNote({
      segments: [
        { startMs: 0, endMs: 1_000, text: "first" },
        { startMs: 7 * 3_600_000, endMs: 7 * 3_600_000 + 900, text: "late" },
      ],
    });
    const lateTrip = roundTrip(late);
    assert.equal(lateTrip.turn.segments, undefined);
    assert.deepEqual(lateTrip.back.segments, late.segments);
  });

  it("keeps an empty segment list and a note without segments as they came", () => {
    const empty = desktopNote({ segments: [] });
    const { turn, back } = roundTrip(empty);
    assert.equal(turn.segments, undefined);
    assert.deepEqual(back.segments, []);
    const { segments: _segments, ...without } = desktopNote();
    const none = roundTrip(without);
    assert.equal(none.turn.segments, undefined);
    assert.equal("segments" in none.back, false);
  });

  it("shows a phone dictation that came from another phone, and keeps the approx mark", () => {
    const fromPhone = turnToNote(phoneTurn({ segments: SEGMENTS }), null);
    const { turn, companion } = noteToTurn("other", fromPhone, HLC, NOW);
    assert.deepEqual(turn.segments, SEGMENTS);
    assert.equal(companion, null);
  });

  it("sends the segments a companion kept in extra before the phone showed them", () => {
    const note = desktopNote();
    const { turn, companion } = noteToTurn("note-1", note, HLC, NOW);
    // The turn and companion an earlier build stored: no segments shown,
    // and the segments in extra.
    const { segments: _shown, ...oldTurn } = turn;
    const { segments: _kept, ...oldKept } = parseCompanion(companion)!.kept;
    assert.ok(_kept, "this build keeps them in kept");
    const oldCompanion = JSON.stringify({
      v: 1,
      extra: {
        title: note.title,
        updatedAt: note.updatedAt,
        origin: note.origin,
        segments: note.segments,
        futureField: note.futureField,
      },
      kept: oldKept,
    });
    const parsed = parseCompanion(oldCompanion);
    assert.equal("segments" in parsed!.extra, false);
    const sent = turnToNote(oldTurn, parsed);
    assert.deepEqual(sent, note);
  });
});
