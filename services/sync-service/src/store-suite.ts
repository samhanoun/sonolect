/**
 * The VaultStore contract (see store.ts), run against every store: memory
 * and SQLite in store.test.ts, Firestore in firestore.test.ts.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  type Quotas,
  type StoreWriteResult,
  type VaultStore,
  VaultGoneError,
  type WriteInput,
} from "./store.js";
import {
  DAY,
  type StoreFactory,
  newRid,
  newVaultId,
  newVerifier,
  sealedBytes,
} from "./test-support.js";

const QUOTAS: Quotas = { maxVaultRecords: 20_000, maxVaultBytes: 200 << 20 };
const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const EPOCH = "AAAAAAAAAAA";

const put = (rid: string, baseRev = 0, size = 300): WriteInput => ({
  rid,
  baseRev,
  deleted: false,
  ct: sealedBytes(size),
});
const tombstone = (rid: string, baseRev: number, size = 64): WriteInput => ({
  rid,
  baseRev,
  deleted: true,
  ct: sealedBytes(size),
});

const ok = (result: StoreWriteResult | undefined) => {
  assert.equal(result?.status, "ok", JSON.stringify(result));
  return result as Extract<StoreWriteResult, { status: "ok" }>;
};

export function defineStoreTests(factory: StoreFactory): void {
  describe(`${factory.label} store`, () => {
    const opened: VaultStore[] = [];
    const open = async () => {
      const store = await factory.open();
      opened.push(store);
      return store;
    };
    const vault = async (store: VaultStore) => {
      const vaultId = newVaultId();
      const created = await store.createVault(
        vaultId,
        newVerifier(),
        EPOCH,
        T0,
      );
      assert.equal(created.outcome, "created");
      return vaultId;
    };
    after(async () => {
      for (const store of opened) await store.close();
      factory.cleanup?.();
    });

    it("creates a vault once and tells a second key apart", async () => {
      const store = await open();
      const vaultId = newVaultId();
      const verifier = newVerifier();
      assert.deepEqual(
        await store.createVault(vaultId, verifier, "epoch-one00", T0),
        {
          outcome: "created",
          epoch: "epoch-one00",
        },
      );
      // The existing epoch, not the new candidate.
      assert.deepEqual(
        await store.createVault(vaultId, verifier, "epoch-two00", T0),
        {
          outcome: "exists",
          epoch: "epoch-one00",
        },
      );
      assert.deepEqual(
        await store.createVault(vaultId, newVerifier(), "epoch-two00", T0),
        { outcome: "mismatch" },
      );
      const meta = await store.getVault(vaultId);
      assert.equal(meta?.verifier, verifier);
      assert.equal(meta?.epoch, "epoch-one00");
      assert.equal(meta?.head, 0);
      assert.equal(meta?.records, 0);
      assert.equal(meta?.bytes, 0);
      assert.equal(meta?.purgedSeq, 0);
      assert.equal(meta?.deletedAt, undefined);
      assert.equal(await store.getVault(newVaultId()), undefined);
    });

    it("compare-and-swaps each write in order and counts the vault", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const [a, b, c] = [newRid(), newRid(), newRid()];
      const first = await store.write(
        vaultId,
        [put(a), put(b, 0, 500)],
        QUOTAS,
        T0,
      );
      assert.deepEqual(
        first.map((r) => ok(r)).map(({ rev, seq }) => [rev, seq]),
        [
          [1, 1],
          [1, 2],
        ],
      );
      const second = await store.write(
        vaultId,
        [put(a, 1, 400), put(b, 0), put(c, 1), put(c, 0)],
        QUOTAS,
        T0 + 1,
      );
      assert.deepEqual(ok(second[0]), { rid: a, status: "ok", rev: 2, seq: 3 });
      // A stale baseRev gets what the server holds.
      const stale = second[1];
      assert.equal(stale?.status, "conflict");
      if (stale?.status === "conflict") {
        assert.equal(stale.current?.rid, b);
        assert.equal(stale.current?.rev, 1);
        assert.equal(stale.current?.seq, 2);
        assert.equal(stale.current?.size, 500);
        assert.equal(stale.current?.ct.length, 500);
        assert.equal(stale.current?.deleted, false);
      }
      // A baseRev for a record the server does not have: current is null.
      assert.deepEqual(second[2], {
        rid: c,
        status: "conflict",
        current: null,
      });
      assert.deepEqual(ok(second[3]), { rid: c, status: "ok", rev: 1, seq: 4 });
      const meta = await store.getVault(vaultId);
      assert.equal(meta?.head, 4);
      assert.equal(meta?.records, 3);
      assert.equal(meta?.bytes, 400 + 500 + 300);
    });

    it("gives concurrent batches unique, gapless seqs", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const batches = Array.from({ length: 5 }, () =>
        Array.from({ length: 8 }, () => put(newRid(), 0, 80)),
      );
      const results = await Promise.all(
        batches.map((writes) => store.write(vaultId, writes, QUOTAS, T0)),
      );
      const seqs = results.flat().map((result) => ok(result).seq);
      assert.deepEqual(
        [...seqs].sort((a, b) => a - b),
        Array.from({ length: 40 }, (_, i) => i + 1),
      );
      // Within a batch, in request order.
      for (const batch of results) {
        const own = batch.map((result) => ok(result).seq);
        assert.deepEqual(
          own,
          [...own].sort((a, b) => a - b),
        );
      }
      const meta = await store.getVault(vaultId);
      assert.equal(meta?.head, 40);
      assert.equal(meta?.records, 40);
      assert.equal(meta?.bytes, 40 * 80);
    });

    it("returns changes in seq order, after the cursor, within the caps", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const rids = Array.from({ length: 5 }, () => newRid());
      await store.write(
        vaultId,
        rids.map((rid) => put(rid, 0, 100)),
        QUOTAS,
        T0,
      );
      // Rewriting the first record moves it to the end of the feed.
      await store.write(vaultId, [put(rids[0]!, 1, 100)], QUOTAS, T0);
      const all = await store.changes(vaultId, 0, 200, 1 << 20);
      assert.deepEqual(
        all.records.map((r) => [r.rid, r.seq]),
        [
          [rids[1], 2],
          [rids[2], 3],
          [rids[3], 4],
          [rids[4], 5],
          [rids[0], 6],
        ],
      );
      assert.equal(all.hasMore, false);
      assert.equal(all.records[4]?.rev, 2);
      assert.equal(all.records[4]?.updatedAt, T0);

      const limited = await store.changes(vaultId, 2, 2, 1 << 20);
      assert.deepEqual(
        limited.records.map((r) => r.seq),
        [3, 4],
      );
      assert.equal(limited.hasMore, true);
      const capped = await store.changes(vaultId, 0, 200, 250);
      assert.deepEqual(
        capped.records.map((r) => r.seq),
        [2, 3],
      );
      assert.equal(capped.hasMore, true);
      const tail = await store.changes(vaultId, 5, 200, 250);
      assert.deepEqual(
        tail.records.map((r) => r.seq),
        [6],
      );
      assert.equal(tail.hasMore, false);
      const none = await store.changes(vaultId, 6, 200, 250);
      assert.deepEqual(none, { records: [], hasMore: false });
    });

    it("returns a record larger than the byte cap on a page of its own", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const [big, small] = [newRid(), newRid()];
      await store.write(
        vaultId,
        [put(big, 0, 5000), put(small, 0, 100)],
        QUOTAS,
        T0,
      );
      const page = await store.changes(vaultId, 0, 200, 1000);
      assert.deepEqual(
        page.records.map((r) => r.rid),
        [big],
      );
      assert.equal(page.records[0]?.ct.length, 5000);
      assert.equal(page.hasMore, true);
    });

    it("pages through more records than one read returns", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const rids = Array.from({ length: 150 }, () => newRid());
      for (let i = 0; i < rids.length; i += 50)
        await store.write(
          vaultId,
          rids.slice(i, i + 50).map((rid) => put(rid, 0, 64)),
          QUOTAS,
          T0,
        );
      const page = await store.changes(vaultId, 0, 120, 1 << 20);
      assert.equal(page.records.length, 120);
      assert.deepEqual(
        page.records.map((r) => r.seq),
        Array.from({ length: 120 }, (_, i) => i + 1),
      );
      assert.equal(page.hasMore, true);
      const rest = await store.changes(vaultId, 120, 200, 1 << 20);
      assert.equal(rest.records.length, 30);
      assert.equal(rest.hasMore, false);
      const bytesCapped = await store.changes(vaultId, 0, 200, 64 * 70);
      assert.equal(bytesCapped.records.length, 70);
      assert.equal(bytesCapped.hasMore, true);
    });

    it("enforces the quotas, but never on deleting a stored record", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const quotas: Quotas = { maxVaultRecords: 2, maxVaultBytes: 1000 };
      const [a, b, c] = [newRid(), newRid(), newRid()];
      const results = await store.write(
        vaultId,
        [put(a, 0, 400), put(b, 0, 700), put(b, 0, 500), put(c, 0, 50)],
        quotas,
        T0,
      );
      ok(results[0]);
      assert.deepEqual(results[1], {
        rid: b,
        status: "rejected",
        reason: "quota_bytes",
      });
      ok(results[2]);
      assert.deepEqual(results[3], {
        rid: c,
        status: "rejected",
        reason: "quota_records",
      });
      // A new tombstone counts like any record.
      const newTombstone = await store.write(
        vaultId,
        [tombstone(c, 0)],
        quotas,
        T0,
      );
      assert.deepEqual(newTombstone[0], {
        rid: c,
        status: "rejected",
        reason: "quota_records",
      });
      // Growing a record past the byte quota is refused; deleting it is not.
      const grow = await store.write(vaultId, [put(a, 1, 600)], quotas, T0);
      assert.deepEqual(grow[0], {
        rid: a,
        status: "rejected",
        reason: "quota_bytes",
      });
      let meta = await store.getVault(vaultId);
      assert.equal(meta?.head, 2);
      assert.equal(meta?.bytes, 900);
      const removed = await store.write(
        vaultId,
        [tombstone(a, 1, 64)],
        quotas,
        T0,
      );
      assert.deepEqual(ok(removed[0]), {
        rid: a,
        status: "ok",
        rev: 2,
        seq: 3,
      });
      meta = await store.getVault(vaultId);
      assert.equal(meta?.records, 2);
      assert.equal(meta?.bytes, 564);
      // Even a tombstone larger than the record it replaces, in a full vault.
      const full: Quotas = { maxVaultRecords: 2, maxVaultBytes: 564 };
      const larger = await store.write(
        vaultId,
        [tombstone(b, 1, 600)],
        full,
        T0,
      );
      ok(larger[0]);
      assert.equal((await store.getVault(vaultId))?.bytes, 664);
    });

    it("deletes a vault for good, keeping only its marker", async () => {
      const store = await open();
      const vaultId = newVaultId();
      const verifier = newVerifier();
      await store.createVault(vaultId, verifier, EPOCH, T0);
      await store.write(vaultId, [put(newRid()), put(newRid())], QUOTAS, T0);
      await store.deleteVault(vaultId, T0 + 5);
      const meta = await store.getVault(vaultId);
      assert.equal(meta?.deletedAt, T0 + 5);
      assert.equal(meta?.verifier, verifier);
      assert.equal(meta?.epoch, EPOCH);
      assert.equal(meta?.records, 0);
      assert.equal(meta?.bytes, 0);
      assert.deepEqual(await store.changes(vaultId, 0, 200, 1 << 20), {
        records: [],
        hasMore: false,
      });
      await assert.rejects(
        store.write(vaultId, [put(newRid())], QUOTAS, T0),
        VaultGoneError,
      );
      assert.deepEqual(
        await store.createVault(vaultId, verifier, "otherEpoch0", T0),
        {
          outcome: "deleted",
        },
      );
      assert.deepEqual(
        await store.createVault(vaultId, newVerifier(), "otherEpoch0", T0),
        {
          outcome: "mismatch",
        },
      );
      // Idempotent; the first deletion time stays.
      await store.deleteVault(vaultId, T0 + 99);
      assert.equal((await store.getVault(vaultId))?.deletedAt, T0 + 5);
      // Deleting an unknown vault creates nothing.
      const unknown = newVaultId();
      await store.deleteVault(unknown, T0);
      assert.equal(await store.getVault(unknown), undefined);
      await assert.rejects(
        store.write(unknown, [put(newRid())], QUOTAS, T0),
        VaultGoneError,
      );
    });

    it("purges old tombstones at most once per interval", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const [live, old1, old2, fresh] = [
        newRid(),
        newRid(),
        newRid(),
        newRid(),
      ];
      await store.write(
        vaultId,
        [put(live, 0, 100), put(old1, 0, 100), put(old2, 0, 100)],
        QUOTAS,
        T0,
      );
      // seq 4 and 5: tombstones written at T0 + 1 day.
      await store.write(
        vaultId,
        [tombstone(old1, 1, 50), tombstone(old2, 1, 60)],
        QUOTAS,
        T0 + DAY,
      );
      // seq 6: a tombstone written 50 days later.
      await store.write(
        vaultId,
        [tombstone(fresh, 0, 70)],
        QUOTAS,
        T0 + 51 * DAY,
      );
      const before = await store.getVault(vaultId);
      assert.equal(before?.records, 4);
      assert.equal(before?.bytes, 100 + 50 + 60 + 70);

      const now = T0 + 95 * DAY;
      assert.equal(await store.purge(vaultId, now, 90 * DAY, DAY), 2);
      const after = await store.getVault(vaultId);
      assert.equal(after?.records, 2);
      assert.equal(after?.bytes, 170);
      assert.equal(after?.purgedSeq, 5);
      assert.equal(after?.purgedAt, now);
      assert.equal(after?.head, 6);
      const left = await store.changes(vaultId, 0, 200, 1 << 20);
      assert.deepEqual(
        left.records.map((r) => [r.rid, r.deleted]),
        [
          [live, false],
          [fresh, true],
        ],
      );
      // Within the interval nothing runs, even when a tombstone is due.
      assert.equal(await store.purge(vaultId, now + DAY - 1, 40 * DAY, DAY), 0);
      assert.equal(await store.purge(vaultId, now + DAY, 40 * DAY, DAY), 1);
      assert.equal((await store.getVault(vaultId))?.purgedSeq, 6);
      // A deleted vault has nothing to purge.
      await store.deleteVault(vaultId, now + 2 * DAY);
      assert.equal(await store.purge(vaultId, now + 400 * DAY, DAY, DAY), 0);
    });

    it("keeps a tombstone that an edit brought back", async () => {
      const store = await open();
      const vaultId = await vault(store);
      const rid = newRid();
      await store.write(vaultId, [put(rid, 0, 100)], QUOTAS, T0);
      await store.write(vaultId, [tombstone(rid, 1)], QUOTAS, T0);
      await store.write(vaultId, [put(rid, 2, 120)], QUOTAS, T0 + DAY);
      assert.equal(
        await store.purge(vaultId, T0 + 200 * DAY, 90 * DAY, DAY),
        0,
      );
      const page = await store.changes(vaultId, 0, 200, 1 << 20);
      assert.deepEqual(
        page.records.map((r) => [r.rev, r.deleted, r.size]),
        [[3, false, 120]],
      );
      assert.equal((await store.getVault(vaultId))?.purgedSeq, 0);
    });
  });
}
