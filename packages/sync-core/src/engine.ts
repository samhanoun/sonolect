import { base64urlDecode, base64urlEncode } from "./encoding";
import {
  NoteTooLargeError,
  RecordUnreadableError,
  openRecord,
  sealRecord,
  sealedTag,
} from "./envelope";
import { SyncClosedError, SyncError } from "./errors";
import { type Hlc, HlcClock, compareHlc, hlcEquals, isHlc, toHlc } from "./hlc";
import {
  type RandomBytes,
  type VaultKeys,
  isSyncableNoteId,
  recordId,
} from "./keys";
import {
  InvalidPayloadError,
  NOTE_SCHEMA,
  type NotePayload,
  type SyncNote,
  conflictCopyId,
  noteFingerprint,
  parseSyncNote,
} from "./payload";
import {
  type FullResyncReason,
  type PendingFullResync,
  type RecordState,
  type SyncMeta,
  type SyncStateChange,
  type SyncStateStore,
  cloneMeta,
} from "./state";
import type { SyncTransport } from "./transport";
import {
  SYNC_ERROR_CODES,
  SYNC_LIMITS,
  type WireRecord,
  type WireWrite,
  type WireWriteResult,
} from "./wire";

/** Bumped when the engine learns to read records an older one could not. */
export const READER_VERSION = 1;

/** One local note as `NoteStore.list()` reports it: cheap, without the text. */
export interface LocalNoteSummary {
  id: string;
  /** The HLC stored with the note. Absent for a note last changed before sync was on. */
  hlc?: Hlc | undefined;
  /** When the note was created (ms): gives a note without an HLC its first one. */
  createdAtMs: number;
  /** When its content last changed (ms), if the app tracks it. */
  updatedAtMs?: number | undefined;
}

/** One local note as `NoteStore.read()` returns it. */
export interface LocalNote {
  note: SyncNote;
  hlc?: Hlc | undefined;
}

/** What the local note must still be for a remote change to be written. */
export type LocalExpectation =
  | { exists: false }
  /** It exists with this HLC (undefined: it has none). */
  | { exists: true; hlc: Hlc | undefined };

/** A change the engine asks the app to write. */
export interface RemoteChange {
  id: string;
  /** The version to store, or null to delete the note. */
  note: SyncNote | null;
  /** Store this HLC with the note. */
  hlc: Hlc;
  /** Compare-and-set: write only if the local note is still in this state. */
  expected: LocalExpectation;
}

/**
 * The app's note storage (capture files on desktop, AsyncStorage on the
 * phone). The engine never deletes or changes a note except through
 * `applyRemote`, and never infers a delete from a note's absence: local
 * retention removes notes without telling the engine.
 */
export interface NoteStore {
  /** Every note that should sync. Notes the app does not sync are left out. */
  list(): Promise<readonly LocalNoteSummary[]>;
  /** One note, or undefined when there is none. */
  read(id: string): Promise<LocalNote | undefined>;
  /**
   * Writes a remote version (or deletes the note when `note` is null) only
   * if the note still matches `expected` (see `localMatches`); returns false
   * and writes nothing otherwise. The app must keep every field of `note`,
   * including ones it does not know, and give them back from `read`.
   */
  applyRemote(change: RemoteChange): Promise<boolean>;
  /** Saves a new note: the losing side of a conflict. Overwrites an existing copy. */
  saveConflictCopy(id: string, note: SyncNote, hlc: Hlc): Promise<void>;
}

/** The compare-and-set test of `NoteStore.applyRemote`. */
export function localMatches(
  local: { hlc?: Hlc | undefined } | undefined,
  expected: LocalExpectation,
): boolean {
  if (!expected.exists) return local === undefined;
  return local !== undefined && hlcEquals(local.hlc, expected.hlc);
}

export interface SyncEngineOptions {
  keys: VaultKeys;
  transport: SyncTransport;
  notes: NoteStore;
  state: SyncStateStore;
  randomBytes: RandomBytes;
  /** Wall clock in ms (default Date.now). */
  now?: () => number;
  /**
   * True for a note this device's retention would delete. Such a note is
   * not imported (pass `isPastRetention` with the app's setting).
   */
  isExpired?: (note: SyncNote) => boolean;
}

/** What one sync run did. */
export interface SyncReport {
  /** Remote changes written to local notes. */
  pulled: number;
  /** Uploads the server accepted. */
  pushed: number;
  /** Ids of the conflict copies this run saved. */
  conflictCopies: string[];
  /** Records older than the version this device already has (a server rollback): ignored, and ours uploaded again. */
  refused: number;
  /** Records that do not open: tampered, sealed with another key, or malformed. */
  unreadable: number;
  /** Records written by a newer app version. */
  newerSchema: number;
  /** Notes whose current version is too large to sync. */
  tooLarge: string[];
  /** Notes whose id cannot sync. */
  skippedIds: string[];
  /** Notes that are not a valid note/1 (see `syncNote`). */
  invalid: string[];
  /** Remote notes not imported because local retention would delete them. */
  skippedExpired: number;
  /** The vault is full: the server refused uploads. */
  quotaExceeded: boolean;
  /** A note changed here while a remote change was being written: sync again soon. */
  deferred: boolean;
  /** Why this run made a full pass over the vault, or null. */
  full: FullResyncReason | null;
  /** This run created the vault on the server. */
  vaultCreated: boolean;
}

