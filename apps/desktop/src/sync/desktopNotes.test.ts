import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  type SyncNote,
  noteFingerprint,
  parseSyncNote,
} from "@sonolect/sync-core";

import {
  type StoredCapture,
  captureToNote,
  createDesktopNoteStore,
  noteToCapture,
} from "./desktopNotes";
import { FakeNative } from "./testing/fakeNative";

const HLC = { t: 1_763_700_000_000, c: 2, d: "phone-device" };

/** A recording made on this desktop, with speakers, as the capture file keeps it. */
const recording: StoredCapture = {
  id: "1763700000000000001-4242",
  createdAtMs: Date.parse("2026-11-21T09:30:00.000Z"),
  durationMs: 4_200,
  transcript: "Welcome everyone. Thanks, glad to be here.",
  error: null,
  language: "en",
  segments: [
    { startMs: 0, endMs: 1_800, text: "Welcome everyone.", speaker: "Ana" },
    { startMs: 1_800, endMs: 4_200, text: "Thanks, glad to be here." },
  ],
};

/** A note from the phone: fields a recording here never has, and some no app version knows. */
const mobileNote: SyncNote = {
  createdAt: "2026-11-20T18:05:12.345Z",
  updatedAt: "2026-11-20T18:07:00.000Z",
  rawText: "buy milk and eggs",
  refinedText: "Buy milk and eggs.",
  title: "Groceries",
  language: "fr",
  mode: "list",
  durationMs: 2_500,
  origin: "mobile",
  source: "typed",
  pinned: true,
  privacyMode: "local",
  futureField: { nested: [1, "two", null] },
  segments: [
    {
      startMs: 0,
      endMs: 2_500,
      text: "buy milk and eggs",
      speaker: "Me",
      confidence: 0.92,
    },
  ],
};

describe("desktop captures as note/1", () => {
  it("maps a recording made here, with its segments and speakers", () => {
    const note = captureToNote(recording);
    assert.deepEqual(note, {
      createdAt: "2026-11-21T09:30:00.000Z",
      rawText: "Welcome everyone. Thanks, glad to be here.",
      language: "en",
      durationMs: 4_200,
      origin: "desktop",
      segments: [
        {
          startMs: 0,
          endMs: 1_800,
          text: "Welcome everyone.",
          speaker: "Ana",
        },
        { startMs: 1_800, endMs: 4_200, text: "Thanks, glad to be here." },
      ],
    });
    // A valid note/1, and nothing local travels: no error, no audio, no id.
    assert.deepEqual(parseSyncNote(note), note);
    assert.ok(!("error" in note) && !("hasAudio" in note) && !("id" in note));
  });

  it("leaves out what a recording does not say", () => {
    const note = captureToNote({
      ...recording,
      language: "auto",
      segments: [],
      title: "",
    });
    assert.equal(note.language, undefined);
    assert.equal(note.segments, undefined);
    assert.equal(note.title, undefined);
    assert.equal(
      captureToNote({ ...recording, language: null }).language,
      undefined,
    );
  });

  it("stores a synced note with every field, and gives it back unchanged", () => {
    const capture = noteToCapture("turn_1763661912345_k3x9q2", mobileNote, HLC);
    assert.deepEqual(capture, {
      id: "turn_1763661912345_k3x9q2",
      createdAtMs: Date.parse("2026-11-20T18:05:12.345Z"),
      durationMs: 2_500,
      transcript: "buy milk and eggs",
      error: null,
      language: "fr",
      segments: [
        {
          startMs: 0,
          endMs: 2_500,
          text: "buy milk and eggs",
          speaker: "Me",
          confidence: 0.92,
        },
      ],
      hlc: HLC,
      updatedAtMs: Date.parse("2026-11-20T18:07:00.000Z"),
      title: "Groceries",
      refinedText: "Buy milk and eggs.",
      mode: "list",
      pinned: true,
      origin: "mobile",
      source: "typed",
      extra: {
        privacyMode: "local",
        futureField: { nested: [1, "two", null] },
      },
    });
    // Through the capture file (JSON) and back: the same note.
    const stored = JSON.parse(JSON.stringify(capture)) as StoredCapture;
    assert.deepEqual(captureToNote(stored), mobileNote);
    assert.equal(
      noteFingerprint(captureToNote(stored)),
      noteFingerprint(mobileNote),
    );
  });

  it("keeps a recording made here the same through a round trip", () => {
    const note = captureToNote(recording);
    const capture = noteToCapture(recording.id, note, HLC);
    assert.deepEqual(captureToNote(capture), note);
    assert.equal(capture.origin, "desktop");
    assert.deepEqual(capture.segments, recording.segments);
  });

  it("keeps a conflict copy's original", () => {
    const copy = noteToCapture(
      "1763700000000000001-4242-cmi8x2ephon",
      { ...captureToNote(recording), conflictOf: recording.id },
      HLC,
    );
    assert.equal(copy.conflictOf, recording.id);
    assert.equal(captureToNote(copy).conflictOf, recording.id);
  });

  it("stores whole milliseconds, as the capture files need", () => {
    const capture = noteToCapture(
      "odd-note",
      {
        createdAt: "1969-12-31T23:59:59.000Z",
        rawText: "x",
        durationMs: 1_234.6,
        origin: "mobile",
        segments: [{ startMs: 10.4, endMs: 20.5, text: "x" }],
      },
      HLC,
    );
    assert.equal(capture.createdAtMs, 0);
    assert.equal(capture.durationMs, 1_235);
    assert.deepEqual(capture.segments[0], {
      startMs: 10,
      endMs: 21,
      text: "x",
    });
  });

  it("hands the engine a capture that is not a valid note as it is, without throwing", () => {
    const note = captureToNote({ ...recording, language: "x".repeat(40) });
    assert.equal(note.language, "x".repeat(40));
    assert.throws(() => parseSyncNote(note));
  });
});

