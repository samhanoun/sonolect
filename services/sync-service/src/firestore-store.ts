import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  Firestore,
  Settings,
} from "@google-cloud/firestore";

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

/**
 * Vaults in Firestore, for Cloud Run:
 *
 *   syncVaults/{vaultId}               { verifier, epoch, head, records, bytes,
 *                                        purgedSeq, purgedAt, createdAt,
 *                                        touchedAt, deletedAt? }
 *   syncVaults/{vaultId}/records/{rid} { rev, seq, deleted, ct (bytes), size,
 *                                        updatedAt, tombstoneAt? }
 *
 * Times are numbers (ms). `changes` is `where seq > since orderBy seq` and
 * `purge` is `where tombstoneAt < cutoff` (set on tombstones only), both
 * served by Firestore's automatic single-field indexes, so the store needs
 * no composite index and no TTL policy: `purge` removes old tombstones in
 * transactions that also update the vault's counters and purgedSeq, which a
 * TTL policy could not. The service uses the Admin SDK, which security rules
 * do not apply to; the rules deny client SDKs this collection by default.
 */

const VAULTS = "syncVaults";
const RECORDS = "records";
/** Records read by the first query of a page; later queries adapt to sizes. */
const FIRST_CHUNK = 10;
const MAX_CHUNK = 100;
/** Tombstones removed per purge transaction, and transactions per purge. */
const PURGE_BATCH = 300;
const PURGE_ROUNDS = 5;

export interface FirestoreStoreOptions {
  /** Project; by default from the environment or the metadata server. */
  projectId?: string | undefined;
  /** Database id; "(default)" by default. */
  databaseId?: string | undefined;
  /** Root collection (tests isolate runs with their own). */
  collection?: string | undefined;
}

const num = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("malformed sync document");
  return value;
};

const toMeta = (data: DocumentData): VaultMeta => ({
  verifier: String(data.verifier),
  epoch: String(data.epoch),
  head: num(data.head),
  records: num(data.records),
  bytes: num(data.bytes),
  purgedSeq: num(data.purgedSeq),
  purgedAt: num(data.purgedAt),
  deletedAt:
    data.deletedAt === undefined || data.deletedAt === null
      ? undefined
      : num(data.deletedAt),
});

const toRecord = (rid: string, data: DocumentData): StoredRecord => {
  const ct = data.ct as Uint8Array;
  return {
    rid,
    rev: num(data.rev),
    seq: num(data.seq),
    deleted: data.deleted === true,
    ct: new Uint8Array(ct.buffer, ct.byteOffset, ct.byteLength),
    size: num(data.size),
    updatedAt: num(data.updatedAt),
  };
};

const toDocument = (record: StoredRecord): DocumentData => ({
  rev: record.rev,
  seq: record.seq,
  deleted: record.deleted,
  ct: Buffer.from(record.ct.buffer, record.ct.byteOffset, record.ct.byteLength),
  size: record.size,
  updatedAt: record.updatedAt,
  ...(record.deleted ? { tombstoneAt: record.updatedAt } : {}),
});

export class FirestoreStore implements VaultStore {
  readonly kind = "firestore";
  readonly db: Firestore;
  private readonly root: string;

  constructor(db: Firestore, collection = VAULTS) {
    this.db = db;
    this.root = collection;
  }

  /** Loads the client library only when this store is chosen. */
  static async open(
    options: FirestoreStoreOptions = {},
  ): Promise<FirestoreStore> {
    const { Firestore } = await import("@google-cloud/firestore");
    const settings: Settings = { ignoreUndefinedProperties: true };
    if (options.projectId) settings.projectId = options.projectId;
    if (options.databaseId) settings.databaseId = options.databaseId;
    return new FirestoreStore(new Firestore(settings), options.collection);
  }

  private vaultRef(vaultId: string): DocumentReference {
    return this.db.collection(this.root).doc(vaultId);
  }

  private recordsOf(vaultId: string): CollectionReference {
    return this.vaultRef(vaultId).collection(RECORDS);
  }