/** A delete the user made, as `recordDeletes` takes it. */
export interface LocalDelete {
  id: string;
  /** The note's HLC when it was deleted. */
  hlc?: Hlc | undefined;
  /**
   * When it was deleted: the HLC the app stamped at the time of the delete
   * (`stamp(hlc)`). Kept as it is when it is later than the note as this
   * device knows it, so an edit made elsewhere after the delete still wins.
   * Without it, the delete is dated when `recordDeletes` runs.
   */
  deletedAt?: Hlc | undefined;
  /**
   * The version of the note this device last synced, from
   * `pendingDeletesOf`. Used when this engine does not know the note (a
   * fresh state for the same vault), so that version is not mistaken for an
   * edit made elsewhere and kept as a conflict copy.
   */
  synced?: { hlc: Hlc; fp?: string | undefined } | undefined;
}

export interface SyncStatus {
  vaultId: string;
  deviceId: string;
  syncing: boolean;
  lastSyncAt: number | undefined;
  lastPullAt: number | undefined;
  lastFullSyncAt: number | undefined;
  /** Deletes the server has not confirmed yet. */
  pendingDeletes: number;
  /** A full pass that will run (or resume) on the next sync. */
  fullResyncPending: FullResyncReason | null;
  /** Records this device knows. */
  records: number;
}

export interface SyncEngine {
  readonly vaultId: string;
  /** Random per install and per vault. */
  readonly deviceId: string;
  /**
   * A new HLC for a local change (create, edit, refine, rename, pin), later
   * than `previous` (the note's current HLC) and than everything this device
   * has seen. Store it with the note.
   */
  stamp(previous?: Hlc): Hlc;
  /**
   * Records notes the user deleted, so the delete reaches the other devices.
   * Pass each note's HLC at the time of the delete, and when the app recorded
   * the delete earlier than now, the HLC it stamped then (`deletedAt`).
   * Saved before it resolves. Not for retention: a note that expires locally
   * is just left out.
   */
  recordDeletes(deletes: readonly LocalDelete[]): Promise<void>;
  /**
   * Pulls remote changes, then uploads local ones. Calls made while a run is
   * going are merged into one more run after it. Throws SyncError (check
   * `retryable` and `vaultGone`) or SyncClosedError.
   */
  sync(options?: { full?: boolean }): Promise<SyncReport>;
  status(): SyncStatus;
  /**
   * Deletes the vault and every record on the server, then forgets the
   * local sync state and closes. Other devices then get "this sync was
   * deleted" (SyncError kind "gone", code "vault_deleted"). If the server
   * call fails, it throws and nothing is forgotten.
   */
  deleteVault(): Promise<void>;
  /** Forgets the local sync state and closes; local notes are kept. */
  forget(): Promise<void>;
  /** Stops syncing and waits for pending saves; the state is kept. */
  close(): Promise<void>;
}

interface Candidate {
  id: string;
  rid: string;
  hlc: Hlc;
  deleted: boolean;
  baseRev: number;
}

interface Prepared extends Candidate {
  fp: string | undefined;
  write: WireWrite;
}

type Applied = "applied" | "skipped" | "unreadable" | "deferred";
type LocalIndex = Map<string, LocalNoteSummary>;

const PUSH_ROUNDS = 3;
/** Clock differences between this device and the server, for `expiredMayDelete`. */
const EXPIRED_SLACK_MS = 24 * 60 * 60_000;
/** JSON around each write's ciphertext: rid, baseRev, deleted, punctuation. */
const WRITE_OVERHEAD = 96;
/** Keeps a batch well under the request limit. */
const BATCH_BUDGET = SYNC_LIMITS.maxRequestBytes - 256 * 1024;

const emptyReport = (): SyncReport => ({
  pulled: 0,
  pushed: 0,
  conflictCopies: [],
  refused: 0,
  unreadable: 0,
  newerSchema: 0,
  tooLarge: [],
  skippedIds: [],
  invalid: [],
  skippedExpired: 0,
  quotaExceeded: false,
  deferred: false,
  full: null,
  vaultCreated: false,
});

const unique = (values: string[]) => [...new Set(values)];

/** A record the server does not hold (any more): revision 0, no tag. */
const unsent = (record: RecordState): RecordState => {
  const { tag: _tag, ...rest } = record;
  return { ...rest, rev: 0 };
};

const validHlc = (value: unknown): Hlc | undefined =>
  isHlc(value) ? toHlc(value) : undefined;

class Engine implements SyncEngine {
  readonly vaultId: string;
  readonly deviceId: string;
  private meta: SyncMeta;
  private readonly records: Map<string, RecordState>;
  private readonly clock: HlcClock;
  private readonly ridCache = new Map<string, string>();
  private changed = new Map<string, RecordState | null>();
  private saving: Promise<void> = Promise.resolve();
  private closed = false;
  private deleting = false;
  private running: Promise<SyncReport> | null = null;
  private queued: { full: boolean; promise: Promise<SyncReport> } | null = null;
  private readonly now: () => number;
  private readonly isExpired: (note: SyncNote) => boolean;

  constructor(
    private readonly options: SyncEngineOptions,
    meta: SyncMeta,
    records: Map<string, RecordState>,
  ) {
    this.meta = meta;
    this.records = records;
    this.vaultId = meta.vaultId;
    this.deviceId = meta.deviceId;
    this.now = options.now ?? (() => Date.now());
    this.isExpired = options.isExpired ?? (() => false);
    this.clock = new HlcClock(meta.deviceId, this.now, meta.clock);
  }

