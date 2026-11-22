import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";

import { SqliteStore } from "./sqlite-store.js";
import {
  newRid,
  newVaultId,
  newVerifier,
  sealedBytes,
} from "./test-support.js";

/** The tables as schema 1 wrote them, before tombstones were counted. */
const SCHEMA_1 = `
CREATE TABLE vaults (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  epoch TEXT NOT NULL,
  head INTEGER NOT NULL DEFAULT 0,
  records INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  purged_seq INTEGER NOT NULL DEFAULT 0,
  purged_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  touched_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;
CREATE TABLE records (
  vault TEXT NOT NULL,
  rid TEXT NOT NULL,
  rev INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  ct BLOB NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (vault, rid)
) STRICT;
PRAGMA user_version = 1;
`;

const T0 = Date.parse("2026-11-20T12:00:00.000Z");

describe("sqlite store file", () => {
  const directory = mkdtempSync(join(tmpdir(), "sonolect-sync-schema-"));
  after(() => rmSync(directory, { recursive: true, force: true }));

  it("counts the tombstones of a schema 1 file when it opens it", async () => {
    const path = join(directory, "schema-1.db");
    const { DatabaseSync } = await import("node:sqlite");
    const old = new DatabaseSync(path);
    old.exec(SCHEMA_1);
    const vaultId = newVaultId();
    old
      .prepare(
        `INSERT INTO vaults (id, verifier, epoch, head, records, bytes, purged_at, created_at, touched_at)
         VALUES (?, ?, 'AAAAAAAAAAA', 3, 3, 900, ?, ?, ?)`,
      )
      .run(vaultId, newVerifier(), T0, T0, T0);
    const insert = old.prepare(
      `INSERT INTO records (vault, rid, rev, seq, deleted, ct, size, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, 300, ?)`,
    );
    [false, false, true].forEach((deleted, index) =>
      insert.run(
        vaultId,
        newRid(),
        index + 1,
        deleted ? 1 : 0,
        sealedBytes(300),
        T0,
      ),
    );
    old.close();

    const store = await SqliteStore.open(path);
    try {
      const meta = await store.getVault(vaultId);
      assert.equal(meta?.records, 3);
      assert.equal(meta?.tombstones, 1);
      // Two notes and a tombstone: room for a third note.
      const quotas = {
        maxVaultRecords: 3,
        maxVaultTombstones: 10,
        maxVaultBytes: 1 << 20,
        maxTombstoneBytes: 1024,
      };
      const [added] = await store.write(
        vaultId,
        [{ rid: newRid(), baseRev: 0, deleted: false, ct: sealedBytes(300) }],
        quotas,
        T0,
      );
      assert.equal(added?.status, "ok");
      assert.equal((await store.getVault(vaultId))?.tombstones, 1);
    } finally {
      await store.close();
    }
    const reopened = new DatabaseSync(path);
    try {
      const version = reopened.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(version.user_version, 2);
    } finally {
      reopened.close();
    }
  });

  it("syncs each commit to disk before it answers", async () => {
    const store = await SqliteStore.open(join(directory, "durable.db"));
    try {
      // The store's own connection: synchronous is set per connection.
      const { db } = store as unknown as { db: DatabaseSync };
      const pragma = (name: string) =>
        Object.values(
          db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>,
        )[0];
      assert.equal(pragma("journal_mode"), "wal");
      // 2 is FULL: NORMAL (1) in WAL mode loses the last commits on a power cut.
      assert.equal(pragma("synchronous"), 2);
    } finally {
      await store.close();
    }
  });

  it("refuses a file written by a newer service", async () => {
    const path = join(directory, "newer.db");
    const { DatabaseSync } = await import("node:sqlite");
    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version = 99");
    newer.close();
    await assert.rejects(SqliteStore.open(path), /newer service/);
  });
});
