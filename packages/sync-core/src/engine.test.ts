import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { base64urlDecode } from "./encoding";
import {
  openSyncEngine,
  pendingDeletesOf,
  type SyncEngine,
  withSyncedVersions,
} from "./engine";
import { SyncClosedError, SyncError } from "./errors";
import { deriveVaultKeys, generateRootKey, recordId } from "./keys";
import { conflictCopyId, isPastRetention, type SyncNote } from "./payload";
import {
  createKeyValueStateStore,
  createMemoryStateStore,
  type SyncStateStore,
} from "./state";
import type { SyncTransport } from "./transport";
import {
  type MemoryNoteStore,
  type MemoryVaultServerOptions,
  createMemoryNoteStore,
  createMemoryVaultServer,
} from "./testing";
import { SYNC_ERROR_CODES, SYNC_LIMITS } from "./wire";
import { DAY, manualClock, note, randomBytes } from "./test-helpers";

function setup(
  serverOptions: MemoryVaultServerOptions["limits"] = {},
  rate: Pick<MemoryVaultServerOptions, "vaultRequestsPerMinute"> = {},
) {
  const clock = manualClock();
  const server = createMemoryVaultServer({
    ...rate,
    now: clock.now,
    limits: serverOptions,
  });
  const keys = deriveVaultKeys(generateRootKey(randomBytes));
  const device = async (
    options: {
      notes?: MemoryNoteStore;
      state?: SyncStateStore;
      isExpired?: (note: SyncNote) => boolean;
      transport?: SyncTransport;
    } = {},
  ) => {
    const notes = options.notes ?? createMemoryNoteStore();
    const state = options.state ?? createMemoryStateStore();
    const engine = await openSyncEngine({
      keys,
      transport: options.transport ?? server.transport(keys),
      notes,
      state,
      randomBytes,
      now: clock.now,
      ...(options.isExpired ? { isExpired: options.isExpired } : {}),
    });
    return {
      notes,
      state,
      engine,
      /** A local edit, stamped as an app must. */
      edit(id: string, text: string, extra: Partial<SyncNote> = {}) {
        const previous = notes.get(id);
        notes.put(
          id,
          { ...(previous?.note ?? note(text)), rawText: text, ...extra },
          engine.stamp(previous?.hlc),
        );
      },
      /** A user delete. */
      async remove(id: string) {
        const hlc = notes.get(id)?.hlc;
        notes.remove(id);
        await engine.recordDeletes([{ id, hlc }]);
      },
      text: (id: string) => notes.get(id)?.note.rawText,
      ids: () => [...notes.notes.keys()].sort(),
    };
  };
  return { clock, server, keys, device };
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe("sync engine", () => {
  it("creates the vault on the first run and syncs two devices both ways", async () => {
    const { server, keys, device, clock } = setup();
    const a = await device();
    a.edit("note-a", "first note");
    const first = await a.engine.sync();
    assert.equal(first.vaultCreated, true);
    assert.equal(first.pushed, 1);

    const b = await device();
    clock.advance(1000);
    b.edit("note-b", "from the phone");
    const joined = await b.engine.sync();
    assert.equal(joined.vaultCreated, false);
    assert.equal(joined.pulled, 1);
    assert.equal(joined.pushed, 1);
    await a.engine.sync();
    assert.deepEqual(a.ids(), ["note-a", "note-b"]);
    assert.deepEqual(b.ids(), ["note-a", "note-b"]);
    assert.equal(a.text("note-b"), "from the phone");

    // The server holds ciphertext under HMAC ids only.
    const records = server.records(keys.vaultId);
    assert.equal(records.length, 2);
    assert.deepEqual(
      sorted(records.map((r) => r.rid)),
      sorted([recordId(keys, "note-a"), recordId(keys, "note-b")]),
    );
    for (const record of records) {
      const bytes = new TextDecoder("latin1").decode(
        base64urlDecode(record.ct),
      );
      assert.ok(!bytes.includes("note") && !bytes.includes("phone"));
    }
    assert.ok(server.log.every((entry) => !entry.path.includes("note-")));
  });

  it("propagates edits and deletes", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "v1");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    a.edit("n1", "v2");
    await a.engine.sync();
    const report = await b.engine.sync();
    assert.equal(report.pulled, 1);
    assert.equal(b.text("n1"), "v2");

    clock.advance(1000);
    await b.remove("n1");
    assert.equal(b.engine.status().pendingDeletes, 1);
    await b.engine.sync();
    assert.equal(b.engine.status().pendingDeletes, 0);
    await a.engine.sync();
    assert.equal(a.notes.get("n1"), undefined);
    // Nothing more to do on either side.
    const quiet = await a.engine.sync();
    assert.equal(quiet.pulled + quiet.pushed, 0);
  });

  it("keeps both texts when two devices edit the same note (symmetric conflict copies)", async () => {
    for (const firstToSync of ["early", "late"] as const) {
      const { device, clock } = setup();
      const a = await device();
      const b = await device();
      a.edit("n1", "base");
      await a.engine.sync();
      await b.engine.sync();
      clock.advance(1000);
      a.edit("n1", "edit on A");
      const loserHlc = a.notes.get("n1")!.hlc!;
      clock.advance(1000);
      b.edit("n1", "edit on B (later)");
      const [first, second] = firstToSync === "early" ? [a, b] : [b, a];
      await first.engine.sync();
      const report = await second.engine.sync();
      assert.deepEqual(report.conflictCopies, [conflictCopyId("n1", loserHlc)]);
      await first.engine.sync();
      for (const side of [a, b]) {
        assert.equal(side.text("n1"), "edit on B (later)", firstToSync);
        const copy = side.notes.get(conflictCopyId("n1", loserHlc));
        assert.equal(copy?.note.rawText, "edit on A");
        assert.equal(copy?.note.conflictOf, "n1");
        assert.equal(side.ids().length, 2);
      }
    }
  });

  it("makes no copy when the losing side only changed metadata", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "base");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    a.edit("n1", "base", { pinned: true });
    clock.advance(1000);
    b.edit("n1", "new text");
    await a.engine.sync();
    const report = await b.engine.sync();
    assert.deepEqual(report.conflictCopies, []);
    await a.engine.sync();
    assert.equal(a.text("n1"), "new text");
    assert.deepEqual(a.ids(), ["n1"]);
  });

  it("brings a note back when an edit is newer than its delete", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "base");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    await a.remove("n1");
    clock.advance(1000);
    b.edit("n1", "still needed");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    assert.equal(a.text("n1"), "still needed");
    assert.equal(b.text("n1"), "still needed");
  });

  it("deletes when the delete is newer, and keeps the edit it overrides as a copy", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "base");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    b.edit("n1", "edit nobody saw");
    const editHlc = b.notes.get("n1")!.hlc!;
    clock.advance(1000);
    await a.remove("n1");
    await b.engine.sync();
    const report = await a.engine.sync();
    assert.deepEqual(report.conflictCopies, [conflictCopyId("n1", editHlc)]);
    await b.engine.sync();
    for (const side of [a, b]) {
      assert.equal(side.notes.get("n1"), undefined);
      assert.equal(side.text(conflictCopyId("n1", editHlc)), "edit nobody saw");
    }
  });

  it("refuses a server rolling a note back to an older version", async () => {
    const { device, server, keys, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "v1");
    await a.engine.sync();
    const oldRecord = server.records(keys.vaultId)[0]!;
    clock.advance(1000);
    a.edit("n1", "v2");
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.text("n1"), "v2");

    // The server replays the old ciphertext as a new revision.
    const current = server.records(keys.vaultId)[0]!;
    const replay = await server.request({
      method: "POST",
      path: `/v1/vaults/${keys.vaultId}/records`,
      headers: {
        authorization: `Bearer ${keys.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        writes: [
          {
            rid: oldRecord.rid,
            baseRev: current.rev,
            deleted: false,
            ct: oldRecord.ct,
          },
        ],
      }),
    });
    assert.equal(replay.status, 200);
    const report = await b.engine.sync();
    assert.equal(report.refused, 1);
    assert.equal(b.text("n1"), "v2");
    // B uploaded its version again over the replay.
    assert.equal(report.pushed, 1);
    await a.engine.sync();
    assert.equal(a.text("n1"), "v2");
  });

  it("resyncs from scratch when the server was restored from a backup", async () => {
    for (const firstAfterRestore of ["writer", "reader"] as const) {
      const { device, server, clock } = setup();
      const a = await device();
      const b = await device();
      a.edit("n1", "v1");
      await a.engine.sync();
      const backup = server.snapshot();
      clock.advance(1000);
      a.edit("n1", "v2");
      a.edit("n2", "after the backup");
      await a.engine.sync();
      await b.engine.sync();
      server.restore(backup);
      // Whichever device syncs first sees a server behind it, refuses the
      // old version of n1 and uploads what the server lost.
      const [first, second] = firstAfterRestore === "writer" ? [a, b] : [b, a];
      const report = await first.engine.sync();
      assert.equal(report.full, "reset", firstAfterRestore);
      assert.equal(report.refused, 1, firstAfterRestore);
      await second.engine.sync();
      for (const side of [a, b]) {
        assert.equal(side.text("n1"), "v2");
        assert.equal(side.text("n2"), "after the backup");
      }
      // The restored server has everything again.
      const fresh = await device();
      await fresh.engine.sync();
      assert.deepEqual(fresh.ids(), ["n1", "n2"]);
      assert.equal(fresh.text("n1"), "v2");
    }
  });

  it("is not fooled by revision numbers that repeat after a restore", async () => {
    const { device, server, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "v1");
    await a.engine.sync();
    await b.engine.sync();
    const backup = server.snapshot();
    clock.advance(1000);
    a.edit("n1", "v2 from A");
    await a.engine.sync(); // n1 rev 2 on the server
    server.restore(backup); // back to n1 rev 1
    clock.advance(1000);
    b.edit("n1", "v3 from B");
    await b.engine.sync(); // B writes rev 2 again, with other content
    const report = await a.engine.sync();
    assert.equal(a.text("n1"), "v3 from B");
    assert.equal(report.pulled, 1);
    // A's v2 lost to B's later edit, and B never saw it: kept as a copy.
    assert.equal(report.conflictCopies.length, 1);
    assert.equal(a.text(report.conflictCopies[0]!), "v2 from A");
    await b.engine.sync();
    assert.deepEqual(a.ids(), b.ids());
    assert.equal(b.text(report.conflictCopies[0]!), "v2 from A");
  });

  it("pages through the vault by count and by bytes", async () => {
    for (const limits of [{ maxPageRecords: 3 }, { maxPageBytes: 400 }]) {
      const { device, server } = setup(limits);
      const a = await device();
      for (let i = 0; i < 10; i += 1) a.edit(`n${i}`, `note ${i}`);
      await a.engine.sync();
      const before = server.log.length;
      const b = await device();
      const report = await b.engine.sync();
      assert.equal(report.pulled, 10);
      const pages = server.log
        .slice(before)
        .filter((entry) => entry.path.endsWith("/changes"));
      assert.ok(pages.length >= 4, JSON.stringify(limits));
      assert.equal(b.ids().length, 10);
    }
  });

  it("uploads in batches the server accepts", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    for (let i = 0; i < SYNC_LIMITS.maxBatchWrites + 30; i += 1)
      a.edit(`n${i}`, `note ${i}`);
    const report = await a.engine.sync();
    assert.equal(report.pushed, SYNC_LIMITS.maxBatchWrites + 30);
    assert.equal(
      server.log.filter((entry) => entry.path.endsWith("/records")).length,
      2,
    );
    assert.equal(
      server.records(keys.vaultId).length,
      SYNC_LIMITS.maxBatchWrites + 30,
    );
  });

  it("after 60 days away resyncs, and drops notes deleted and purged meanwhile", async () => {
    const { device, server, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("gone", "deleted while B was away");
    a.edit("kept", "still here");
    a.edit("mine", "B edits this offline");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(DAY);
    await a.remove("gone");
    await a.remove("mine");
    await a.engine.sync();
    clock.advance(5 * DAY);
    b.edit("mine", "edited on B after the delete");
    clock.advance(100 * DAY);
    server.purgeTombstones();
    const report = await b.engine.sync();
    assert.equal(report.full, "stale");
    assert.deepEqual(b.ids(), ["kept", "mine"]);
    assert.equal(b.text("mine"), "edited on B after the delete");
    await a.engine.sync();
    assert.deepEqual(a.ids(), ["kept", "mine"]);
  });

  it("deletes nothing on a 410 cursor_expired that an honest server could not send", async () => {
    // The server purged a tombstone after a second, well before the 90 days
    // the protocol keeps them: B synced moments earlier, so it cannot have
    // missed a purged tombstone, and it keeps n1 and uploads it again.
    const { device, server, clock, keys } = setup({ tombstoneTtlMs: 1000 });
    const a = await device();
    const b = await device();
    a.edit("n1", "one");
    a.edit("n2", "two");
    await a.engine.sync();
    await b.engine.sync();
    await a.remove("n1");
    await a.engine.sync();
    a.edit("n3", "three");
    await a.engine.sync();
    clock.advance(5000);
    server.purgeTombstones();
    const report = await b.engine.sync();
    assert.equal(report.full, "reset");
    assert.deepEqual(b.ids(), ["n1", "n2", "n3"]);
    assert.equal(b.engine.status().fullResyncPending, null);
    // A's delete is newer than the copy B uploaded again: it wins, and both
    // devices end up without n1.
    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(a.ids(), ["n2", "n3"]);
    assert.deepEqual(b.ids(), ["n2", "n3"]);
    assert.equal(
      server.records(keys.vaultId).filter((record) => !record.deleted).length,
      2,
    );
  });

  it("is not made to delete notes by a server that answers cursor_expired and leaves records out", async () => {
    const { device, server, keys, clock } = setup();
    const a = await device();
    for (const [id, text] of [
      ["groceries", "milk"],
      ["todo", "call back"],
      ["diary-2026", "private"],
    ] as const)
      a.edit(id, text);
    await a.engine.sync();
    await a.engine.sync();
    clock.advance(2 * 60_000);
    // A dishonest server (or a proxy the device trusts): 410 cursor_expired
    // once, then a listing without one record that it still holds.
    const honest = server.transport(keys);
    const hidden = recordId(keys, "diary-2026");
    let lied = false;
    const lying: SyncTransport = {
      ...honest,
      async changes(since, limit) {
        if (since > 0 && !lied) {
          lied = true;
          throw new SyncError("gone", "cursor expired", {
            status: 410,
            code: SYNC_ERROR_CODES.cursorExpired,
          });
        }
        const page = await honest.changes(since, limit);
        return {
          ...page,
          records: page.records.filter((record) => record.rid !== hidden),
        };
      },
    };
    await a.engine.close();
    const victim = await device({
      notes: a.notes,
      state: a.state,
      transport: lying,
    });
    const report = await victim.engine.sync();
    assert.equal(lied, true);
    assert.equal(report.pulled, 0);
    assert.deepEqual(victim.ids(), ["diary-2026", "groceries", "todo"]);
    assert.equal(victim.text("diary-2026"), "private");
    assert.ok(server.records(keys.vaultId).some((r) => r.rid === hidden));
  });

  it("does not upload tombstones again that the service purged on schedule", async () => {
    const { device, server, clock, keys } = setup();
    const a = await device();
    const b = await device();
    for (let i = 0; i < 5; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    await b.engine.sync();
    for (let i = 0; i < 5; i += 1) await a.remove(`n${i}`);
    await a.engine.sync();
    await b.engine.sync();
    assert.deepEqual(b.ids(), []);
    // Both devices sync every month while the tombstones age.
    for (let month = 0; month < 3; month += 1) {
      clock.advance(30 * DAY);
      await a.engine.sync();
      await b.engine.sync();
    }
    clock.advance(2 * DAY);
    server.purgeTombstones();
    assert.equal(server.records(keys.vaultId).length, 0);
    const requested = await b.engine.sync({ full: true });
    assert.equal(requested.full, "requested");
    assert.equal(requested.pushed, 0);
    assert.equal(server.records(keys.vaultId).length, 0);
    // A server that lost its data still gets every record again, tombstones
    // included, so no device brings a deleted note back.
    a.edit("live", "still here");
    await a.engine.sync();
    server.wipe();
    const reset = await a.engine.sync();
    assert.equal(reset.full, "reset");
    const records = server.records(keys.vaultId);
    assert.equal(records.length, 6);
    assert.equal(records.filter((record) => record.deleted).length, 5);
  });

  it("creates the vault again when the server lost it (401), and uploads everything", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "one");
    await a.engine.sync();
    b.edit("n2", "two");
    await b.engine.sync();
    server.wipe();
    const report = await a.engine.sync();
    assert.equal(report.vaultCreated, true);
    assert.equal(report.full, "reset");
    const report2 = await b.engine.sync();
    assert.equal(report2.full, "reset");
    await a.engine.sync();
    assert.equal(server.records(keys.vaultId).length, 2);
    assert.deepEqual(a.ids(), ["n1", "n2"]);
    assert.deepEqual(b.ids(), ["n1", "n2"]);
  });

  it("deletes the server copy; other devices learn the sync was deleted and keep their notes", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "one");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.deleteVault();
    assert.equal(await a.state.load(), null);
    await assert.rejects(a.engine.sync(), SyncClosedError);
    assert.equal(server.records(keys.vaultId).length, 0);
    await assert.rejects(b.engine.sync(), (error: unknown) => {
      assert.ok(error instanceof SyncError);
      assert.equal(error.kind, "gone");
      assert.equal(error.code, "vault_deleted");
      assert.equal(error.vaultGone, true);
      return true;
    });
    assert.equal(b.text("n1"), "one");
    await b.engine.forget();
    assert.equal(await b.state.load(), null);
    assert.equal(b.text("n1"), "one");
    // Joining a deleted vault fails the same way.
    const c = await device();
    await assert.rejects(
      c.engine.sync(),
      (error: unknown) =>
        error instanceof SyncError && error.code === "vault_deleted",
    );
  });

  it("rejects another key for an existing vault id (409)", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    await a.engine.sync();
    const impostor = {
      ...deriveVaultKeys(generateRootKey(randomBytes)),
      vaultId: keys.vaultId,
    };
    const engine = await openSyncEngine({
      keys: impostor,
      transport: server.transport(impostor),
      notes: createMemoryNoteStore(),
      state: createMemoryStateStore(),
      randomBytes,
    });
    await assert.rejects(
      engine.sync(),
      (error: unknown) =>
        error instanceof SyncError &&
        error.kind === "unauthorized" &&
        error.vaultGone,
    );
  });

  it("merges local notes into the vault it joins, including notes from before sync", async () => {
    const { device, clock } = setup();
    const a = await device();
    a.edit("a1", "from A");
    await a.engine.sync();
    clock.advance(1000);
    const notes = createMemoryNoteStore();
    notes.put(
      "old-1",
      note("written before sync existed", {
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    notes.put(
      "old-2",
      note("another", {
        createdAt: "2025-02-01T00:00:00.000Z",
        updatedAt: "2025-03-01T00:00:00.000Z",
      }),
    );
    const b = await device({ notes });
    const report = await b.engine.sync();
    assert.equal(report.pushed, 2);
    assert.equal(report.pulled, 1);
    await a.engine.sync();
    assert.deepEqual(a.ids(), ["a1", "old-1", "old-2"]);
    // A note without an HLC gets one from its timestamps, so a later edit elsewhere wins.
    clock.advance(1000);
    a.edit("old-2", "edited on A");
    await a.engine.sync();
    await b.engine.sync();
    assert.equal(b.text("old-2"), "edited on A");
  });

  it("does not import notes past local retention, and retention never deletes remotely", async () => {
    const { device, clock } = setup();
    const a = await device();
    const retained = (n: SyncNote) => isPastRetention(n, 30, clock.now());
    const b = await device({ isExpired: retained });
    a.edit("old", "from last year", {
      createdAt: new Date(clock.now() - 365 * DAY).toISOString(),
    });
    a.edit("new", "from today", {
      createdAt: new Date(clock.now()).toISOString(),
    });
    await a.engine.sync();
    const report = await b.engine.sync();
    assert.equal(report.skippedExpired, 1);
    assert.deepEqual(b.ids(), ["new"]);
    // Retention removes a note locally: nothing is deleted elsewhere.
    b.notes.remove("new");
    const quiet = await b.engine.sync();
    assert.equal(quiet.pushed, 0);
    await a.engine.sync();
    assert.deepEqual(a.ids(), ["new", "old"]);
  });

  it("reports notes it cannot upload and keeps going", async () => {
    const { device, server, keys } = setup({ maxVaultRecords: 3 });
    const a = await device();
    a.edit("ok", "fine");
    a.notes.put(
      "bad",
      { ...note("x"), createdAt: "not a date" },
      a.engine.stamp(),
    );
    a.notes.put("bad id!", note("x"), a.engine.stamp());
    // 1.5 MB of text that compresses to about 1 MB: over the 768 KiB record cap.
    let seed = 7;
    const noise = Array.from({ length: 250_000 }, () => {
      seed = (seed * 48271) % 2147483647;
      return seed.toString(36);
    }).join("");
    a.edit("huge", noise);
    const report = await a.engine.sync();
    assert.deepEqual(report.invalid, ["bad"]);
    assert.deepEqual(report.skippedIds, ["bad id!"]);
    assert.deepEqual(report.tooLarge, ["huge"]);
    assert.equal(report.pushed, 1);
    // Too large stays skipped until the note changes.
    const again = await a.engine.sync();
    assert.deepEqual(again.tooLarge, ["huge"]);
    assert.equal(again.pushed, 0);
    a.edit("huge", "short now");
    a.edit("more-1", "1");
    a.edit("more-2", "2");
    const third = await a.engine.sync();
    assert.equal(third.quotaExceeded, true);
    assert.equal(server.records(keys.vaultId).length, 3);
  });

  it("uploads new notes once notes are deleted from a vault full of notes", async () => {
    const { device, server, keys } = setup({ maxVaultRecords: 3 });
    const a = await device();
    for (const id of ["n1", "n2", "n3"]) a.edit(id, id);
    assert.equal((await a.engine.sync()).pushed, 3);
    a.edit("n4", "one too many");
    assert.equal((await a.engine.sync()).quotaExceeded, true);
    // "Sync storage is full. Delete notes to sync new ones."
    await a.remove("n1");
    await a.remove("n2");
    const report = await a.engine.sync();
    assert.equal(report.quotaExceeded, false);
    assert.equal(report.pushed, 3);
    const b = await device();
    await b.engine.sync();
    assert.deepEqual(b.ids(), ["n3", "n4"]);
    assert.equal(
      server.records(keys.vaultId).filter((record) => !record.deleted).length,
      2,
    );
  });

  it("defers when a note changes while a remote version is being written", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "v1");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    a.edit("n1", "v2 from A");
    await a.engine.sync();
    clock.advance(1000);
    let once = true;
    b.notes.beforeApply = () => {
      if (!once) return;
      once = false;
      b.edit("n1", "typed on B at that moment");
    };
    const report = await b.engine.sync();
    assert.equal(report.deferred, true);
    assert.equal(b.text("n1"), "typed on B at that moment");
    const next = await b.engine.sync();
    assert.equal(next.deferred, false);
    await a.engine.sync();
    // B's edit is the latest; A's v2 survives as a copy.
    assert.equal(a.text("n1"), "typed on B at that moment");
    assert.ok(a.ids().some((id) => a.text(id) === "v2 from A"));
    assert.deepEqual(a.ids(), b.ids());
  });

  it("recovers from lost answers without duplicates or resurrections", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "one");
    await a.engine.sync();
    // The upload reaches the server, but its answer is lost.
    a.edit("n2", "two");
    const realRequest = server.request;
    let drop = true;
    const lossy = await openSyncEngine({
      keys,
      transport: (await import("./transport")).createHttpTransport({
        request: async (request) => {
          const response = await realRequest(request);
          if (
            drop &&
            request.method === "POST" &&
            request.path.endsWith("/records")
          ) {
            drop = false;
            throw new Error("connection reset");
          }
          return response;
        },
        vault: keys,
      }),
      notes: a.notes,
      state: a.state,
      randomBytes,
    });
    await assert.rejects(
      lossy.sync(),
      (error: unknown) =>
        error instanceof SyncError && error.kind === "network",
    );
    // Deleted before the next run: the delete must still reach the server.
    const hlc = a.notes.get("n2")!.hlc;
    a.notes.remove("n2");
    await lossy.recordDeletes([{ id: "n2", hlc }]);
    const report = await lossy.sync();
    assert.deepEqual(report.conflictCopies, []);
    await b.engine.sync();
    assert.deepEqual(b.ids(), ["n1"]);
    assert.equal(server.records(keys.vaultId).length, 2);
  });

  it("runs one sync at a time and merges calls made meanwhile", async () => {
    const { device, server } = setup();
    const a = await device();
    a.edit("n1", "one");
    const runs = await Promise.all([
      a.engine.sync(),
      a.engine.sync(),
      a.engine.sync(),
      a.engine.sync(),
    ]);
    assert.equal(runs[0]!.pushed, 1);
    assert.equal(runs[1], runs[2]);
    const pulls = server.log.filter((entry) =>
      entry.path.endsWith("/changes"),
    ).length;
    assert.equal(pulls, 2);
  });

  it("keeps its state across restarts and discards state of another vault", async () => {
    const { device } = setup();
    const state = createMemoryStateStore();
    const a = await device({ state });
    a.edit("n1", "one");
    await a.engine.sync();
    const deviceId = a.engine.deviceId;
    await a.engine.close();
    const reopened = await device({ state, notes: a.notes });
    assert.equal(reopened.engine.deviceId, deviceId);
    const quiet = await reopened.engine.sync();
    assert.equal(quiet.pulled + quiet.pushed, 0);

    const other = setup();
    const elsewhere = await other.device({ state, notes: a.notes });
    assert.notEqual(elsewhere.engine.deviceId, deviceId);
    const merged = await elsewhere.engine.sync();
    assert.equal(merged.vaultCreated, true);
    assert.equal(merged.pushed, 1);
  });

  it("resumes a full resync the app asked for, and retries transient failures", async () => {
    const { device, server } = setup();
    const a = await device();
    a.edit("n1", "one");
    await a.engine.sync();
    server.failNext(1, 503);
    await assert.rejects(
      a.engine.sync({ full: true }),
      (error: unknown) => error instanceof SyncError && error.retryable,
    );
    assert.equal(a.engine.status().fullResyncPending, "requested");
    const report = await a.engine.sync();
    assert.equal(report.full, "requested");
    assert.equal(a.engine.status().fullResyncPending, null);
    assert.ok(a.engine.status().lastFullSyncAt !== undefined);
  });

  it("finishes a full pass the rate limit cuts short, resuming each run, then uploads", async () => {
    // Two records a page and two requests a minute: the pass of five pages
    // never fits one window. An app syncs again after Retry-After, and may
    // restart in between.
    const { device, server, clock, keys } = setup(
      { maxPageRecords: 2 },
      { vaultRequestsPerMinute: 2 },
    );
    const a = await device();
    for (let i = 0; i < 12; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    clock.advance(60_000);
    const kv = new Map<string, string>();
    const state = createKeyValueStateStore({
      getItem: async (key) => kv.get(key) ?? null,
      setItem: async (key, value) => {
        kv.set(key, value);
      },
      removeItem: async (key) => {
        kv.delete(key);
      },
    });
    let b = await device({ state });
    /** Syncs as an app does: again after each 429, once Retry-After passed. */
    const syncThrough = async (
      side: () => SyncEngine,
      restart = async () => {},
    ) => {
      const runs: string[] = [];
      while (runs.length < 10) {
        try {
          const report = await side().sync();
          runs.push("done");
          return { report, runs };
        } catch (error) {
          assert.ok(error instanceof SyncError, String(error));
          assert.equal(error.kind, "rateLimited");
          runs.push("429");
          clock.advance(error.retryAfterMs!);
          await restart();
        }
      }
      return { report: undefined, runs };
    };
    // Its first pull (no full pass) saves its cursor after each page.
    assert.ok((await syncThrough(() => b.engine)).report);
    assert.equal(b.ids().length, 12);
    // A deletes two notes while B is away; their tombstones are purged.
    clock.advance(DAY);
    await a.remove("n3");
    await a.remove("n9");
    assert.ok((await syncThrough(() => a.engine)).report);
    b.edit("mine", "written on B while away");
    clock.advance(100 * DAY);
    server.purgeTombstones();

    const { report, runs } = await syncThrough(
      () => b.engine,
      async () => {
        assert.equal(b.engine.status().fullResyncPending, "stale");
        // The app quits and starts again: the pass resumes from its state.
        await b.engine.close();
        b = await device({ state, notes: b.notes });
      },
    );
    assert.deepEqual(runs, ["429", "429", "done"]);
    assert.equal(report?.full, "stale");
    // Only the notes deleted elsewhere are gone: none that an earlier run
    // of the pass listed.
    assert.deepEqual(
      b.ids(),
      sorted(["mine", ...[0, 1, 2, 4, 5, 6, 7, 8, 10, 11].map((i) => `n${i}`)]),
    );
    assert.equal(report?.pushed, 1);
    assert.ok(
      server
        .records(keys.vaultId)
        .some((record) => record.rid === recordId(keys, "mine")),
    );
    const status = b.engine.status();
    assert.equal(status.fullResyncPending, null);
    assert.ok(status.lastFullSyncAt !== undefined);
    // The marks the pass left on its records are gone with it.
    assert.ok(![...kv.values()].some((value) => value.includes(",1]")));
  });

  it("keeps a full pass's progress when a note changes while it runs", async () => {
    const { device, server, clock } = setup({ maxPageRecords: 2 });
    const a = await device();
    for (let i = 0; i < 6; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    const b = await device();
    await b.engine.sync();
    clock.advance(1000);
    for (let i = 0; i < 6; i += 1) a.edit(`n${i}`, `edited ${i}`);
    await a.engine.sync();
    // The user edits n4 just as the pass writes A's version of it.
    b.notes.beforeApply = (change) => {
      if (change.id !== "n4") return;
      b.notes.beforeApply = undefined;
      b.edit("n4", "edited on B meanwhile");
    };
    const first = await b.engine.sync({ full: true });
    assert.equal(first.deferred, true);
    assert.equal(b.engine.status().fullResyncPending, "requested");
    const before = server.log.length;
    const second = await b.engine.sync();
    assert.equal(second.full, "requested");
    assert.equal(b.engine.status().fullResyncPending, null);
    // It went on from n4's page, not from seq 0.
    const pulls = server.log
      .slice(before)
      .filter((entry) => entry.path.endsWith("/changes"));
    assert.equal(pulls.length, 1);
    assert.equal(b.text("n4"), "edited on B meanwhile");
    assert.equal(b.text("n5"), "edited 5");
  });

  it("starts a resumed full pass over when tombstones were purged since it began", async () => {
    const { device, server, clock, keys } = setup({ maxPageRecords: 2 });
    const a = await device();
    for (let i = 0; i < 6; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    const b = await device();
    await b.engine.sync();
    // The pass stops after its first page.
    let calls = 0;
    const honest = server.transport(keys);
    const flaky: SyncTransport = {
      ...honest,
      async changes(since, limit) {
        calls += 1;
        if (calls === 2) throw new SyncError("network", "offline");
        if (calls === 3) {
          assert.ok(since > 0);
          throw new SyncError("gone", "cursor expired", {
            status: 410,
            code: SYNC_ERROR_CODES.cursorExpired,
          });
        }
        return honest.changes(since, limit);
      },
    };
    await b.engine.close();
    const c = await device({
      notes: b.notes,
      state: b.state,
      transport: flaky,
    });
    await assert.rejects(c.engine.sync({ full: true }), SyncError);
    clock.advance(1000);
    const report = await c.engine.sync();
    // Started over from seq 0, for the same reason: nothing was uploaded
    // again as if the server had lost it.
    assert.equal(report.full, "requested");
    assert.equal(report.pushed, 0);
    assert.equal(c.engine.status().fullResyncPending, null);
    assert.deepEqual(c.ids(), a.ids());
  });

  it("starts a full pass over that stopped more than 90 days ago, and drops what was deleted meanwhile", async () => {
    const { device, server, clock, keys } = setup({ maxPageRecords: 2 });
    const a = await device();
    for (let i = 0; i < 6; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    const b = await device();
    await b.engine.sync();
    const honest = server.transport(keys);
    const asked: number[] = [];
    let calls = 0;
    const watched: SyncTransport = {
      ...honest,
      async changes(since, limit) {
        asked.push(since);
        calls += 1;
        if (calls === 3) throw new SyncError("network", "offline");
        return honest.changes(since, limit);
      },
    };
    await b.engine.close();
    const c = await device({
      notes: b.notes,
      state: b.state,
      transport: watched,
    });
    // The pass lists n0 to n3, then the device goes offline for months.
    await assert.rejects(c.engine.sync({ full: true }), SyncError);
    clock.advance(DAY);
    await a.remove("n1");
    await a.engine.sync();
    clock.advance(95 * DAY);
    server.purgeTombstones();
    asked.length = 0;
    const report = await c.engine.sync();
    assert.equal(asked[0], 0, "started over from seq 0");
    assert.equal(report.full, "requested");
    // n1 was listed before it was deleted: it goes, and is not uploaded again.
    assert.deepEqual(c.ids(), ["n0", "n2", "n3", "n4", "n5"]);
    assert.equal(report.pushed, 0);
    assert.ok(
      !server.records(keys.vaultId).some((r) => r.rid === recordId(keys, "n1")),
    );
  });

  it("reads every record again, not from where a stopped pass got, after an upgrade or a damaged state", async () => {
    for (const change of ["upgrade", "damaged"] as const) {
      const { device, server, keys } = setup({ maxPageRecords: 2 });
      const a = await device();
      for (let i = 0; i < 6; i += 1) a.edit(`n${i}`, `note ${i}`);
      await a.engine.sync();
      const b = await device();
      await b.engine.sync();
      const honest = server.transport(keys);
      const asked: number[] = [];
      let calls = 0;
      const watched: SyncTransport = {
        ...honest,
        async changes(since, limit) {
          asked.push(since);
          calls += 1;
          // The pass stops after its first page.
          if (calls === 2) throw new SyncError("network", "offline");
          return honest.changes(since, limit);
        },
      };
      await b.engine.close();
      const c = await device({
        notes: b.notes,
        state: b.state,
        transport: watched,
      });
      await assert.rejects(c.engine.sync({ full: true }), SyncError);
      assert.ok(asked[1]! > 0);
      await c.engine.close();
      // Opened again by a newer app that reads records the one that ran
      // the pass could not, or with part of the saved state lost.
      const state: SyncStateStore = {
        ...c.state,
        async load() {
          const saved = await c.state.load();
          if (!saved) return saved;
          if (change === "damaged") return { ...saved, damaged: true };
          return {
            ...saved,
            meta: { ...saved.meta, reader: 0, unreadable: 2 },
          };
        },
      };
      const d = await device({ notes: c.notes, state, transport: watched });
      asked.length = 0;
      const report = await d.engine.sync();
      assert.equal(asked[0], 0, `${change}: started over from seq 0`);
      assert.equal(report.full, "requested");
      assert.equal(report.pushed, 0);
      assert.equal(d.engine.status().fullResyncPending, null);
      assert.deepEqual(d.ids(), a.ids());
    }
  });

  it("joins and resyncs a vault of many pages after deletes were purged", async () => {
    const { device, server, clock } = setup({ maxPageRecords: 2 });
    const a = await device();
    for (let i = 0; i < 8; i += 1) a.edit(`n${i}`, `note ${i}`);
    await a.engine.sync();
    await a.remove("n7");
    await a.engine.sync();
    clock.advance(91 * DAY);
    server.purgeTombstones();
    // The purged tombstone has the highest seq: every page boundary is below it.
    const b = await device();
    const joined = await b.engine.sync();
    assert.equal(joined.full, null);
    assert.equal(b.ids().length, 7);
    const again = await b.engine.sync({ full: true });
    assert.equal(again.full, "requested");
    assert.equal(again.pushed, 0);
    assert.equal(b.engine.status().fullResyncPending, null);
    // The cursor ends past the purged tombstone, so later syncs stay plain
    // pulls of one page instead of a full pass each time.
    for (let run = 0; run < 2; run += 1) {
      const before = server.log.length;
      const plain = await b.engine.sync();
      assert.equal(plain.full, null);
      const pulls = server.log
        .slice(before)
        .filter((entry) => entry.path.endsWith("/changes"));
      assert.equal(pulls.length, 1);
    }
  });

  it("pulls once, not a full pass each time, when the newest seqs are purged deletes", async () => {
    const { device, server, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("keep", "keep me");
    a.edit("gone", "delete me");
    await a.engine.sync();
    await b.engine.sync();
    await a.remove("gone");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(91 * DAY);
    server.purgeTombstones();
    // A pass that ends below the purged tombstone: a device joining, and one
    // that asks for a full pass.
    const c = await device();
    assert.equal((await c.engine.sync()).full, null);
    assert.equal((await b.engine.sync({ full: true })).full, "requested");
    for (const engine of [b.engine, c.engine]) {
      for (let run = 0; run < 2; run += 1) {
        const before = server.log.length;
        const plain = await engine.sync();
        assert.equal(plain.full, null);
        const pulls = server.log
          .slice(before)
          .filter((entry) => entry.path.endsWith("/changes"));
        assert.equal(pulls.length, 1);
      }
    }
    assert.deepEqual(b.ids(), ["keep"]);
    assert.deepEqual(c.ids(), ["keep"]);
  });

  it("closes cleanly while a sync runs", async () => {
    const { device } = setup();
    const a = await device();
    for (let i = 0; i < 20; i += 1) a.edit(`n${i}`, `note ${i}`);
    const running = a.engine.sync();
    await a.engine.forget();
    await assert.rejects(running, SyncClosedError);
    await assert.rejects(
      a.engine.recordDeletes([{ id: "n1" }]),
      SyncClosedError,
    );
    assert.equal(await a.state.load(), null);
  });

  it("dates a delete when the user made it, so a later edit elsewhere still wins", async () => {
    const { device, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("n1", "base");
    await a.engine.sync();
    await b.engine.sync();
    clock.advance(1000);
    // A deletes n1; the delete reaches the engine only an hour later (the app
    // was closed meanwhile).
    const hlc = a.notes.get("n1")!.hlc;
    const deletedAt = a.engine.stamp(hlc);
    a.notes.remove("n1");
    clock.advance(30 * 60_000);
    b.edit("n1", "edited on B after the delete");
    await b.engine.sync();
    clock.advance(30 * 60_000);
    await a.engine.recordDeletes([{ id: "n1", hlc, deletedAt }]);
    const report = await a.engine.sync();
    assert.deepEqual(report.conflictCopies, []);
    assert.equal(a.text("n1"), "edited on B after the delete");
    await b.engine.sync();
    assert.deepEqual(b.ids(), ["n1"]);
    assert.equal(b.text("n1"), "edited on B after the delete");
  });

  it("hands deletes not yet uploaded to the next engine of the same vault", async () => {
    const { device, server, keys } = setup();
    const a = await device();
    const b = await device();
    a.edit("keep", "keep me");
    a.edit("gone", "delete me everywhere");
    await a.engine.sync();
    await b.engine.sync();
    // Offline: the delete waits in A's state.
    await a.remove("gone");
    await a.engine.close();
    const carried = await pendingDeletesOf(a.state);
    assert.equal(carried?.vaultId, keys.vaultId);
    assert.deepEqual(
      carried?.deletes.map(({ id }) => id),
      ["gone"],
    );
    await a.state.clear();
    assert.equal(await pendingDeletesOf(a.state), null);
    // A fresh state for the same vault (sync turned on again, or the notes
    // downloaded again): the delete still reaches the server and B.
    const again = await device({ notes: a.notes, state: a.state });
    await again.engine.recordDeletes(carried!.deletes);
    await again.engine.sync();
    assert.deepEqual(again.ids(), ["keep"]);
    await b.engine.sync();
    assert.deepEqual(b.ids(), ["keep"]);
    assert.ok(
      server
        .records(keys.vaultId)
        .some((r) => r.rid === recordId(keys, "gone") && r.deleted),
    );
  });

  it("a delete the app kept outside the state does not come back from a fresh state", async () => {
    const { device, keys } = setup();
    const a = await device();
    const b = await device();
    a.edit("keep", "keep me");
    a.edit("gone", "delete me everywhere");
    await a.engine.sync();
    await b.engine.sync();
    // The vault is not open (its key cannot be read): the app keeps the
    // delete itself, stamped when it was made, then the state is forgotten.
    const hlc = a.notes.get("gone")!.hlc;
    const deletedAt = a.engine.stamp(hlc);
    await a.engine.close();
    a.notes.remove("gone");
    const kept = await withSyncedVersions(a.state, keys.vaultId, [
      { id: "gone", hlc, deletedAt },
    ]);
    assert.deepEqual(kept[0]?.synced?.hlc, hlc);
    await a.state.clear();
    const again = await device({ notes: a.notes, state: a.state });
    await again.engine.recordDeletes(kept);
    const report = await again.engine.sync();
    assert.deepEqual(report.conflictCopies, [], "no copy of the deleted note");
    assert.deepEqual(again.ids(), ["keep"]);
    await b.engine.sync();
    assert.deepEqual(b.ids(), ["keep"]);
  });

  it("a kept delete still loses to a later edit elsewhere, and keeps an edit it did not see", async () => {
    const { device, keys, clock } = setup();
    const a = await device();
    const b = await device();
    a.edit("early", "early");
    a.edit("late", "late");
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.close();
    // B edits one note before A deletes both, and the other after.
    clock.advance(1000);
    b.edit("early", "edited on B before the delete");
    const unseen = b.notes.get("early")!.hlc;
    await b.engine.sync();
    clock.advance(1000);
    const deletes = ["early", "late"].map((id) => {
      const hlc = a.notes.get(id)!.hlc;
      a.notes.remove(id);
      return { id, hlc, deletedAt: a.engine.stamp(hlc) };
    });
    clock.advance(1000);
    b.edit("late", "edited on B after the delete");
    await b.engine.sync();
    const kept = await withSyncedVersions(a.state, keys.vaultId, deletes);
    await a.state.clear();
    const again = await device({ notes: a.notes, state: a.state });
    await again.engine.recordDeletes(kept);
    const report = await again.engine.sync();
    const copy = conflictCopyId("early", unseen!);
    assert.deepEqual(report.conflictCopies, [copy]);
    assert.equal(again.text("late"), "edited on B after the delete");
    assert.equal(again.text(copy), "edited on B before the delete");
    assert.deepEqual(again.ids(), sorted([copy, "late"]));
    await b.engine.sync();
    assert.deepEqual(b.ids(), sorted([copy, "late"]));
  });

  it("adds a synced version only from a state of the same vault that synced the note", async () => {
    const { device, keys } = setup();
    const a = await device();
    a.edit("synced", "on the server");
    await a.engine.sync();
    a.edit("local", "never uploaded");
    await a.engine.close();
    const given = { hlc: { t: 1, c: 0, d: "dev" } };
    const deletes = [
      { id: "synced" },
      { id: "local" },
      { id: "given", synced: given },
    ];
    const filled = await withSyncedVersions(a.state, keys.vaultId, deletes);
    assert.deepEqual(filled[0]?.synced?.hlc, a.notes.get("synced")!.hlc);
    assert.equal(typeof filled[0]?.synced?.fp, "string");
    assert.deepEqual(filled.slice(1), deletes.slice(1));
    const other = deriveVaultKeys(generateRootKey(randomBytes)).vaultId;
    assert.deepEqual(
      await withSyncedVersions(a.state, other, deletes),
      deletes,
    );
    assert.deepEqual(
      await withSyncedVersions(createMemoryStateStore(), keys.vaultId, deletes),
      deletes,
    );
  });
});

export type { SyncEngine };