  // ---- public API ----

  stamp(previous?: Hlc): Hlc {
    return this.clock.tick(validHlc(previous));
  }

  async recordDeletes(deletes: readonly LocalDelete[]): Promise<void> {
    this.assertOpen();
    let changed = false;
    for (const { id, hlc, deletedAt, synced } of deletes) {
      if (!isSyncableNoteId(id)) continue;
      const rid = this.ridFor(id);
      const syncedHlc = synced ? validHlc(synced.hlc) : undefined;
      if (syncedHlc && !this.records.has(rid)) {
        // Known again as the version the server had: not uploaded from here
        // (revision 0) until the pull has seen it.
        this.setRecord(rid, {
          id,
          rev: 0,
          hlc: syncedHlc,
          deleted: false,
          ...(typeof synced?.fp === "string" ? { fp: synced.fp } : {}),
        });
        changed = true;
      }
      // Later than the note as this device knows it, here and on the server.
      let floor = this.records.get(rid)?.hlc;
      const given = validHlc(hlc);
      if (given && (!floor || compareHlc(given, floor) > 0)) floor = given;
      const existing = this.meta.pendingDeletes[id];
      const at = validHlc(deletedAt);
      if (at && (!floor || compareHlc(at, floor) > 0)) {
        // Stamped when the user deleted it: an edit made elsewhere after that
        // moment, but synced before this call, still wins.
        if (existing && compareHlc(existing, at) >= 0) continue;
        this.clock.observe(at);
        this.meta.pendingDeletes[id] = at;
      } else {
        if (existing && (!floor || compareHlc(existing, floor) > 0)) continue;
        this.meta.pendingDeletes[id] = this.clock.tick(floor);
      }
      changed = true;
    }
    if (changed) await this.persist();
  }

  sync(options: { full?: boolean } = {}): Promise<SyncReport> {
    if (this.closed || this.deleting)
      return Promise.reject(new SyncClosedError());
    const full = options.full === true;
    if (!this.running) {
      const run = this.run(full);
      this.running = run;
      void run.then(
        () => this.settle(run),
        () => this.settle(run),
      );
      return run;
    }
    if (this.queued) {
      this.queued.full ||= full;
      return this.queued.promise;
    }
    const queued = { full, promise: Promise.resolve(emptyReport()) };
    queued.promise = this.running
      .catch(() => undefined)
      .then(() => {
        if (this.queued === queued) this.queued = null;
        return this.sync({ full: queued.full });
      });
    this.queued = queued;
    return queued.promise;
  }

  status(): SyncStatus {
    return {
      vaultId: this.vaultId,
      deviceId: this.deviceId,
      syncing: this.running !== null,
      lastSyncAt: this.meta.lastSyncAt,
      lastPullAt: this.meta.lastPullAt,
      lastFullSyncAt: this.meta.lastFullSyncAt,
      pendingDeletes: Object.keys(this.meta.pendingDeletes).length,
      fullResyncPending: this.meta.fullResync?.reason ?? null,
      records: this.records.size,
    };
  }

  async deleteVault(): Promise<void> {
    this.assertOpen();
    this.deleting = true;
    try {
      await this.options.transport.deleteVault();
    } catch (error) {
      this.deleting = false;
      throw error;
    }
    await this.forget();
  }

  async forget(): Promise<void> {
    this.closed = true;
    const clear = () => this.options.state.clear();
    const result = this.saving.then(clear, clear);
    this.saving = result.catch(() => undefined);
    await result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.saving;
  }

  // ---- runs ----

  private settle(run: Promise<SyncReport>) {
    if (this.running === run) this.running = null;
  }

  private assertOpen() {
    if (this.closed || this.deleting) throw new SyncClosedError();
  }

  private async run(full: boolean): Promise<SyncReport> {
    const report = emptyReport();
    const now = this.now();
    const lastPull = this.meta.lastPullAt;
    if (full && !this.meta.fullResync)
      this.meta.fullResync = { reason: "requested", deleteAbsent: false };
    if (
      !this.meta.fullResync &&
      lastPull !== undefined &&
      now - lastPull > SYNC_LIMITS.fullResyncAfterMs
    )
      // Away for more than 90 days: tombstones of notes deleted meanwhile
      // may be gone, so a note the server no longer has was deleted.
      this.meta.fullResync = {
        reason: "stale",
        deleteAbsent: now - lastPull > SYNC_LIMITS.tombstoneTtlMs,
      };
    if (!this.meta.vaultCreated) {
      const { created, epoch } = await this.options.transport.createVault();
      report.vaultCreated = created;
      this.meta.vaultCreated = true;
      this.meta.epoch = epoch;
      await this.persist();
    }
    if (await this.pull(report)) await this.push(report);
    this.meta.lastSyncAt = this.now();
    await this.persist();
    report.conflictCopies = unique(report.conflictCopies);
    report.tooLarge = unique(report.tooLarge);
    report.skippedIds = unique(report.skippedIds);
    report.invalid = unique(report.invalid);
    return report;
  }

  // ---- pull ----

