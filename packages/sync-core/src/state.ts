import { type Hlc, isHlc, toHlc } from "./hlc";
import { NOTE_ID_PATTERN } from "./keys";
import { EPOCH_PATTERN, RECORD_ID_PATTERN } from "./wire";

/** Why a full resync (a pass over the whole vault from seq 0) runs. */
export type FullResyncReason =
  /** Asked for by the app. */
  | "requested"
  /** This device had not synced for 60 days. */
  | "stale"
  /** The server purged tombstones this device had not seen (410 cursor_expired). */
  | "expired"
  /** The server is behind this device (410 cursor_reset, or its head is below our cursor). */
  | "reset"
  /** The saved sync state could not be read in full. */
  | "repair"
  /** This version can read records an older version could not. */
  | "upgrade";

export interface PendingFullResync {
  reason: FullResyncReason;
  /**
   * True: a record the server no longer has was deleted elsewhere and its
   * tombstone purged, so the local copy goes too (unless edited here since).
   * False: the server lost it, so the local copy is uploaded again.
   */
  deleteAbsent: boolean;
}

/** Device-wide sync state. */
export interface SyncMeta {
  v: 1;
  /** The vault this state belongs to; state for another vault is discarded. */
  vaultId: string;
  /** Random per install and per vault: the HLC tie-break. */
  deviceId: string;
  /** The latest HLC issued or observed. */
  clock: Hlc;
  /** Changes up to this server seq have been applied. */
  cursor: number;
  /**
   * The highest seq this device knows the server reached (its own uploads
   * included). A server whose head is below it lost changes.
   */
  highSeq: number;
  /** The vault epoch last seen; another epoch means the vault was created again. */
  epoch?: string;
  /** POST /v1/vaults has succeeded once. */
  vaultCreated: boolean;
  /** When this state was created: notes with no HLC get at most this time. */
  startedAt: number;
  /** Last run that pulled every change (ms). */
  lastPullAt?: number;
  /** Last run that finished (ms). */
  lastSyncAt?: number;
  /** Last completed full resync (ms). */
  lastFullSyncAt?: number;
  /** A full resync that has not completed yet; it restarts from seq 0. */
  fullResync?: PendingFullResync;
  /** Explicit deletes the server has not confirmed: note id -> HLC of the delete. */
  pendingDeletes: Record<string, Hlc>;
  /** Local versions too large to sync: note id -> HLC. Retried once the note changes. */
  tooLarge: Record<string, Hlc>;
  /** Records this engine version could not read (a newer one retries them). */
  unreadable: number;
  /** The reader version that counted `unreadable`. */
  reader: number;
}

/** What this device knows about one record (by rid). */
export interface RecordState {
  /** The note id (the rid is its HMAC). */
  id: string;
  /** The server revision last seen; 0 when the server has no record. */
  rev: number;
  /** The newest version applied or uploaded here. Older versions are refused. */
  hlc: Hlc;
  /** That version is a tombstone. */
  deleted: boolean;
  /** noteFingerprint of that version (absent for tombstones). */
  fp?: string;
  /** The server holds an older version than `hlc` (or none): upload ours. */
  ahead?: boolean;
  /** sealedTag of the record at `rev`: its echo is skipped without decrypting. */
  tag?: string;
}

export interface SyncStateSnapshot {
  meta: SyncMeta;
  /** By rid. */
  records: Map<string, RecordState>;
  /** True when part of the saved state could not be read. */
  damaged?: boolean;
}

/** An incremental save: the meta when it changed, and the records that changed (null: forget). */
export interface SyncStateChange {
  meta?: SyncMeta;
  records?: ReadonlyMap<string, RecordState | null>;
}

/**
 * Persistent sync state, one per device (and vault). The engine loads it once
 * when it opens, then saves only what changed: after each page of changes
 * and each batch of uploads. Saves must be applied in call order.
 */
export interface SyncStateStore {
  /** The saved state, or null when there is none. */
  load(): Promise<SyncStateSnapshot | null>;
  save(change: SyncStateChange): Promise<void>;
  /** Forgets everything (sync turned off, or erase all). */
  clear(): Promise<void>;
}

export const cloneMeta = (meta: SyncMeta): SyncMeta => ({
  ...meta,
  clock: toHlc(meta.clock),
  pendingDeletes: { ...meta.pendingDeletes },
  tooLarge: { ...meta.tooLarge },
  ...(meta.fullResync ? { fullResync: { ...meta.fullResync } } : {}),
});

