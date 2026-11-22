import type { QuotaReason } from "@sonolect/sync-core/wire";

/**
 * Where the sync service keeps vaults. Every implementation (memory, SQLite,
 * Firestore) has the same semantics, checked by the same tests:
 *
 * - A vault holds opaque records under opaque ids. Each successful write
 *   gives the record the next sequence number of its vault (`head + 1`) and
 *   its next revision, so `changes(since)` returns every record written after
 *   `since`, in write order.
 * - Writes are compare-and-swap on the revision, applied in request order in
 *   one transaction per batch.
 * - `records` and `bytes` count every stored record, tombstones included,
 *   and `tombstones` how many of them are tombstones. The record quota
 *   counts notes only (records that are not tombstones), so deleting notes
 *   frees room for new ones at once; tombstones may take up to
 *   `Quotas.maxVaultTombstones` records beyond that until they are purged.
 * - A delete that replaces a stored record is never refused for quota, so a
 *   full vault can always be cleaned up, as long as it does not grow the
 *   vault by more than a tombstone can be (`Quotas.maxTombstoneBytes`): a
 *   write flagged as a delete cannot carry data past the quota.
 * - Tombstones older than the tombstone TTL are purged by `purge`, which
 *   records the highest purged seq. Every page of changes reports it
 *   (`purgedSeq`), so a client whose cursor from a finished pull is older
 *   resyncs, while a pass from 0 can page past it.
 * - A deleted vault keeps only its id, verifier, epoch and deletion time, so
 *   devices that still hold its key learn that it was deleted (410) instead
 *   of creating it again.
 */

export interface StoredRecord {
  rid: string;
  rev: number;
  seq: number;
  deleted: boolean;
  /** The sealed envelope, as the client sent it. */
  ct: Uint8Array;
  /** ct.length */
  size: number;
  /** Server time of the write (ms). */
  updatedAt: number;
}

export interface VaultMeta {
  /** base64url SHA-256 of the bearer token. */
  verifier: string;
  /** Random per vault creation. */
  epoch: string;
  /** The vault's latest seq. */
  head: number;
  /** Stored records, tombstones included. */
  records: number;
  /** How many of `records` are tombstones. */
  tombstones: number;
  bytes: number;
  /** The highest seq of a purged tombstone. */
  purgedSeq: number;
  /** When tombstones were last purged (ms). */
  purgedAt: number;
  /** Set when the vault was deleted (ms). */
  deletedAt?: number | undefined;
}

export interface WriteInput {
  rid: string;
  baseRev: number;
  deleted: boolean;
  ct: Uint8Array;
}

export type StoreWriteResult =
  | { rid: string; status: "ok"; rev: number; seq: number }
  | { rid: string; status: "conflict"; current: StoredRecord | null }
  | { rid: string; status: "rejected"; reason: QuotaReason };

export interface Quotas {
  /** Notes: stored records that are not tombstones. */
  maxVaultRecords: number;
  /** Records tombstones may take beyond `maxVaultRecords`. */
  maxVaultTombstones: number;
  maxVaultBytes: number;
  /** A delete over a stored record is exempt from the quotas up to this size. */
  maxTombstoneBytes: number;
}

export type CreateOutcome =
  | { outcome: "created"; epoch: string }
  | { outcome: "exists"; epoch: string }
  /** The id is taken by another verifier. */
  | { outcome: "mismatch" }
  /** The vault was deleted; it cannot be created again with this key. */
  | { outcome: "deleted" };

export interface ChangesPage {
  /** Records with seq > since, in seq order. */
  records: StoredRecord[];
  hasMore: boolean;
}

/** Thrown by `write` when the vault was deleted (or never existed) meanwhile. */
export class VaultGoneError extends Error {
  constructor() {
    super("the vault does not exist or was deleted");
    this.name = "VaultGoneError";
  }
}