  async createVault(
    vaultId: string,
    verifier: string,
    epoch: string,
    now: number,
  ): Promise<CreateOutcome> {
    const ref = this.vaultRef(vaultId);
    return this.db.runTransaction(async (tx): Promise<CreateOutcome> => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const existing = toMeta(snap.data()!);
        if (existing.verifier !== verifier) return { outcome: "mismatch" };
        if (existing.deletedAt !== undefined) return { outcome: "deleted" };
        return { outcome: "exists", epoch: existing.epoch };
      }
      tx.create(ref, {
        verifier,
        epoch,
        head: 0,
        records: 0,
        bytes: 0,
        purgedSeq: 0,
        purgedAt: now,
        createdAt: now,
        touchedAt: now,
      });
      return { outcome: "created", epoch };
    });
  }

  async getVault(vaultId: string): Promise<VaultMeta | undefined> {
    const snap = await this.vaultRef(vaultId).get();
    return snap.exists ? toMeta(snap.data()!) : undefined;
  }

  async changes(
    vaultId: string,
    since: number,
    limit: number,
    maxBytes: number,
  ): Promise<ChangesPage> {
    // A record's seq only grows, so successive queries past the last seq
    // read never miss one written meanwhile.
    const records = this.recordsOf(vaultId);
    const rows: StoredRecord[] = [];
    let bytes = 0;
    let cursor = since;
    let chunk = FIRST_CHUNK;
    for (;;) {
      const want = Math.min(chunk, limit + 1 - rows.length);
      const snap = await records
        .where("seq", ">", cursor)
        .orderBy("seq")
        .limit(want)
        .get();
      for (const doc of snap.docs) {
        const record = toRecord(doc.id, doc.data());
        rows.push(record);
        bytes += record.size;
      }
      const page = cutPage(rows, limit, maxBytes);
      if (page.hasMore || snap.size < want) return page;
      cursor = rows[rows.length - 1]!.seq;
      // Read about as many records as the byte budget has room for.
      const average = Math.max(1, bytes / rows.length);
      chunk = Math.min(
        MAX_CHUNK,
        Math.max(1, Math.ceil((maxBytes - bytes) / average) + 1),
      );
    }
  }

  async write(
    vaultId: string,
    writes: readonly WriteInput[],
    quotas: Quotas,
    now: number,
  ): Promise<StoreWriteResult[]> {
    const vaultRef = this.vaultRef(vaultId);
    const refs = writes.map((write) => this.recordsOf(vaultId).doc(write.rid));
    // One transaction per batch: the request body limit keeps it far below
    // Firestore's 10 MiB per commit, and each record below 1 MiB.
    return this.db.runTransaction(async (tx) => {
      const [vaultSnap, ...snaps] = await tx.getAll(vaultRef, ...refs);
      const meta = vaultSnap?.exists ? toMeta(vaultSnap.data()!) : undefined;
      if (!meta || meta.deletedAt !== undefined) throw new VaultGoneError();
      const counters = {
        head: meta.head,
        records: meta.records,
        bytes: meta.bytes,
      };
      const results: StoreWriteResult[] = [];
      writes.forEach((write, index) => {
        const snap = snaps[index];
        const current = snap?.exists
          ? toRecord(write.rid, snap.data()!)
          : undefined;
        const { result, record } = decideWrite(
          write,
          current,
          counters,
          quotas,
          now,
        );
        results.push(result);
        if (record) tx.set(refs[index]!, toDocument(record));
      });
      if (counters.head !== meta.head)
        tx.update(vaultRef, {
          head: counters.head,
          records: counters.records,
          bytes: counters.bytes,
          touchedAt: now,
        });
      return results;
    });
  }

  async deleteVault(vaultId: string, now: number): Promise<void> {
    const vaultRef = this.vaultRef(vaultId);
    const exists = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(vaultRef);
      if (!snap.exists) return false;
      // Marked first, so no write lands while the records are erased.
      tx.update(vaultRef, {
        records: 0,
        bytes: 0,
        deletedAt: toMeta(snap.data()!).deletedAt ?? now,
      });
      return true;
    });
    if (exists) await this.db.recursiveDelete(this.recordsOf(vaultId));
  }

  async purge(
    vaultId: string,
    now: number,
    ttlMs: number,
    intervalMs: number,
  ): Promise<number> {
    const vaultRef = this.vaultRef(vaultId);
    const expired = this.recordsOf(vaultId)
      .where("tombstoneAt", "<", now - ttlMs)
      .limit(PURGE_BATCH);
    let total = 0;
    for (let round = 0; round < PURGE_ROUNDS; round += 1) {
      const { removed, done } = await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(vaultRef);
        const meta = snap.exists ? toMeta(snap.data()!) : undefined;
        if (!meta || meta.deletedAt !== undefined)
          return { removed: 0, done: true };
        // Later rounds continue the purge this call started.
        if (round === 0 && now - meta.purgedAt < intervalMs)
          return { removed: 0, done: true };
        const found = await tx.get(expired);
        let count = 0;
        let bytes = 0;
        let purgedSeq = meta.purgedSeq;
        for (const doc of found.docs) {
          const record = toRecord(doc.id, doc.data());
          if (!record.deleted) continue;
          tx.delete(doc.ref);
          count += 1;
          bytes += record.size;
          purgedSeq = Math.max(purgedSeq, record.seq);
        }
        tx.update(vaultRef, {
          records: meta.records - count,
          bytes: meta.bytes - bytes,
          purgedSeq,
          purgedAt: now,
        });
        return { removed: count, done: found.size < PURGE_BATCH };
      });
      total += removed;
      if (done) break;
    }
    return total;
  }

  async close(): Promise<void> {
    await this.db.terminate();
  }
}