const cloneRecord = (record: RecordState): RecordState => ({
  ...record,
  hlc: toHlc(record.hlc),
});

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isOptionalCount = (value: unknown) =>
  value === undefined || isCount(value);

function readHlcMap(value: unknown): Record<string, Hlc> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const out: Record<string, Hlc> = {};
  for (const [id, hlc] of Object.entries(value)) {
    if (!NOTE_ID_PATTERN.test(id) || !isHlc(hlc)) return null;
    out[id] = toHlc(hlc);
  }
  return out;
}

/** Checks saved meta; null when it is not a valid v1 meta. */
export function parseMeta(value: unknown): SyncMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  const pendingDeletes = readHlcMap(meta.pendingDeletes);
  const tooLarge = readHlcMap(meta.tooLarge);
  if (
    meta.v !== 1 ||
    typeof meta.vaultId !== "string" ||
    typeof meta.deviceId !== "string" ||
    !isHlc(meta.clock) ||
    !isCount(meta.cursor) ||
    !isCount(meta.highSeq) ||
    (meta.epoch !== undefined &&
      (typeof meta.epoch !== "string" || !EPOCH_PATTERN.test(meta.epoch))) ||
    typeof meta.vaultCreated !== "boolean" ||
    !isCount(meta.startedAt) ||
    !isOptionalCount(meta.lastPullAt) ||
    !isOptionalCount(meta.lastSyncAt) ||
    !isOptionalCount(meta.lastFullSyncAt) ||
    !pendingDeletes ||
    !tooLarge ||
    !isCount(meta.unreadable) ||
    !isCount(meta.reader)
  )
    return null;
  let fullResync: PendingFullResync | undefined;
  if (meta.fullResync !== undefined) {
    const full = meta.fullResync as Partial<PendingFullResync> | null;
    if (
      !full ||
      typeof full.deleteAbsent !== "boolean" ||
      !["requested", "stale", "expired", "reset", "repair", "upgrade"].includes(
        full.reason as string,
      )
    )
      return null;
    fullResync = { reason: full.reason!, deleteAbsent: full.deleteAbsent };
  }
  return {
    v: 1,
    vaultId: meta.vaultId,
    deviceId: meta.deviceId,
    clock: toHlc(meta.clock),
    cursor: meta.cursor,
    highSeq: meta.highSeq,
    ...(meta.epoch !== undefined ? { epoch: meta.epoch as string } : {}),
    vaultCreated: meta.vaultCreated,
    startedAt: meta.startedAt,
    ...(meta.lastPullAt !== undefined
      ? { lastPullAt: meta.lastPullAt as number }
      : {}),
    ...(meta.lastSyncAt !== undefined
      ? { lastSyncAt: meta.lastSyncAt as number }
      : {}),
    ...(meta.lastFullSyncAt !== undefined
      ? { lastFullSyncAt: meta.lastFullSyncAt as number }
      : {}),
    ...(fullResync ? { fullResync } : {}),
    pendingDeletes,
    tooLarge,
    unreadable: meta.unreadable,
    reader: meta.reader,
  };
}

/** A record as a compact array: [id, rev, t, c, d, deleted, fp, ahead, tag]. */
type PackedRecord = [
  string,
  number,
  number,
  number,
  string,
  0 | 1,
  string,
  0 | 1,
  string,
];

const packRecord = (record: RecordState): PackedRecord => [
  record.id,
  record.rev,
  record.hlc.t,
  record.hlc.c,
  record.hlc.d,
  record.deleted ? 1 : 0,
  record.fp ?? "",
  record.ahead ? 1 : 0,
  record.tag ?? "",
];

function unpackRecord(value: unknown): RecordState | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const [id, rev, t, c, d, deleted, fp, ahead, tag] = value as unknown[];
  const hlc = { t, c, d };
  if (
    typeof id !== "string" ||
    !NOTE_ID_PATTERN.test(id) ||
    !isCount(rev) ||
    !isHlc(hlc) ||
    (deleted !== 0 && deleted !== 1) ||
    typeof fp !== "string" ||
    (ahead !== 0 && ahead !== 1) ||
    typeof tag !== "string"
  )
    return null;
  return {
    id,
    rev,
    hlc: toHlc(hlc),
    deleted: deleted === 1,
    ...(fp ? { fp } : {}),
    ...(ahead === 1 ? { ahead: true } : {}),
    ...(tag ? { tag } : {}),
  };
}