export interface VaultStore {
  /** "memory", "sqlite" or "firestore". */
  readonly kind: string;
  /** Creates a vault, or reports why it cannot. `epoch` is used only when it creates one. */
  createVault(
    vaultId: string,
    verifier: string,
    epoch: string,
    now: number,
  ): Promise<CreateOutcome>;
  getVault(vaultId: string): Promise<VaultMeta | undefined>;
  /**
   * Records with seq > since, in seq order: at most `limit`, and at most
   * `maxBytes` of ciphertext unless the first record alone is larger.
   */
  changes(
    vaultId: string,
    since: number,
    limit: number,
    maxBytes: number,
  ): Promise<ChangesPage>;
  /** One transaction: compare-and-swap each write in order. Throws VaultGoneError. */
  write(
    vaultId: string,
    writes: readonly WriteInput[],
    quotas: Quotas,
    now: number,
  ): Promise<StoreWriteResult[]>;
  /** Erases every record and marks the vault deleted. Idempotent. */
  deleteVault(vaultId: string, now: number): Promise<void>;
  /**
   * Removes tombstones written before `now - ttlMs`, at most once per
   * `intervalMs` per vault. Returns how many it removed.
   */
  purge(
    vaultId: string,
    now: number,
    ttlMs: number,
    intervalMs: number,
  ): Promise<number>;
  close(): Promise<void>;
}

/** Running counters of a vault while one batch is applied. */
export interface VaultCounters {
  head: number;
  records: number;
  tombstones: number;
  bytes: number;
}

/**
 * The outcome of one write against the record currently stored (shared by
 * every store). On "ok" it advances `counters` and returns the new record.
 */
export function decideWrite(
  write: WriteInput,
  current: StoredRecord | undefined,
  counters: VaultCounters,
  quotas: Quotas,
  now: number,
): { result: StoreWriteResult; record?: StoredRecord } {
  if ((current?.rev ?? 0) !== write.baseRev)
    return {
      result: { rid: write.rid, status: "conflict", current: current ?? null },
    };
  const size = write.ct.length;
  const growth = size - (current?.size ?? 0);
  const added = current ? 0 : 1;
  const tombstoneGrowth =
    (write.deleted ? 1 : 0) - (current?.deleted === true ? 1 : 0);
  // Notes: a write adds one when it stores a note where none was.
  const noteGrowth = added - tombstoneGrowth;
  // Deleting a stored record must work even in a full vault.
  // Only a real delete: one that does not make the vault larger, or no
  // larger than a sealed tombstone is.
  const exempt =
    write.deleted &&
    current !== undefined &&
    (growth <= 0 || size <= quotas.maxTombstoneBytes);
  const overRecords =
    (noteGrowth > 0 &&
      counters.records - counters.tombstones + noteGrowth >
        quotas.maxVaultRecords) ||
    (added > 0 &&
      counters.records + added >
        quotas.maxVaultRecords + quotas.maxVaultTombstones);
  if (!exempt && overRecords)
    return {
      result: { rid: write.rid, status: "rejected", reason: "quota_records" },
    };
  if (!exempt && growth > 0 && counters.bytes + growth > quotas.maxVaultBytes)
    return {
      result: { rid: write.rid, status: "rejected", reason: "quota_bytes" },
    };
  counters.head += 1;
  counters.records += added;
  // Never below 0, even on a vault whose count was missing (read as 0).
  counters.tombstones = Math.max(0, counters.tombstones + tombstoneGrowth);
  counters.bytes += growth;
  const record: StoredRecord = {
    rid: write.rid,
    rev: write.baseRev + 1,
    seq: counters.head,
    deleted: write.deleted,
    ct: write.ct,
    size,
    updatedAt: now,
  };
  return {
    result: { rid: write.rid, status: "ok", rev: record.rev, seq: record.seq },
    record,
  };
}

/** Cuts records (in seq order) to a page of at most `limit` records and `maxBytes`. */
export function cutPage(
  records: readonly StoredRecord[],
  limit: number,
  maxBytes: number,
): ChangesPage {
  const page: StoredRecord[] = [];
  let bytes = 0;
  for (const record of records) {
    if (page.length >= limit) break;
    if (page.length > 0 && bytes + record.size > maxBytes) break;
    page.push(record);
    bytes += record.size;
  }
  return { records: page, hasMore: page.length < records.length };
}
