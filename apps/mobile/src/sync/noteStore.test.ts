import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type SyncNote,
  createMemoryStateStore,
  deriveVaultKeys,
  openSyncEngine,
} from "@sonolect/sync-core";
import {
  type MemoryVaultServer,
  createMemoryNoteStore,
} from "@sonolect/sync-core/testing";

import { SYNC_COMPANION_PREFIX, noteKey } from "../storageCore";
import { placeNotes, stampTurn } from "./edits";
import { NotesChangedError } from "./noteStore";
import {
  TestPhone,
  createTestVault,
  makeTurn,
  settle,
  testRandomBytes,
} from "./testSupport";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");

const vault = async () => createTestVault(NOW);

/** A desktop app on the same vault: sync-core's reference note store. */
async function desktop(
  server: MemoryVaultServer,
  keys: ReturnType<typeof deriveVaultKeys>,
) {
  const notes = createMemoryNoteStore();
  const engine = await openSyncEngine({
    keys,
    transport: server.transport(keys),
    notes,
    state: createMemoryStateStore(),
    randomBytes: testRandomBytes,
    now: () => NOW,
  });
  return { notes, engine };
}

const desktopCapture: SyncNote = {
  createdAt: "2026-11-19T08:30:00Z",
  updatedAt: "2026-11-19T09:00:00Z",
  rawText: "first speaker said hello",
  title: "Standup",
  language: "fr",
  durationMs: 61_000,
  origin: "desktop",
  source: "system",
  segments: [{ startMs: 0, endMs: 1200, text: "first", speaker: "A" }],
  futureField: { kept: true },
};

describe("sync note store: two phones", () => {
  it("sends a note to the other phone, which stores it", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn({ pinned: true }), a.stamp);
    await a.engine.sync();
    const report = await b.engine.sync();
    assert.equal(report.pulled, 1);
    const received = b.phone.get(note.id);
    assert.deepEqual(received, note);
    // Stored, not only shown: a restart reads it back.
    await b.phone.restart();
    assert.deepEqual(b.phone.get(note.id), note);
    assert.equal(
      b.phone.kv.data.has(`${SYNC_COMPANION_PREFIX}${note.id}`),
      false,
      "a phone note needs no companion",
    );
  });

  it("brings an edit back, and a delete across", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    v.tick();
    await b.phone.edit(
      note.id,
      { mode: "summarize", refinedText: "A summary." },
      b.stamp,
    );
    await b.engine.sync();
    await a.engine.sync();
    assert.equal(a.phone.get(note.id)?.refinedText, "A summary.");
    assert.equal(a.phone.get(note.id)?.mode, "summarize");

    v.tick();
    await a.engine.recordDeletes([
      { id: note.id, hlc: a.phone.get(note.id)?.hlc },
    ]);
    await a.phone.remove(note.id);
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.get(note.id), undefined);
    assert.equal(b.phone.kv.data.has(noteKey(note.id)), false);
    assert.deepEqual(b.phone.removedShown, [note.id]);
  });

  it("leaves a note on the server when retention removes it here", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    await a.phone.remove(note.id); // retention: no recordDeletes
    await a.engine.sync();
    await b.engine.sync();
    assert.ok(b.phone.get(note.id), "still on the other phone");
    assert.equal(
      v.server.records(v.keys.vaultId).filter((record) => record.deleted)
        .length,
      0,
      "no tombstone",
    );
  });

  it("does not import a note older than this phone's retention", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device({ retentionDays: 7 });
    const old = await a.phone.add(
      makeTurn({ createdAt: new Date(NOW - 10 * 86_400_000).toISOString() }),
      a.stamp,
    );
    const pinned = await a.phone.add(
      makeTurn({
        createdAt: new Date(NOW - 10 * 86_400_000).toISOString(),
        pinned: true,
      }),
      a.stamp,
    );
    await a.engine.sync();
    const report = await b.engine.sync();
    assert.equal(report.skippedExpired, 1);
    assert.equal(b.phone.get(old.id), undefined);
    assert.ok(b.phone.get(pinned.id), "a pinned note is kept");
  });

  it("keeps both versions of a note changed on both phones", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    v.tick();
    await a.phone.edit(note.id, { refinedText: "Version A." }, a.stamp);
    v.tick();
    await b.phone.edit(note.id, { refinedText: "Version B." }, b.stamp);
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const phone of [a.phone, b.phone]) {
      assert.equal(phone.get(note.id)?.refinedText, "Version B.");
      const copies = phone.history.filter(
        (turn) => turn.conflictOf === note.id,
      );
      assert.equal(copies.length, 1);
      assert.equal(copies[0]?.refinedText, "Version A.");
    }
  });
});