describe("the desktop NoteStore", () => {
  const native = () =>
    new FakeNative({
      request: async () => ({ status: 500, body: "" }),
      now: () => Date.parse("2026-11-21T10:00:00Z"),
    });

  it("lists and reads the notes that sync, without the failed recordings", async () => {
    const device = native();
    const id = device.record("Hello there");
    device.record("", { transcript: null, error: "Retry this recording." });
    const notes = createDesktopNoteStore(device.invoke);
    const listed = await notes.list();
    assert.deepEqual(listed, [
      { id, createdAtMs: Date.parse("2026-11-21T10:00:00Z") },
    ]);
    const local = await notes.read(id);
    assert.equal(local?.note.rawText, "Hello there");
    assert.equal(local?.hlc, undefined);
    assert.equal(await notes.read("nothing-here"), undefined);
  });

  it("writes a remote note only when the local one is as expected", async () => {
    const device = native();
    const notes = createDesktopNoteStore(device.invoke);
    const id = "turn_1763661912345_k3x9q2";
    assert.equal(
      await notes.applyRemote({
        id,
        note: mobileNote,
        hlc: HLC,
        expected: { exists: false },
      }),
      true,
    );
    assert.equal(device.note(id)?.hasAudio, false);
    assert.deepEqual((await notes.read(id))?.note, mobileNote);
    // The note is there now: a second "new note" is refused.
    assert.equal(
      await notes.applyRemote({
        id,
        note: { ...mobileNote, rawText: "stale" },
        hlc: { ...HLC, c: 3 },
        expected: { exists: false },
      }),
      false,
    );
    // A remote delete with the right version removes it.
    assert.equal(
      await notes.applyRemote({
        id,
        note: null,
        hlc: { ...HLC, c: 4 },
        expected: { exists: true, hlc: { ...HLC, c: 9 } },
      }),
      false,
    );
    assert.equal(
      await notes.applyRemote({
        id,
        note: null,
        hlc: { ...HLC, c: 4 },
        expected: { exists: true, hlc: HLC },
      }),
      true,
    );
    assert.equal(device.note(id), undefined);
  });

  it("saves conflict copies whatever is there", async () => {
    const device = native();
    const notes = createDesktopNoteStore(device.invoke);
    await notes.saveConflictCopy("copy-1", mobileNote, HLC);
    await notes.saveConflictCopy(
      "copy-1",
      { ...mobileNote, rawText: "v2" },
      HLC,
    );
    assert.equal(device.note("copy-1")?.transcript, "v2");
  });

  it("turns native failures into errors", async () => {
    const notes = createDesktopNoteStore(async () => {
      throw "Invalid recording ID.";
    });
    await assert.rejects(notes.list(), /Invalid recording ID\./);
  });
});