  /** Applies every remote change; false when it stopped early (deferred). */
  private async pull(report: SyncReport): Promise<boolean> {
    let recreated = false;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.pullPass(report);
      } catch (error) {
        let next: PendingFullResync | undefined;
        if (error instanceof SyncError && error.kind === "gone") {
          // The server purged tombstones this device has not seen, or it is
          // behind this device (restored from a backup, or the vault was
          // created again): start from seq 0.
          if (error.code === SYNC_ERROR_CODES.cursorExpired)
            next = this.expiredMayDelete()
              ? { reason: "expired", deleteAbsent: true }
              : { reason: "reset", deleteAbsent: false };
          else if (error.code === SYNC_ERROR_CODES.cursorReset)
            next = { reason: "reset", deleteAbsent: false };
        } else if (
          error instanceof SyncError &&
          error.kind === "unauthorized" &&
          error.status === 401 &&
          !recreated
        ) {
          // The server does not know the vault: it lost its data. Create the
          // vault again and upload everything. A deleted vault answers 410
          // and another key 409: both stay final.
          recreated = true;
          const { created, epoch } = await this.options.transport.createVault();
          report.vaultCreated ||= created;
          this.meta.epoch = epoch;
          next = { reason: "reset", deleteAbsent: false };
        }
        if (!next || attempt >= 3) throw error;
        const current = this.meta.fullResync;
        // A server that lost data may also be missing tombstones: when in
        // doubt, upload again rather than delete.
        this.meta.fullResync = current
          ? {
              reason: next.reason,
              deleteAbsent: current.deleteAbsent && next.deleteAbsent,
            }
          : next;
        await this.persist();
      }
    }
  }

  /**
   * Whether a 410 cursor_expired can mean that tombstones this device never
   * saw were purged. The server purges a tombstone only once it is older
   * than `tombstoneTtlMs`, and every tombstone after this device's cursor was
   * written after its last pull. A device that pulled more recently than
   * that cannot have missed one: the answer comes from a server that lost
   * data or does not tell the truth, and a note it leaves out is uploaded
   * again rather than deleted here.
   */
  private expiredMayDelete(): boolean {
    const lastPull = this.meta.lastPullAt;
    return (
      lastPull !== undefined &&
      this.now() - lastPull > SYNC_LIMITS.tombstoneTtlMs - EXPIRED_SLACK_MS
    );
  }

  private async pullPass(report: SyncReport): Promise<boolean> {
    const pending = this.meta.fullResync;
    if (pending) report.full = pending.reason;
    const seen = pending ? new Set<string>() : null;
    const local: { index: LocalIndex | null } = { index: null };
    let since = pending ? 0 : this.meta.cursor;
    let head = 0;
    for (;;) {
      const page = await this.options.transport.changes(
        since,
        SYNC_LIMITS.maxPageRecords,
      );
      if (this.meta.epoch !== undefined && page.epoch !== this.meta.epoch) {
        // The vault was created again: this device's cursor and revisions
        // belong to the vault the server lost.
        this.meta.epoch = page.epoch;
        throw new SyncError(
          "gone",
          "the sync server created this vault again",
          {
            code: SYNC_ERROR_CODES.cursorReset,
          },
        );
      }
      this.meta.epoch = page.epoch;
      if (page.head < this.meta.highSeq) {
        // The server is behind this device: it lost changes.
        if (!pending)
          throw new SyncError("gone", "the sync server is behind this device", {
            code: SYNC_ERROR_CODES.cursorReset,
          });
        if (pending.deleteAbsent || pending.reason !== "reset") {
          pending.reason = "reset";
          pending.deleteAbsent = false;
          report.full = "reset";
        }
      }
      head = page.head;
      let last = since;
      for (const record of page.records) {
        if (record.seq <= last)
          throw new SyncError(
            "server",
            "the sync server sent changes out of order",
          );
        seen?.add(record.rid);
        const outcome = await this.applyRecord(record, report, local);
        if (outcome === "deferred") {
          report.deferred = true;
          if (!pending) this.meta.cursor = last;
          await this.persist();
          return false;
        }
        last = record.seq;
      }
      since = last;
      if (!pending) this.meta.cursor = since;
      await this.persist();
      if (!page.hasMore) break;
      if (page.records.length === 0)
        throw new SyncError("server", "the sync server sent an empty page");
    }
    if (pending && seen) {
      await this.reconcileAbsent(seen, pending, report, local);
      this.meta.cursor = since;
      // A fresh baseline: the server's head may legitimately be lower now.
      this.meta.highSeq = Math.max(head, since);
      delete this.meta.fullResync;
      this.meta.lastFullSyncAt = this.now();
    } else {
      this.meta.highSeq = Math.max(this.meta.highSeq, head, since);
    }
    this.meta.lastPullAt = this.now();
    await this.persist();
    return true;
  }

  /** After a full pass: what to do with records the server no longer has. */
  private async reconcileAbsent(
    seen: Set<string>,
    { reason, deleteAbsent }: PendingFullResync,
    report: SyncReport,
    local: { index: LocalIndex | null },
  ): Promise<void> {
    for (const [rid, known] of [...this.records]) {
      if (seen.has(rid) || known.rev === 0) continue;
      if (!deleteAbsent) {
        if (known.deleted && reason !== "reset") {
          // A tombstone the service purged on schedule: every device that
          // synced since has applied it, and one away longer resyncs with
          // deletes. Uploading it again would only fill the vault.
          this.setRecord(rid, null);
          continue;
        }
        // The server lost it: upload this device's version again.
        this.setRecord(rid, { ...unsent(known), ahead: true });
        continue;
      }
      // Deleted elsewhere, and the tombstone already purged.
      const pendingDelete = this.meta.pendingDeletes[known.id];
      delete this.meta.pendingDeletes[known.id];
      const index = await this.localIndex(local);
      const summary = index.get(known.id);
      if (known.deleted || !summary) {
        this.setRecord(rid, null);
        continue;
      }
      const localHlc = this.summaryHlc(summary);
      if (!pendingDelete && compareHlc(localHlc, known.hlc) > 0) {
        // Edited here since: keep it and upload it again.
        this.setRecord(rid, unsent(known));
        continue;
      }
      this.assertOpen();
      const removed = await this.options.notes.applyRemote({
        id: known.id,
        note: null,
        hlc: known.hlc,
        expected: { exists: true, hlc: validHlc(summary.hlc) },
      });
      if (removed) {
        index.delete(known.id);
        report.pulled += 1;
        this.setRecord(rid, null);
      } else {
        // Changed while we looked: keep it.
        this.setRecord(rid, unsent(known));
      }
    }
  }

  /**
   * Applies one remote record. The rules, for a note with local state S
   * (the newest version this device applied or uploaded):
   *
   * - Older than S: refused (a server rolling the note back); ours is
   *   uploaded again.
   * - Newer than S, nothing changed here: written locally.
   * - Newer than S, and the note changed here too: the later HLC wins. The
   *   losing side is kept as a conflict copy when its text differs from the
   *   winner's and from S's (what both sides started from). A delete that
   *   loses to a newer edit brings the note back.
   */
  private async applyRecord(
    record: WireRecord,
    report: SyncReport,
    local: { index: LocalIndex | null },
  ): Promise<Applied> {
    const known = this.records.get(record.rid);
    const tag = sealedTag(record.ct);
    if (known?.tag === tag) {
      // The very record this device applied or uploaded: nothing to open.
      if (record.rev !== known.rev)
        this.setRecord(record.rid, { ...known, rev: record.rev });
      return "skipped";
    }
    if (
      known &&
      known.tag === undefined &&
      known.rev > 0 &&
      record.rev === known.rev
    )
      return "skipped";
    let remote: NotePayload;
    try {
      remote = openRecord(
        this.options.keys,
        record.rid,
        base64urlDecode(record.ct),
      );
    } catch (error) {
      if (error instanceof RecordUnreadableError && error.newerSchema)
        report.newerSchema += 1;
      else report.unreadable += 1;
      this.meta.unreadable += 1;
      return "unreadable";
    }
    const { id } = remote;
    this.ridCache.set(id, record.rid);
    if (known && compareHlc(remote.hlc, known.hlc) < 0) {
      report.refused += 1;
      this.setRecord(record.rid, {
        ...known,
        rev: record.rev,
        tag,
        ahead: true,
      });
      return "skipped";
    }
    if (known && hlcEquals(remote.hlc, known.hlc)) {
      // The same version under a new revision (uploaded again).
      const { ahead: _ahead, ...same } = known;
      this.setRecord(record.rid, { ...same, rev: record.rev, tag });
      return "skipped";
    }
    this.clock.observe(remote.hlc);
    const remoteFp = remote.note ? noteFingerprint(remote.note) : undefined;
    const accepted: RecordState = {
      id,
      rev: record.rev,
      hlc: toHlc(remote.hlc),
      deleted: remote.deleted,
      ...(remoteFp ? { fp: remoteFp } : {}),
      tag,
    };
    const index = await this.localIndex(local);
    const summary = index.get(id);
    const current = summary ? await this.options.notes.read(id) : undefined;
    const currentHlc = current ? validHlc(current.hlc) : undefined;
    const localHlc = current
      ? (currentHlc ?? this.summaryHlc(summary!))
      : undefined;
    const expected: LocalExpectation = current
      ? { exists: true, hlc: currentHlc }
      : { exists: false };
    const pendingDelete = this.meta.pendingDeletes[id];
    // On an honest server a record's revision only grows. Another record at
    // or below the revision this device knows means the server lost writes
    // (a restored backup): the version here may never have reached the
    // device that wrote this one, so it is treated as a concurrent change.
    const rewound =
      known !== undefined &&
      known.rev > 0 &&
      record.rev <= known.rev &&
      (current !== undefined || pendingDelete !== undefined);
    const changedHere =
      rewound ||
      pendingDelete !== undefined ||
      (localHlc !== undefined &&
        (!known || compareHlc(localHlc, known.hlc) > 0));

    const write = async (note: SyncNote | null): Promise<boolean> => {
      if (note === null && !current) return true;
      if (note !== null && !current && this.isExpired(note)) {
        report.skippedExpired += 1;
        return true;
      }
      this.assertOpen();
      const ok = await this.options.notes.applyRemote({
        id,
        note,
        hlc: toHlc(remote.hlc),
        expected,
      });
      if (!ok) return false;
      if (note) index.set(id, { id, hlc: toHlc(remote.hlc), createdAtMs: 0 });
      else index.delete(id);
      report.pulled += 1;
      return true;
    };

    if (!changedHere) {
      if (!(await write(remote.note ?? null))) return "deferred";
      this.setRecord(record.rid, accepted);
      return "applied";
    }

    // Both sides changed the note.
    const localNote = pendingDelete ? undefined : current!.note;
    const localVersion = pendingDelete ?? localHlc!;
    const localFp = localNote ? noteFingerprint(localNote) : undefined;
    const baseFp = known && !known.deleted && !rewound ? known.fp : undefined;
    const order = compareHlc(remote.hlc, localVersion);
    if (order === 0 && (localNote ? localFp === remoteFp : remote.deleted)) {
      // The same version on both sides.
      if (pendingDelete) delete this.meta.pendingDeletes[id];
      this.setRecord(record.rid, accepted);
      return "applied";
    }
    if (order >= 0) {
      // The remote version wins. Keep a local text it would erase, unless a
      // delete wins over a note this device never synced (a stale copy).
      if (
        localNote &&
        localFp !== remoteFp &&
        localFp !== baseFp &&
        (!remote.deleted || known !== undefined)
      )
        await this.saveCopy(id, localNote, localVersion, report, index);
      if (!(await write(remote.note ?? null))) return "deferred";
      if (pendingDelete) delete this.meta.pendingDeletes[id];
      this.setRecord(record.rid, accepted);
      return "applied";
    }
    // The local version wins and is uploaded over this revision. Keep a
    // remote text it replaces, unless this device wrote it.
    if (
      remote.note &&
      remoteFp !== localFp &&
      remoteFp !== baseFp &&
      remote.hlc.d !== this.deviceId
    )
      await this.saveCopy(id, remote.note, remote.hlc, report, index);
    this.setRecord(record.rid, accepted);
    return "applied";
  }

  private async saveCopy(
    id: string,
    note: SyncNote,
    loser: Hlc,
    report: SyncReport,
    index: LocalIndex,
  ): Promise<void> {
    const copyId = conflictCopyId(id, loser);
    const hlc = this.clock.tick();
    this.assertOpen();
    await this.options.notes.saveConflictCopy(
      copyId,
      { ...note, conflictOf: id },
      hlc,
    );
    index.set(copyId, { id: copyId, hlc, createdAtMs: 0 });
    report.conflictCopies.push(copyId);
  }

  // ---- push ----

  private async push(report: SyncReport): Promise<void> {
    const excluded = new Set<string>();
    for (let round = 0; round < PUSH_ROUNDS; round += 1) {
      const summaries = await this.options.notes.list();
      const index: LocalIndex = new Map(summaries.map((s) => [s.id, s]));
      const candidates = this.collect(summaries, report, excluded);
      if (candidates.length === 0) break;
      const outcome = await this.upload(candidates, index, report, excluded);
      if (outcome !== "again") break;
    }
  }

  /** Local versions the server does not have yet, deletes first. */
  private collect(
    summaries: readonly LocalNoteSummary[],
    report: SyncReport,
    excluded: Set<string>,
  ): Candidate[] {
    const deletes: Candidate[] = [];
    const notes: Candidate[] = [];
    const listed = new Set<string>();
    for (const summary of summaries) {
      const { id } = summary;
      if (!isSyncableNoteId(id)) {
        report.skippedIds.push(String(id));
        continue;
      }
      listed.add(id);
      if (this.meta.pendingDeletes[id]) continue;
      const rid = this.ridFor(id);
      if (excluded.has(rid)) continue;
      const known = this.records.get(rid);
      const hlc = this.summaryHlc(summary);
      if (known) {
        const order = compareHlc(hlc, known.hlc);
        if (order < 0 || (order === 0 && !known.ahead)) continue;
      }
      const large = this.meta.tooLarge[id];
      if (large && hlcEquals(large, hlc)) {
        report.tooLarge.push(id);
        continue;
      }
      notes.push({ id, rid, hlc, deleted: false, baseRev: known?.rev ?? 0 });
    }
    for (const id of Object.keys(this.meta.tooLarge))
      if (!listed.has(id)) delete this.meta.tooLarge[id];
    for (const [id, hlc] of Object.entries(this.meta.pendingDeletes)) {
      const rid = this.ridFor(id);
      const known = this.records.get(rid);
      if (!known) {
        // Never on the server (the pull just ran): nothing to delete there.
        // Kept while the note is still here, so it is not uploaded.
        if (!listed.has(id)) delete this.meta.pendingDeletes[id];
        continue;
      }
      if (known.deleted && !known.ahead && compareHlc(known.hlc, hlc) >= 0) {
        delete this.meta.pendingDeletes[id];
        continue;
      }
      if (!excluded.has(rid))
        deletes.push({ id, rid, hlc, deleted: true, baseRev: known.rev });
    }
    for (const [rid, known] of this.records) {
      if (
        !known.ahead ||
        excluded.has(rid) ||
        this.meta.pendingDeletes[known.id]
      )
        continue;
      if (known.deleted)
        deletes.push({
          id: known.id,
          rid,
          hlc: known.hlc,
          deleted: true,
          baseRev: known.rev,
        });
      else if (!listed.has(known.id)) {
        // Nothing here to upload (expired locally): leave the server as it is.
        const { ahead: _ahead, ...rest } = known;
        this.setRecord(rid, rest);
      }
    }
    return [...deletes, ...notes];
  }

  /** Seals and sends candidates in batches; "again" when another round may help. */
  private async upload(
    candidates: Candidate[],
    index: LocalIndex,
    report: SyncReport,
    excluded: Set<string>,
  ): Promise<"done" | "again" | "quota"> {
    let batch: Prepared[] = [];
    let bytes = 0;
    let again = false;
    for (const candidate of candidates) {
      const prepared = await this.prepare(candidate, report, excluded);
      if (!prepared) continue;
      const size = prepared.write.ct.length + WRITE_OVERHEAD;
      if (
        batch.length > 0 &&
        (batch.length >= SYNC_LIMITS.maxBatchWrites ||
          bytes + size > BATCH_BUDGET)
      ) {
        const outcome = await this.send(batch, index, report, excluded);
        if (outcome === "quota") return "quota";
        again ||= outcome === "again";
        batch = [];
        bytes = 0;
      }
      batch.push(prepared);
      bytes += size;
    }
    if (batch.length > 0) {
      const outcome = await this.send(batch, index, report, excluded);
      if (outcome === "quota") return "quota";
      again ||= outcome === "again";
    }
    return again ? "again" : "done";
  }

  private async prepare(
    candidate: Candidate,
    report: SyncReport,
    excluded: Set<string>,
  ): Promise<Prepared | null> {
    let payload: NotePayload;
    let fp: string | undefined;
    let hlc = candidate.hlc;
    if (candidate.deleted) {
      payload = { schema: NOTE_SCHEMA, id: candidate.id, hlc, deleted: true };
    } else {
      const current = await this.options.notes.read(candidate.id);
      if (!current) return null;
      hlc = validHlc(current.hlc) ?? hlc;
      let note: SyncNote;
      try {
        note = parseSyncNote(current.note);
      } catch (error) {
        if (!(error instanceof InvalidPayloadError)) throw error;
        report.invalid.push(candidate.id);
        excluded.add(candidate.rid);
        return null;
      }
      payload = {
        schema: NOTE_SCHEMA,
        id: candidate.id,
        hlc,
        deleted: false,
        note,
      };
      fp = noteFingerprint(note);
    }
    let ct: Uint8Array;
    try {
      ct = sealRecord(this.options.keys, payload, this.options.randomBytes).ct;
    } catch (error) {
      if (!(error instanceof NoteTooLargeError)) throw error;
      this.markTooLarge(candidate.id, hlc, report, excluded, candidate.rid);
      return null;
    }
    return {
      ...candidate,
      hlc,
      fp,
      write: {
        rid: candidate.rid,
        baseRev: candidate.baseRev,
        deleted: candidate.deleted,
        ct: base64urlEncode(ct),
      },
    };
  }

  private markTooLarge(
    id: string,
    hlc: Hlc,
    report: SyncReport,
    excluded: Set<string>,
    rid: string,
  ) {
    this.meta.tooLarge[id] = toHlc(hlc);
    report.tooLarge.push(id);
    excluded.add(rid);
  }

  private async send(
    batch: Prepared[],
    index: LocalIndex,
    report: SyncReport,
    excluded: Set<string>,
  ): Promise<"done" | "again" | "quota"> {
    let results: WireWriteResult[];
    try {
      results = await this.options.transport.putRecords(
        batch.map((p) => p.write),
      );
    } catch (error) {
      if (!(error instanceof SyncError) || error.kind !== "tooLarge")
        throw error;
      // Over the server's request limit: split the batch, or give up on a single note.
      if (batch.length === 1) {
        const only = batch[0]!;
        if (only.deleted) throw error;
        this.markTooLarge(only.id, only.hlc, report, excluded, only.rid);
        await this.persist();
        return "done";
      }
      const half = Math.ceil(batch.length / 2);
      const first = await this.send(
        batch.slice(0, half),
        index,
        report,
        excluded,
      );
      if (first === "quota") return "quota";
      const second = await this.send(
        batch.slice(half),
        index,
        report,
        excluded,
      );
      if (second === "quota") return "quota";
      return first === "again" || second === "again" ? "again" : "done";
    }
    let again = false;
    let quota = false;
    for (let i = 0; i < batch.length; i += 1) {
      const sent = batch[i]!;
      const result = results[i]!;
      if (result.status === "ok") {
        report.pushed += 1;
        this.meta.highSeq = Math.max(this.meta.highSeq, result.seq);
        this.setRecord(sent.rid, {
          id: sent.id,
          rev: result.rev,
          hlc: toHlc(sent.hlc),
          deleted: sent.deleted,
          ...(sent.fp ? { fp: sent.fp } : {}),
          tag: sealedTag(sent.write.ct),
        });
        if (sent.deleted) await this.afterDelete(sent, index);
        else delete this.meta.tooLarge[sent.id];
      } else if (result.status === "conflict") {
        again = true;
        if (result.current === null) {
          // The server no longer has the record: upload it as new.
          const known = this.records.get(sent.rid);
          if (known)
            this.setRecord(sent.rid, { ...unsent(known), ahead: true });
        } else {
          const outcome = await this.applyRecord(result.current, report, {
            index,
          });
          if (outcome === "unreadable") excluded.add(sent.rid);
          if (outcome === "deferred") report.deferred = true;
        }
      } else {
        quota = true;
        report.quotaExceeded = true;
      }
    }
    await this.persist();
    if (quota) return "quota";
    return again ? "again" : "done";
  }

  /** A delete the server accepted: forget it, and drop a local copy it supersedes. */
  private async afterDelete(sent: Prepared, index: LocalIndex): Promise<void> {
    const pending = this.meta.pendingDeletes[sent.id];
    if (pending && hlcEquals(pending, sent.hlc))
      delete this.meta.pendingDeletes[sent.id];
    const summary = index.get(sent.id);
    if (!summary || compareHlc(this.summaryHlc(summary), sent.hlc) >= 0) return;
    this.assertOpen();
    if (
      await this.options.notes.applyRemote({
        id: sent.id,
        note: null,
        hlc: sent.hlc,
        expected: { exists: true, hlc: validHlc(summary.hlc) },
      })
    )
      index.delete(sent.id);
  }

  // ---- helpers ----

  private ridFor(id: string): string {
    let rid = this.ridCache.get(id);
    if (rid === undefined) {
      rid = recordId(this.options.keys, id);
      this.ridCache.set(id, rid);
    }
    return rid;
  }

  /**
   * A note's HLC; a note without one gets min(its last change, the moment
   * sync started here), so an edit made elsewhere since then wins.
   */
  private summaryHlc(summary: LocalNoteSummary): Hlc {
    const stored = validHlc(summary.hlc);
    if (stored) return stored;
    const created = Number.isFinite(summary.createdAtMs)
      ? summary.createdAtMs
      : 0;
    const updated =
      summary.updatedAtMs !== undefined && Number.isFinite(summary.updatedAtMs)
        ? summary.updatedAtMs
        : 0;
    const t = Math.max(
      0,
      Math.min(Math.floor(Math.max(created, updated)), this.meta.startedAt),
    );
    return { t, c: 0, d: this.deviceId };
  }

  private async localIndex(local: {
    index: LocalIndex | null;
  }): Promise<LocalIndex> {
    if (!local.index)
      local.index = new Map(
        (await this.options.notes.list()).map((summary) => [
          summary.id,
          summary,
        ]),
      );
    return local.index;
  }

  private setRecord(rid: string, record: RecordState | null) {
    if (record) this.records.set(rid, record);
    else this.records.delete(rid);
    this.changed.set(rid, record);
  }

  /** Saves the meta and the records changed since the last save, in order. */
  private persist(): Promise<void> {
    if (this.closed) return Promise.reject(new SyncClosedError());
    this.meta.clock = toHlc(this.clock.last);
    const change: SyncStateChange = { meta: cloneMeta(this.meta) };
    if (this.changed.size > 0) {
      change.records = this.changed;
      this.changed = new Map();
    }
    const save = async () => {
      if (this.closed) throw new SyncClosedError();
      try {
        await this.options.state.save(change);
      } catch (error) {
        // Keep the records for the next save.
        for (const [rid, record] of change.records ?? [])
          if (!this.changed.has(rid)) this.changed.set(rid, record);
        throw error;
      }
    };
    const result = this.saving.then(save, save);
    this.saving = result.catch(() => undefined);
    return result;
  }
}