describe("sync note store: other devices' fields", () => {
  it("shows a desktop capture and gives back its fields after a pin here", async () => {
    const v = await vault();
    const pc = await desktop(v.server, v.keys);
    pc.notes.put("1763540000000-1", desktopCapture, pc.engine.stamp());
    await pc.engine.sync();
    const a = await v.device();
    await a.engine.sync();
    const shown = a.phone.get("1763540000000-1");
    assert.equal(shown?.source, "remote");
    assert.equal(shown?.rawText, desktopCapture.rawText);
    // The phone restarts before the user pins it: the companion is read back.
    await a.phone.restart();
    v.tick();
    await a.phone.edit("1763540000000-1", { pinned: true }, a.stamp);
    await a.engine.sync();
    await pc.engine.sync();
    assert.deepEqual(pc.notes.get("1763540000000-1")?.note, {
      ...desktopCapture,
      pinned: true,
    });
  });

  it("removes a note's companion with it", async () => {
    const v = await vault();
    const pc = await desktop(v.server, v.keys);
    pc.notes.put("1763540000000-2", desktopCapture, pc.engine.stamp());
    await pc.engine.sync();
    const a = await v.device();
    await a.engine.sync();
    const companion = `${SYNC_COMPANION_PREFIX}1763540000000-2`;
    assert.equal(a.phone.kv.data.has(companion), true);
    await pc.engine.recordDeletes([
      { id: "1763540000000-2", hlc: pc.notes.get("1763540000000-2")?.hlc },
    ]);
    pc.notes.remove("1763540000000-2");
    await pc.engine.sync();
    await a.engine.sync();
    assert.equal(a.phone.kv.data.has(companion), false);
    assert.equal(a.phone.get("1763540000000-2"), undefined);
  });
});

describe("sync note store: writes that race the user", () => {
  it("keeps an edit made while a remote version is being written", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    v.tick();
    await a.phone.edit(note.id, { refinedText: "From A." }, a.stamp);
    await a.engine.sync();

    // Hold B's write of A's version; edit the note on B meanwhile.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = true;
    b.phone.kv.gate = async (op) => {
      if (holding && op === "multiSet") {
        holding = false;
        await held;
      }
    };
    const run = b.engine.sync();
    await settle();
    v.tick();
    // Shown at once; its save waits behind the held write.
    const editing = b.phone.edit(
      note.id,
      { refinedText: "Typed on B." },
      b.stamp,
    );
    release();
    await editing;
    const report = await run;
    assert.equal(report.deferred, true);
    assert.equal(b.phone.get(note.id)?.refinedText, "Typed on B.");
    await b.phone.restart();
    assert.equal(b.phone.get(note.id)?.refinedText, "Typed on B.");

    // The next runs settle it: B's later edit wins, A's text is kept as a copy.
    await b.engine.sync();
    await a.engine.sync();
    for (const phone of [a.phone, b.phone]) {
      assert.equal(phone.get(note.id)?.refinedText, "Typed on B.");
      assert.ok(
        phone.history.some(
          (turn) =>
            turn.conflictOf === note.id && turn.refinedText === "From A.",
        ),
      );
    }
  });

  it("tries again when another note changes while a remote version is being written", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    v.tick();
    await a.phone.edit(note.id, { refinedText: "From A." }, a.stamp);
    await a.engine.sync();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = true;
    b.phone.kv.gate = async (op) => {
      if (holding && op === "multiSet") {
        holding = false;
        await held;
      }
    };
    const run = b.engine.sync();
    await settle();
    // A new note on B: its save, queued behind the held write, still holds
    // the version of the note B showed.
    const adding = b.phone.add(
      makeTurn({ refinedText: "New on B." }),
      b.stamp,
    );
    release();
    const added = await adding;
    const report = await run;
    assert.equal(report.deferred, true);
    assert.equal(b.phone.get(note.id)?.refinedText, note.refinedText);
    await b.phone.restart();
    assert.equal(
      b.phone.get(note.id)?.refinedText,
      note.refinedText,
      "storage holds what B showed",
    );

    await b.engine.sync();
    assert.equal(b.phone.get(note.id)?.refinedText, "From A.");
    await b.phone.restart();
    assert.equal(b.phone.get(note.id)?.refinedText, "From A.");
    assert.equal(b.phone.get(added.id)?.refinedText, "New on B.");
    assert.equal(
      b.phone.history.filter((turn) => turn.conflictOf).length,
      0,
      "no conflict: B never changed the note",
    );
  });

  it("does not show a note written while the notes were wiped", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    b.phone.kv.gate = async (op) => {
      if (op === "multiSet") await held;
    };
    const run = b.engine.sync();
    await settle();
    const wipe = b.phone.wipe();
    release();
    b.phone.kv.gate = async () => undefined;
    const report = await run;
    await wipe;
    assert.equal(report.deferred, true);
    assert.equal(b.phone.get(note.id), undefined);
    await b.phone.restart();
    assert.equal(b.phone.history.length, 0, "the wipe ran after the write");
  });

  it("writes nothing while history is off", async () => {
    const v = await vault();
    const a = await v.device();
    const b = await v.device();
    await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    b.phone.writable = false;
    await assert.rejects(b.engine.sync(), NotesChangedError);
    assert.equal(b.phone.kv.data.size, 0);
    assert.equal(b.phone.history.length, 0);
  });

  it("lists nothing to upload while history is off", async () => {
    const v = await vault();
    const a = await v.device();
    await a.phone.add(makeTurn(), a.stamp);
    a.phone.writable = false;
    const report = await a.engine.sync();
    assert.equal(report.pushed, 0);
  });
});

