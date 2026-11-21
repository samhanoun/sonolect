import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Hlc, type SyncNote, parseSyncNote } from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";
import { MAX_TEXT_LENGTH } from "../storageCore";
import {
  MAX_COMPANION_BYTES,
  noteToTurn,
  parseCompanion,
  turnToNote,
  utf8Length,
} from "./noteMapping";

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

  it("measures UTF-8 without encoding", () => {
    assert.equal(utf8Length("abc"), 3);
    assert.equal(utf8Length("é"), 2);
    assert.equal(utf8Length("€"), 3);
    assert.equal(utf8Length("😀"), 4);
    assert.equal(utf8Length(""), 0);
  });

  it("stays under the storage limit by dropping the largest values first", () => {
    const huge = "y".repeat(MAX_COMPANION_BYTES + 1000);
    const note = desktopNote({ rawText: huge, title: "Kept title" });
    const { turn, companion } = noteToTurn("note-1", note, HLC, NOW);
    assert.ok(companion !== null);
    assert.ok(utf8Length(companion) <= MAX_COMPANION_BYTES);
    const parsed = parseCompanion(companion);
    assert.equal(parsed?.kept.rawText, undefined, "the huge text went first");
    assert.equal(parsed?.extra.title, "Kept title");
    assert.equal(parsed?.extra.origin, "desktop");
    // What the phone shows is what it can send back.
    assert.equal(turnToNote(turn, parsed).rawText, turn.rawText);
  });
});
