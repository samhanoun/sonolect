import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import {
  type ChangesPage,
  type CreateOutcome,
  type Quotas,
  type StoreWriteResult,
  type StoredRecord,
  type VaultMeta,
  type VaultStore,
  VaultGoneError,
  type WriteInput,
  cutPage,
  decideWrite,
} from "./store.js";

/** Bumped when the tables change; a newer file is refused rather than misread. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vaults (
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
CREATE TABLE IF NOT EXISTS records (
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
CREATE UNIQUE INDEX IF NOT EXISTS records_feed ON records (vault, seq);
CREATE INDEX IF NOT EXISTS records_tombstones ON records (vault, updated_at) WHERE deleted = 1;
`;

/** Rows read ahead of a page, so a page of small records takes one query. */
const CHUNK_ROWS = 64;

type Row = Record<string, SQLOutputValue>;

const toRecord = (row: Row): StoredRecord => ({
  rid: String(row.rid),
  rev: Number(row.rev),
  seq: Number(row.seq),
  deleted: Number(row.deleted) === 1,
  ct: new Uint8Array(row.ct as Uint8Array),
  size: Number(row.size),
  updatedAt: Number(row.updated_at),
});

const toMeta = (row: Row): VaultMeta => ({
  verifier: String(row.verifier),
  epoch: String(row.epoch),
  head: Number(row.head),
  records: Number(row.records),
  bytes: Number(row.bytes),
  purgedSeq: Number(row.purged_seq),
  purgedAt: Number(row.purged_at),
  deletedAt: row.deleted_at === null ? undefined : Number(row.deleted_at),
});

/**
 * Vaults in one SQLite file (node:sqlite), for self-hosting with a volume
 * and for tests. One process owns the file: writes run in BEGIN IMMEDIATE
 * transactions, so a second process would wait (busy_timeout) rather than
 * interleave.
 */