describe("placing notes", () => {
  it("replaces a note where it is and puts a new one by date", () => {
    const newest = makeTurn({ createdAt: "2026-11-20T10:00:00.000Z" });
    const oldest = makeTurn({ createdAt: "2026-11-18T10:00:00.000Z" });
    const middle = makeTurn({ createdAt: "2026-11-19T10:00:00.000Z" });
    const ancient = makeTurn({ createdAt: "2020-01-01T00:00:00.000Z" });
    const edited = { ...oldest, refinedText: "Edited." };
    const placed = placeNotes([newest, oldest], [middle, edited, ancient]);
    assert.deepEqual(placed, [newest, middle, edited, ancient]);
    assert.deepEqual(placeNotes(placed, [], [middle.id, "missing"]), [
      newest,
      edited,
      ancient,
    ]);
  });

  it("stamps only with a sync clock", () => {
    const turn = makeTurn();
    assert.equal(stampTurn(turn, null), turn);
    const stamped = stampTurn(turn, () => ({ t: 5, c: 0, d: "x" }));
    assert.deepEqual(stamped.hlc, { t: 5, c: 0, d: "x" });
    assert.equal(stamped.rawText, turn.rawText);
  });

  it("follows the latest capture when it changes or goes", async () => {
    const phone = new TestPhone(() => NOW);
    await phone.load();
    const note = await phone.add(makeTurn(), null);
    // A remote version of the latest capture replaces it on Capture too.
    const remote = { ...note, refinedText: "Remote." };
    assert.equal(phone.latest, note);
    const store = phone.notes;
    assert.equal(
      await store.applyRemote({
        id: note.id,
        note: {
          createdAt: remote.createdAt,
          rawText: remote.rawText,
          refinedText: remote.refinedText,
          language: remote.language,
          mode: remote.mode,
          durationMs: remote.durationMs,
          source: remote.source,
          privacyMode: false,
          origin: "mobile",
        },
        hlc: { t: NOW, c: 0, d: "other" },
        expected: { exists: true, hlc: undefined },
      }),
      true,
    );
    assert.equal(phone.latest?.refinedText, "Remote.");
    assert.equal(
      await store.applyRemote({
        id: note.id,
        note: null,
        hlc: { t: NOW + 1, c: 0, d: "other" },
        expected: { exists: true, hlc: { t: NOW, c: 0, d: "other" } },
      }),
      true,
    );
    assert.equal(phone.latest, undefined);
    assert.equal(phone.history.length, 0);
  });

  it("refuses a remote change when the note no longer matches", async () => {
    const phone = new TestPhone(() => NOW);
    await phone.load();
    const note = await phone.add(makeTurn(), () => ({ t: 1, c: 0, d: "here" }));
    assert.equal(
      await phone.notes.applyRemote({
        id: note.id,
        note: null,
        hlc: { t: NOW, c: 0, d: "other" },
        expected: { exists: true, hlc: { t: 9, c: 0, d: "here" } },
      }),
      false,
    );
    assert.ok(phone.get(note.id));
  });
});
