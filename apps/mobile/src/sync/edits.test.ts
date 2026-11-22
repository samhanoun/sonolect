import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareHlc } from "@sonolect/sync-core";

import { applyRetention } from "../retention";
import {
  APP_KEY_PREFIX,
  SYNC_COMPANION_PREFIX,
  SYNC_STATE_PREFIX,
} from "../storageCore";
import {
  type Tombstone,
  addNote,
  changeNote,
  deleteNotes,
  unreadNoteDeletes,
} from "./edits";
import { SYNC_KEY_MARKER } from "./keyStore";
import { createTestVault, makeTurn } from "./testSupport";

/**
 * The store's note changes as sync sees them (store.ts addTurn,
 * replaceTurn, deleteTurn, clearHistory and enforceRetention go through
 * edits.ts the same way TestPhone does).
 */

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("the store's note changes: stamping", () => {
  it("stamps a new note, and leaves it as it is without sync", async () => {
    const a = await createTestVault(NOW).device();
    const other = makeTurn();
    const captured = makeTurn();
    const added = addNote([other], captured, a.stamp);
    assert.ok(added.turn.hlc, "a new note carries an HLC");
    assert.equal(added.turn.hlc.d, a.engine.deviceId);
    assert.deepEqual(added.history, [added.turn, other]);
    const { hlc: _stamp, ...unchanged } = added.turn;
    assert.deepEqual(unchanged, captured, "only the HLC is added");

    const plain = addNote([other], captured, null);
    assert.equal(plain.turn, captured, "no sync: the note is not touched");
    assert.equal(plain.turn.hlc, undefined);
  });

  it("stamps an edit, a refine and a pin later than the note's own HLC", async () => {
    const a = await createTestVault(NOW).device();
    // Written by a device whose clock is an hour ahead.
    const ahead = { t: NOW + 3_600_000, c: 4, d: "deviceAhead" };
    const note = makeTurn({ hlc: ahead });
    const other = makeTurn();
    const history = [note, other];

    const refined = changeNote(
      history,
      { ...note, mode: "summarize", refinedText: "Refined." },
      a.stamp,
    );
    assert.ok(refined.turn.hlc);
    assert.ok(compareHlc(refined.turn.hlc, ahead) > 0);
    assert.equal(refined.history[0], refined.turn);
    assert.equal(refined.history[1], other, "other notes stay as they are");

    const pinned = changeNote(
      refined.history,
      { ...refined.turn, pinned: true },
      a.stamp,
    );
    assert.ok(pinned.turn.hlc);
    assert.ok(compareHlc(pinned.turn.hlc, refined.turn.hlc) > 0);
    assert.equal(pinned.turn.pinned, true);

    const unsynced = changeNote(history, { ...note, pinned: true }, null);
    assert.deepEqual(unsynced.turn.hlc, ahead, "no sync: no new HLC");
  });

  it("sends an edit and a pin made here to the other phone", async () => {
    const v = createTestVault(NOW);
    const a = await v.device();
    const b = await v.device();
    const note = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    v.tick();
    await b.phone.edit(note.id, { refinedText: "Edited on B." }, b.stamp);
    await b.phone.edit(note.id, { pinned: true }, b.stamp);
    await b.engine.sync();
    await a.engine.sync();
    const there = a.phone.get(note.id);
    assert.equal(there?.refinedText, "Edited on B.");
    assert.equal(there?.pinned, true);
    assert.equal(
      a.phone.history.filter((turn) => turn.conflictOf).length,
      0,
      "a later edit wins without a conflict",
    );
  });
});