/**
 * The deletes a saved sync state has not uploaded yet, read without the
 * vault keys. For an app about to forget the state while the server copy
 * stays (sync turned off, or the notes cleared on this device only): it
 * keeps them, and hands them to `recordDeletes` of the next engine for the
 * same vault, so they still reach the other devices. Close the engine first.
 */
export async function pendingDeletesOf(
  state: SyncStateStore,
): Promise<{ vaultId: string; deletes: LocalDelete[] } | null> {
  const snapshot = await state.load();
  if (!snapshot) return null;
  const synced = new Map<string, RecordState>();
  for (const record of snapshot.records.values())
    if (!record.deleted && record.rev > 0) synced.set(record.id, record);
  return {
    vaultId: snapshot.meta.vaultId,
    deletes: Object.entries(snapshot.meta.pendingDeletes).map(
      ([id, deletedAt]) => {
        const known = synced.get(id);
        return {
          id,
          deletedAt: toHlc(deletedAt),
          ...(known
            ? {
                synced: {
                  hlc: toHlc(known.hlc),
                  ...(known.fp ? { fp: known.fp } : {}),
                },
              }
            : {}),
        };
      },
    ),
  };
}

/**
 * Opens the sync engine for one vault: loads (or creates) this device's
 * sync state. Nothing reaches the network until `sync()`.
 */