export class SqliteStore implements VaultStore {
  readonly kind = "sqlite";
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** Opens (and creates) the database file; ":memory:" for tests. */
  static async open(path: string): Promise<SqliteStore> {
    // Loaded only when this store is chosen: node:sqlite warns on import in Node 22.
    const { DatabaseSync } = await import("node:sqlite");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      const version = Number(
        (db.prepare("PRAGMA user_version").get() as Row).user_version,
      );
      if (version > SCHEMA_VERSION)
        throw new Error(
          `the sync database was written by a newer service (schema ${version})`,
        );
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } catch (error) {
      db.close();
      throw error;
    }
    return new SqliteStore(db);
  }

  /** Runs `body` in one write transaction. */
  private transaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private meta(vaultId: string): VaultMeta | undefined {
    const row = this.db
      .prepare("SELECT * FROM vaults WHERE id = ?")
      .get(vaultId) as Row | undefined;
    return row && toMeta(row);
  }

  async createVault(
    vaultId: string,
    verifier: string,
    epoch: string,
    now: number,
  ): Promise<CreateOutcome> {
    return this.transaction((): CreateOutcome => {
      const existing = this.meta(vaultId);
      if (existing) {
        if (existing.verifier !== verifier) return { outcome: "mismatch" };
        if (existing.deletedAt !== undefined) return { outcome: "deleted" };
        return { outcome: "exists", epoch: existing.epoch };
      }
      this.db
        .prepare(
          `INSERT INTO vaults (id, verifier, epoch, purged_at, created_at, touched_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(vaultId, verifier, epoch, now, now, now);
      return { outcome: "created", epoch };
    });
  }

  async getVault(vaultId: string): Promise<VaultMeta | undefined> {
    return this.meta(vaultId);
  }

  async changes(
    vaultId: string,
    since: number,
    limit: number,
    maxBytes: number,
  ): Promise<ChangesPage> {
    // Read in chunks so a page of large records never loads more than it
    // returns plus one chunk.
    const select = this.db.prepare(
      "SELECT * FROM records WHERE vault = ? AND seq > ? ORDER BY seq LIMIT ?",
    );
    const rows: StoredRecord[] = [];
    let cursor = since;
    for (;;) {
      const want = Math.min(CHUNK_ROWS, limit + 1 - rows.length);
      const chunk = (select.all(vaultId, cursor, want) as Row[]).map(toRecord);
      rows.push(...chunk);
      const page = cutPage(rows, limit, maxBytes);
      if (page.hasMore || chunk.length < want) return page;
      cursor = chunk[chunk.length - 1]!.seq;
    }
  }

  async write(
    vaultId: string,
    writes: readonly WriteInput[],
    quotas: Quotas,
    now: number,
  ): Promise<StoreWriteResult[]> {
    return this.transaction(() => {
      const meta = this.meta(vaultId);
      if (!meta || meta.deletedAt !== undefined) throw new VaultGoneError();
      const counters = {
        head: meta.head,
        records: meta.records,
        bytes: meta.bytes,
      };
      const read = this.db.prepare(
        "SELECT * FROM records WHERE vault = ? AND rid = ?",
      );
      const upsert = this.db.prepare(
        `INSERT INTO records (vault, rid, rev, seq, deleted, ct, size, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (vault, rid) DO UPDATE SET
           rev = excluded.rev, seq = excluded.seq, deleted = excluded.deleted,
           ct = excluded.ct, size = excluded.size, updated_at = excluded.updated_at`,
      );
      const results: StoreWriteResult[] = [];
      for (const write of writes) {
        const row = read.get(vaultId, write.rid) as Row | undefined;
        const { result, record } = decideWrite(
          write,
          row && toRecord(row),
          counters,
          quotas,
          now,
        );
        results.push(result);
        if (record)
          upsert.run(
            vaultId,
            record.rid,
            record.rev,
            record.seq,
            record.deleted ? 1 : 0,
            record.ct,
            record.size,
            record.updatedAt,
          );
      }
      if (counters.head !== meta.head)
        this.db
          .prepare(
            "UPDATE vaults SET head = ?, records = ?, bytes = ?, touched_at = ? WHERE id = ?",
          )
          .run(counters.head, counters.records, counters.bytes, now, vaultId);
      return results;
    });
  }

  async deleteVault(vaultId: string, now: number): Promise<void> {
    this.transaction(() => {
      this.db.prepare("DELETE FROM records WHERE vault = ?").run(vaultId);
      this.db
        .prepare(
          `UPDATE vaults SET records = 0, bytes = 0, deleted_at = coalesce(deleted_at, ?)
           WHERE id = ?`,
        )
        .run(now, vaultId);
    });
  }

  async purge(
    vaultId: string,
    now: number,
    ttlMs: number,
    intervalMs: number,
  ): Promise<number> {
    return this.transaction(() => {
      const meta = this.meta(vaultId);
      if (!meta || meta.deletedAt !== undefined) return 0;
      if (now - meta.purgedAt < intervalMs) return 0;
      const cutoff = now - ttlMs;
      const found = this.db
        .prepare(
          `SELECT count(*) AS n, coalesce(sum(size), 0) AS bytes, coalesce(max(seq), 0) AS seq
           FROM records WHERE vault = ? AND deleted = 1 AND updated_at < ?`,
        )
        .get(vaultId, cutoff) as Row;
      const purged = Number(found.n);
      if (purged > 0)
        this.db
          .prepare(
            "DELETE FROM records WHERE vault = ? AND deleted = 1 AND updated_at < ?",
          )
          .run(vaultId, cutoff);
      this.db
        .prepare(
          `UPDATE vaults SET records = records - ?, bytes = bytes - ?,
             purged_seq = max(purged_seq, ?), purged_at = ? WHERE id = ?`,
        )
        .run(purged, Number(found.bytes), Number(found.seq), now, vaultId);
      return purged;
    });
  }

  async close(): Promise<void> {
    if (this.db.isOpen) this.db.close();
  }
}