describe("the store's note changes: tombstones", () => {
  it("records a delete with the note's HLC, and none for this phone only", async () => {
    const a = await createTestVault(NOW).device();
    const first = addNote([], makeTurn(), a.stamp);
    const second = addNote(first.history, makeTurn(), a.stamp);
    const unstamped = makeTurn();
    const history = [...second.history, unstamped];

    const one = deleteNotes(history, [first.turn.id], "everywhere");
    assert.deepEqual(one.history, [second.turn, unstamped]);
    assert.deepEqual(one.tombstones, [
      { id: first.turn.id, hlc: first.turn.hlc },
    ]);

    const all = deleteNotes(history, "all", "everywhere");
    assert.deepEqual(all.history, []);
    assert.deepEqual(
      all.tombstones.map((tombstone) => tombstone.id),
      history.map((turn) => turn.id),
    );
    assert.equal(all.tombstones[2]?.hlc, undefined, "a note from before sync");

    const here = deleteNotes(history, "all", "here");
    assert.deepEqual(here.history, []);
    assert.deepEqual(here.tombstones, []);
  });

  it("deletes a note on the other phone when it is deleted here", async () => {
    const v = createTestVault(NOW);
    const a = await v.device();
    const b = await v.device();
    const gone = await a.phone.add(makeTurn(), a.stamp);
    const kept = await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.history.length, 2);

    await a.phone.delete([gone.id], "everywhere", (tombstones) =>
      a.engine.recordDeletes(tombstones),
    );
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.get(gone.id), undefined);
    assert.ok(b.phone.get(kept.id));
    assert.deepEqual(b.phone.removedShown, [gone.id]);
    await b.phone.restart();
    assert.equal(b.phone.get(gone.id), undefined, "deleted from storage too");
  });

  it("clears every note on the other phone with Clear history", async () => {
    const v = createTestVault(NOW);
    const a = await v.device();
    const b = await v.device();
    await a.phone.add(makeTurn(), a.stamp);
    await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.history.length, 2);

    await a.phone.delete("all", "everywhere", (tombstones) =>
      a.engine.recordDeletes(tombstones),
    );
    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(b.phone.history, []);
    assert.equal(b.phone.latest, undefined);
  });

  it("deletes the notes it could not read too, only for every device", () => {
    const shown = makeTurn();
    assert.deepEqual(
      unreadNoteDeletes(
        [shown.id, "turn_unread", "turn_unread"],
        [shown],
        "everywhere",
      ),
      [{ id: "turn_unread" }],
    );
    assert.deepEqual(
      unreadNoteDeletes([shown.id, "turn_unread"], [shown], "here"),
      [],
    );
  });

  it("clears on the other phone the notes Clear history removed unread", async () => {
    const v = createTestVault(NOW);
    const a = await v.device();
    const b = await v.device();
    await a.phone.add(makeTurn(), a.stamp);
    await a.phone.add(makeTurn(), a.stamp);
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.history.length, 2);

    // A launch that can't read the notes: the library is empty and the
    // notes stay stored.
    a.phone.kv.fail = (op) => op === "multiGet";
    await a.phone.restart();
    a.phone.writable = false;
    assert.deepEqual(a.phone.history, []);
    a.phone.kv.fail = () => false;

    await a.phone.clearHistory("everywhere", (tombstones) =>
      a.engine.recordDeletes(tombstones),
    );
    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(b.phone.history, [], "deleted on the other phone too");
    assert.deepEqual(a.phone.history, []);
  });

  it("keeps the notes on the other phone when retention or the recovery screen removes them here", async () => {
    const v = createTestVault(NOW);
    const a = await v.device({ retentionDays: 7 });
    const b = await v.device();
    const old = await a.phone.add(
      makeTurn({ createdAt: new Date(NOW - 10 * DAY_MS).toISOString() }),
      a.stamp,
    );
    const recent = await a.phone.add(
      makeTurn({ createdAt: new Date(NOW - DAY_MS).toISOString() }),
      a.stamp,
    );
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.phone.history.length, 2);

    // Retention (store.ts enforceRetention): removed here, nothing recorded.
    const { expired } = applyRetention(a.phone.history, 7, NOW);
    assert.deepEqual(
      expired.map((turn) => turn.id),
      [old.id],
    );
    for (const turn of expired) await a.phone.remove(turn.id);
    // The recovery screen's clear: this phone only.
    const recorded: Tombstone[][] = [];
    await a.phone.delete("all", "here", async (tombstones) => {
      recorded.push(tombstones);
    });
    assert.deepEqual(recorded, [], "no tombstone for this phone only");

    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(
      b.phone.history.map((turn) => turn.id).sort(),
      [old.id, recent.id].sort(),
      "the other phone keeps both",
    );
    assert.deepEqual(
      v.server.records(a.engine.vaultId).map((record) => record.deleted),
      [false, false],
      "no tombstone on the server",
    );
    assert.deepEqual(a.phone.history, [], "nothing comes back here");
  });
});

describe("the store's note changes: erase all", () => {
  it("keeps every sync value under the prefix Erase all removes", () => {
    for (const key of [
      `${SYNC_STATE_PREFIX}meta`,
      `${SYNC_COMPANION_PREFIX}turn_1763600000000_t00001`,
      SYNC_KEY_MARKER,
    ])
      assert.ok(key.startsWith(APP_KEY_PREFIX), key);
  });
});