/** Sync state in memory: for tests, and for a device that must not persist it. */
export function createMemoryStateStore(): SyncStateStore & {
  snapshot(): SyncStateSnapshot | null;
} {
  let meta: SyncMeta | null = null;
  let records = new Map<string, RecordState>();
  return {
    async load() {
      return meta
        ? {
            meta: cloneMeta(meta),
            records: new Map(
              [...records].map(([rid, record]) => [rid, cloneRecord(record)]),
            ),
          }
        : null;
    },
    async save(change) {
      if (change.meta) meta = cloneMeta(change.meta);
      for (const [rid, record] of change.records ?? [])
        if (record) records.set(rid, cloneRecord(record));
        else records.delete(rid);
    },
    async clear() {
      meta = null;
      records = new Map();
    },
    snapshot() {
      return meta ? { meta: cloneMeta(meta), records: new Map(records) } : null;
    },
  };
}

/** The subset of AsyncStorage (or a wrapped localStorage) the key-value store needs. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet?(
    keys: readonly string[],
  ): Promise<readonly (readonly [string, string | null | undefined])[]>;
}

const BUCKET_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Sync state in a key-value store such as AsyncStorage: `<prefix>meta`, and
 * the per-record state in 64 buckets `<prefix>r.<first rid character>`, so a
 * save rewrites only the buckets that changed and no value grows past a few
 * tens of kilobytes even with 20,000 notes.
 */
export function createKeyValueStateStore(
  kv: KeyValueStorage,
  prefix = "sonolect.sync.",
): SyncStateStore {
  const metaKey = `${prefix}meta`;
  const bucketKey = (char: string) => `${prefix}r.${char}`;
  const bucketKeys = [...BUCKET_CHARS].map(bucketKey);
  let buckets: Map<string, Map<string, RecordState>> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  const readAll = async (): Promise<(string | null | undefined)[]> => {
    const keys = [metaKey, ...bucketKeys];
    if (kv.multiGet) {
      const pairs = await kv.multiGet(keys);
      const byKey = new Map(pairs.map(([key, value]) => [key, value]));
      return keys.map((key) => byKey.get(key));
    }
    const values: (string | null | undefined)[] = [];
    for (const key of keys) values.push(await kv.getItem(key));
    return values;
  };

  const load = async (): Promise<SyncStateSnapshot | null> => {
    const [rawMeta, ...rawBuckets] = await readAll();
    buckets = new Map();
    if (rawMeta === null || rawMeta === undefined) return null;
    let meta: SyncMeta | null = null;
    try {
      meta = parseMeta(JSON.parse(rawMeta));
    } catch {
      meta = null;
    }
    if (!meta) return null;
    const records = new Map<string, RecordState>();
    let damaged = false;
    rawBuckets.forEach((raw, index) => {
      const char = BUCKET_CHARS[index]!;
      const bucket = new Map<string, RecordState>();
      buckets!.set(char, bucket);
      if (raw === null || raw === undefined) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        damaged = true;
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        damaged = true;
        return;
      }
      for (const [rid, packed] of Object.entries(parsed)) {
        const record = unpackRecord(packed);
        if (!record || !RECORD_ID_PATTERN.test(rid) || rid[0] !== char) {
          damaged = true;
          continue;
        }
        bucket.set(rid, record);
        records.set(rid, record);
      }
    });
    return { meta, records, ...(damaged ? { damaged } : {}) };
  };

  const save = async (change: SyncStateChange) => {
    if (!buckets) await load();
    if (change.records) {
      const touched = new Set<string>();
      for (const [rid, record] of change.records) {
        const char = rid[0]!;
        let bucket = buckets!.get(char);
        if (!bucket) buckets!.set(char, (bucket = new Map()));
        if (record) bucket.set(rid, cloneRecord(record));
        else bucket.delete(rid);
        touched.add(char);
      }
      for (const char of touched) {
        const bucket = buckets!.get(char)!;
        if (bucket.size === 0) await kv.removeItem(bucketKey(char));
        else
          await kv.setItem(
            bucketKey(char),
            JSON.stringify(
              Object.fromEntries(
                [...bucket].map(([rid, r]) => [rid, packRecord(r)]),
              ),
            ),
          );
      }
    }
    if (change.meta) await kv.setItem(metaKey, JSON.stringify(change.meta));
  };

  const clear = async () => {
    for (const key of [metaKey, ...bucketKeys]) await kv.removeItem(key);
    buckets = new Map();
  };

  return {
    load: () => serialized(load),
    save: (change) => serialized(() => save(change)),
    clear: () => serialized(clear),
  };
}