export async function openSyncEngine(
  options: SyncEngineOptions,
): Promise<SyncEngine> {
  const now = options.now ?? (() => Date.now());
  const { keys, state } = options;
  const snapshot = await state.load();
  let meta: SyncMeta;
  let records: Map<string, RecordState>;
  if (snapshot && snapshot.meta.vaultId === keys.vaultId) {
    meta = cloneMeta(snapshot.meta);
    records = snapshot.records;
    if (snapshot.damaged && !meta.fullResync)
      meta.fullResync = { reason: "repair", deleteAbsent: false };
    if (meta.reader < READER_VERSION) {
      if (meta.unreadable > 0 && !meta.fullResync)
        meta.fullResync = { reason: "upgrade", deleteAbsent: false };
      meta.unreadable = 0;
      meta.reader = READER_VERSION;
    }
  } else {
    if (snapshot) await state.clear();
    const deviceId = base64urlEncode(options.randomBytes(12));
    meta = {
      v: 1,
      vaultId: keys.vaultId,
      deviceId,
      clock: { t: 0, c: 0, d: deviceId },
      cursor: 0,
      highSeq: 0,
      vaultCreated: false,
      startedAt: Math.floor(now()),
      pendingDeletes: {},
      tooLarge: {},
      unreadable: 0,
      reader: READER_VERSION,
    };
    records = new Map();
    await state.save({ meta: cloneMeta(meta) });
  }
  return new Engine(options, meta, records);
}
