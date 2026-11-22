import {
  type Hlc,
  HlcClock,
  type HttpRequester,
  type LocalDelete,
  type NoteStore,
  type RandomBytes,
  SYNC_ERROR_CODES,
  SyncClosedError,
  type SyncEngine,
  type SyncReport,
  type SyncStateStore,
  createHttpTransport,
  deriveVaultKeys,
  generateRootKey,
  isPastRetention,
  isSyncError,
  openSyncEngine,
  pairingCodeGroups,
  pairingLink,
  pendingDeletesOf,
} from "@sonolect/sync-core";

import { type KeptDeletesStorage, createKeptDeletes } from "./keptDeletes";
import type { SyncKeyStore } from "./keyStore";
import { NotesChangedError } from "./noteStore";
import type { Timers } from "./timers";

/**
 * When the phone syncs, and what Settings shows about it.
 *
 * - It syncs at launch, each time the app comes back to the foreground,
 *   about 5 s after a local change, and every 2 minutes while it is open.
 * - A failure it can retry (offline, a server error) waits longer each
 *   time, up to 5 minutes; a rate limit waits as long as the server says,
 *   silently. Offline is shown in plain words, never as an alert.
 * - A refused key stops syncing until the next launch. A deleted vault
 *   turns sync off, keeping the notes.
 * - Nothing syncs while history is off or some notes could not be read.
 * - A delete made here reaches the other devices even when the vault is
 *   not open (yet), sync is turned off with the server copy kept, or the
 *   notes are cleared on this phone only: what no engine holds is kept
 *   (keptDeletes.ts) for the next engine of the same vault.
 *
 * Platform calls (storage, HTTP, timers, the clock, randomness) are passed
 * in, so the tests run it in Node with a fake clock (controller.test.ts).
 */

export const CHANGE_DELAY_MS = 5_000;
export const PERIODIC_MS = 2 * 60_000;
export const BACKOFF_BASE_MS = 15_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
const RATE_LIMIT_MIN_MS = 1_000;
const RATE_LIMIT_MAX_MS = 60 * 60_000;
/** The HLC device id of changes made while no vault is open. */
export const OFFLINE_DEVICE_ID = "local";

/** What went wrong, for the message Settings shows (messages.ts). */
export type SyncProblem =
  | "unauthorized"
  | "deleted"
  | "tooLarge"
  | "server"
  | "network"
  | "quotaExceeded"
  | "newerSchema";

/** Why nothing syncs for now. */
export type SyncPause = "historyOff" | "storage";

export interface SyncView {
  /** loading: the key is being read (or could not be read yet). */
  status: "loading" | "off" | "on";
  /** A sync run is going. */
  syncing: boolean;
  /** Turning on, joining or turning off. */
  busy: boolean;
  lastSyncAt: number | undefined;
  problem: SyncProblem | null;
  paused: SyncPause | null;
}

export interface SyncControllerOptions {
  /** HTTP to this build's sync server (transport.ts). */
  request: HttpRequester;
  keyStore: SyncKeyStore;
  state: SyncStateStore;
  /** Where deletes no open vault holds are kept (AsyncStorage). */
  kept: KeptDeletesStorage;
  notes: NoteStore;
  randomBytes: RandomBytes;
  now: () => number;
  timers: Timers;
  /** 0 to 1, for the backoff's jitter (default Math.random). */
  random?: () => number;
  /** Why nothing should sync now, or null. */
  paused: () => SyncPause | null;
  /** The phone's note retention: older notes are not imported. */
  retentionDays: () => number;
}

/** The result of joining a vault with a pairing code. */
export type JoinResult = "joined" | "alreadyJoined" | "otherVaultOn";

export interface Pairing {
  /** sonolect://sync/join?v=1&k=… for the QR code. */
  link: string;
  /** The typed code: 14 groups of 4 characters. */
  groups: string[];
}

const INITIAL_VIEW: SyncView = {
  status: "loading",
  syncing: false,
  busy: false,
  lastSyncAt: undefined,
  problem: null,
  paused: null,
};

/** The message a finished run leaves: a full vault, newer notes, a note too large. */
export function reportProblem(report: SyncReport): SyncProblem | null {
  if (report.quotaExceeded) return "quotaExceeded";
  if (report.newerSchema > 0) return "newerSchema";
  if (report.tooLarge.length > 0) return "tooLarge";
  return null;
}

export class SyncController {
  private engine: SyncEngine | null = null;
  private current: Promise<void> | null = null;
  private again = false;
  /** Bumped whenever the engine is opened or closed: older runs' results are dropped. */
  private generation = 0;
  private timer: unknown = null;
  private timerAt = Number.POSITIVE_INFINITY;
  /** No automatic run starts before this (backoff and rate limits). */
  private holdUntil = 0;
  private retryAfterUntil = 0;
  private failures = 0;
  /** The server refused the key: nothing runs until the next launch. */
  private refused = false;
  /** A local change since the last run started. */
  private dirty = false;
  private foreground = true;
  private stopped = false;
  private started = false;
  private actions: Promise<unknown> = Promise.resolve();
  private readonly offline: HlcClock;
  private readonly kept: ReturnType<typeof createKeptDeletes>;
  private viewState: SyncView = INITIAL_VIEW;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SyncControllerOptions) {
    this.offline = new HlcClock(OFFLINE_DEVICE_ID, options.now);
    this.kept = createKeptDeletes(options.kept);
  }

  // ---- what Settings reads ----

  view(): SyncView {
    return this.viewState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- lifecycle ----

  /** At launch: reads the key and syncs when there is one. */
  start(): Promise<void> {
    return this.exclusive(async () => {
      if (this.started || this.engine) return;
      await this.openFromKeyStore();
    });
  }

  /** The app came to the foreground (true) or left it (false). */
  setForeground(active: boolean): void {
    this.foreground = active;
    if (active) {
      if (!this.started) void this.start();
      // Back in the foreground, an offline phone tries again at once.
      this.failures = 0;
      this.holdUntil = this.retryAfterUntil;
      this.schedule(0);
    } else {
      this.cancelTimer();
      // A change made just before leaving goes out now.
      if (this.dirty) void this.run();
    }
  }

  /** Something that pauses sync may have changed (history on or off, storage read again). */
  refresh(): void {
    const paused = this.options.paused();
    this.update({ paused });
    if (!paused) this.schedule(0);
  }

  /** Stops every timer and closes the engine (the state is kept). */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const engine = this.detach();
    await engine?.close();
  }

  // ---- local changes ----

  /** A new HLC for a local change: from the vault's clock, or a local one while sync is off. */
  stamp(previous?: Hlc): Hlc {
    return this.engine
      ? this.engine.stamp(previous)
      : this.offline.tick(previous);
  }

  /** A note was created or changed here: sync in about 5 s. */
  noteChanged(): void {
    this.dirty = true;
    this.schedule(CHANGE_DELAY_MS);
  }

  /** Notes the user deleted (not retention): their deletes reach the other devices. */
  async recordDeletes(
    deletes: readonly { id: string; hlc?: Hlc | undefined }[],
  ): Promise<void> {
    const engine = this.engine;
    if (deletes.length === 0) return;
    if (!engine) {
      await this.keepWhileClosed(deletes);
      return;
    }
    // The engine records them before its first await: a run that starts
    // now does not upload these notes.
    const recorded = engine.recordDeletes(deletes);
    this.noteChanged();
    try {
      await recorded;
    } catch (error) {
      if (!(error instanceof SyncClosedError)) throw error;
    }
  }

  /**
   * The notes were deleted on this phone only (history turned off, or the
   * recovery screen): this device forgets what it knew, so they download
   * again once history is back on. Nothing is deleted elsewhere, but the
   * deletes the user made here before still reach the other devices.
   */
  notesClearedLocally(): Promise<void> {
    return this.exclusive(async () => {
      const engine = this.detach();
      if (!engine && this.viewState.status === "off") return;
      await engine?.close().catch(() => undefined);
      if (await this.keepStateDeletes())
        await this.options.state.clear().catch(() => undefined);
      await this.openFromKeyStore();
    });
  }

  // ---- what the user does in Settings ----

  /** Creates a vault with a new key. */
  turnOn(): Promise<void> {
    return this.exclusive(async () => {
      if (this.engine) return;
      await this.busy(async () => {
        await this.openNew(generateRootKey(this.options.randomBytes));
      });
    });
  }

  /** Joins the vault of a pairing code: the notes here are merged into it. */
  join(root: Uint8Array): Promise<JoinResult> {
    return this.exclusive(async () => {
      if (this.engine)
        return this.engine.vaultId === deriveVaultKeys(root).vaultId
          ? "alreadyJoined"
          : "otherVaultOn";
      await this.busy(() => this.openNew(root));
      return "joined";
    });
  }

  /** What joining with this key would answer now: null when it would join. */
  joinOutcome(root: Uint8Array): Exclude<JoinResult, "joined"> | null {
    const engine = this.engine;
    if (!engine) return null;
    return engine.vaultId === deriveVaultKeys(root).vaultId
      ? "alreadyJoined"
      : "otherVaultOn";
  }

  /** The pairing link and code of this phone's vault, read from the key store. */
  async pairing(): Promise<Pairing | null> {
    const engine = this.engine;
    if (!engine) return null;
    const root = await this.options.keyStore.load();
    if (!root || deriveVaultKeys(root).vaultId !== engine.vaultId) return null;
    return { link: pairingLink(root), groups: pairingCodeGroups(root) };
  }

  /**
   * Turns sync off on this phone; the notes stay. With deleteServerCopy,
   * the vault is deleted first and the other devices turn sync off too. A
   * failed delete throws (SyncError) and changes nothing.
   */
  turnOff(deleteServerCopy: boolean): Promise<void> {
    return this.exclusive(async () => {
      const engine = this.engine;
      if (!engine) return;
      await this.busy(async () => {
        if (deleteServerCopy) await this.forgetVault(engine, true);
        else await this.leaveVault(engine);
        this.update({
          status: "off",
          problem: null,
          lastSyncAt: undefined,
          syncing: false,
        });
        await this.options.keyStore.remove();
      });
    });
  }

  /**
   * Erase all data: forgets the key and the sync state, after deleting the
   * server copy when asked. A failed delete throws and erases nothing.
   * Keeping the server copy, it first tries once to upload the deletes
   * made here; nothing is kept on the phone.
   */
  eraseAll(deleteServerCopy: boolean): Promise<void> {
    return this.exclusive(async () => {
      const engine = this.engine;
      if (engine) {
        if (!deleteServerCopy) await this.pushDeletes(engine);
        await this.forgetVault(engine, deleteServerCopy);
      }
      this.detach();
      await this.options.state.clear().catch(() => undefined);
      await this.kept.clear().catch(() => undefined);
      await this.options.keyStore.remove().catch(() => undefined);
      this.started = true;
      this.update({ ...INITIAL_VIEW, status: "off" });
    });
  }

  // ---- internals ----

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.actions.then(action, action);
    this.actions = result.catch(() => undefined);
    return result;
  }

  private async busy<T>(action: () => Promise<T>): Promise<T> {
    this.update({ busy: true });
    try {
      return await action();
    } finally {
      this.update({ busy: false });
    }
  }

  private update(patch: Partial<SyncView>): void {
    const next = { ...this.viewState, ...patch };
    const keys = Object.keys(patch) as (keyof SyncView)[];
    if (keys.every((key) => next[key] === this.viewState[key])) return;
    this.viewState = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Opens the vault's engine, with the deletes kept for it. */
  private async openEngine(root: Uint8Array): Promise<SyncEngine> {
    const engine = await this.openSyncEngine(root);
    try {
      // Before its first run: a pull must not bring back a deleted note.
      await this.kept.take(engine.vaultId, (deletes) =>
        engine.recordDeletes(deletes),
      );
    } catch (error) {
      await engine.close().catch(() => undefined);
      throw error;
    }
    return engine;
  }

  private async openSyncEngine(root: Uint8Array): Promise<SyncEngine> {
    const keys = deriveVaultKeys(root);
    const { now } = this.options;
    return openSyncEngine({
      keys,
      transport: createHttpTransport(
        { request: this.options.request, vault: keys },
        now,
      ),
      notes: this.options.notes,
      state: this.options.state,
      randomBytes: this.options.randomBytes,
      now,
      isExpired: (note) =>
        isPastRetention(note, this.options.retentionDays(), now()),
    });
  }

  /** Reads the key; opens its vault, or shows sync off. A key that can't be read yet is tried again in the foreground. */
  private async openFromKeyStore(): Promise<void> {
    let root: Uint8Array | null;
    try {
      root = await this.options.keyStore.load();
    } catch {
      this.update({ status: "loading", problem: "server" });
      return;
    }
    if (!root) {
      this.started = true;
      this.update({ status: "off", syncing: false, lastSyncAt: undefined });
      return;
    }
    try {
      this.attach(await this.openEngine(root));
      this.started = true;
    } catch {
      this.update({ status: "loading", problem: "server" });
    }
  }

  /** A new or joined vault: a fresh sync state, then the key. */
  private async openNew(root: Uint8Array): Promise<void> {
    // An earlier vault's deletes wait for a rejoin of that vault.
    await this.keepStateDeletes();
    await this.options.state.clear();
    await this.options.keyStore.save(root);
    try {
      this.attach(await this.openEngine(root));
      this.started = true;
    } catch (error) {
      await this.options.keyStore.remove().catch(() => undefined);
      throw error;
    }
  }

  private attach(engine: SyncEngine): void {
    this.generation += 1;
    this.engine = engine;
    this.current = null;
    this.refused = false;
    this.failures = 0;
    this.holdUntil = 0;
    this.retryAfterUntil = 0;
    this.update({
      status: "on",
      problem: null,
      lastSyncAt: engine.status().lastSyncAt,
      paused: this.options.paused(),
    });
    this.schedule(0);
  }

  private detach(): SyncEngine | null {
    const engine = this.engine;
    this.generation += 1;
    this.engine = null;
    this.current = null;
    this.dirty = false;
    this.cancelTimer();
    this.update({ syncing: false });
    return engine;
  }

  /**
   * Keeps the deletes the saved sync state has not uploaded (no engine may
   * have it open). False when they could not be read or kept: the state
   * must then stay, with them.
   */
  private async keepStateDeletes(): Promise<boolean> {
    try {
      const pending = await pendingDeletesOf(this.options.state);
      if (pending) await this.kept.keep(pending.vaultId, pending.deletes);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes made while sync is on but its vault is not open (at launch, or
   * a key that cannot be read yet): kept for it, stamped now.
   */
  private async keepWhileClosed(
    deletes: readonly { id: string; hlc?: Hlc | undefined }[],
  ): Promise<void> {
    if (this.viewState.status === "off") return;
    const stamped: LocalDelete[] = deletes.map(({ id, hlc }) => ({
      id,
      ...(hlc ? { hlc } : {}),
      deletedAt: this.offline.tick(hlc),
    }));
    try {
      const vaultId = await this.options.keyStore.vaultId();
      if (!vaultId) return;
      await this.kept.keep(vaultId, stamped);
      // Opened meanwhile: it takes them now.
      const engine = this.engine;
      if (engine?.vaultId === vaultId) {
        await this.kept.take(vaultId, (kept) => engine.recordDeletes(kept));
        this.noteChanged();
      }
    } catch (error) {
      if (!(error instanceof SyncClosedError)) throw error;
    }
  }

  /** One last try to upload the deletes made here, before the vault is left. */
  private async pushDeletes(engine: SyncEngine): Promise<void> {
    if (engine.status().pendingDeletes === 0 || this.options.paused()) return;
    try {
      await engine.sync();
    } catch {
      // Those not uploaded are kept (turning off) or go (erase all).
    }
  }

  /**
   * Sync turned off with the server copy kept: one last try to upload the
   * deletes made here, then those not uploaded are kept for a rejoin of
   * this vault, and the state is forgotten.
   */
  private async leaveVault(engine: SyncEngine): Promise<void> {
    await this.pushDeletes(engine);
    this.detach();
    await engine.close().catch(() => undefined);
    // Not kept: the state stays with them, and the next turn on or join
    // keeps them first.
    if (await this.keepStateDeletes())
      await this.options.state.clear().catch(() => undefined);
  }

  /** Deletes the vault when asked (a failure throws), then forgets it here. */
  private async forgetVault(
    engine: SyncEngine,
    deleteServerCopy: boolean,
  ): Promise<void> {
    if (deleteServerCopy) {
      try {
        await engine.deleteVault();
      } catch (error) {
        // Nothing changed: sync stays on.
        if (isSyncError(error) && !error.vaultGone) throw error;
        // Gone already or refused, or deleted but the state not cleared.
      }
    }
    this.detach();
    await engine.forget().catch(() => undefined);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.options.timers.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = Number.POSITIVE_INFINITY;
  }

  /** A run in `delayMs`, or later while backing off; an earlier timer stays. */
  private schedule(delayMs: number): void {
    if (this.stopped || !this.engine || this.refused) return;
    const now = this.options.now();
    const due = Math.max(now + Math.max(0, delayMs), this.holdUntil);
    if (this.timer !== null && this.timerAt <= due) return;
    this.cancelTimer();
    this.timerAt = due;
    this.timer = this.options.timers.setTimeout(() => {
      this.timer = null;
      this.timerAt = Number.POSITIVE_INFINITY;
      void this.run();
    }, due - now);
  }

  private run(): Promise<void> {
    if (this.current) {
      this.again = true;
      return this.current;
    }
    const run = this.runOnce();
    this.current = run;
    void run.finally(() => {
      if (this.current !== run) return;
      this.current = null;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    });
    return run;
  }

  private async runOnce(): Promise<void> {
    const engine = this.engine;
    if (!engine || this.refused || this.stopped) return;
    const paused = this.options.paused();
    this.update({ paused });
    if (paused) return;
    // In the background only a pending change goes out.
    if (!this.foreground && !this.dirty) return;
    const generation = this.generation;
    this.dirty = false;
    this.update({ syncing: true });
    try {
      const report = await engine.sync();
      if (generation !== this.generation) return;
      this.failures = 0;
      this.update({
        syncing: false,
        lastSyncAt: engine.status().lastSyncAt,
        problem: reportProblem(report),
      });
      if (report.deferred || this.dirty) this.schedule(CHANGE_DELAY_MS);
      else if (this.foreground) this.schedule(PERIODIC_MS);
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ syncing: false });
      this.failed(engine, error);
    }
  }

  private failed(engine: SyncEngine, error: unknown): void {
    if (error instanceof SyncClosedError) return;
    if (error instanceof NotesChangedError) {
      this.schedule(CHANGE_DELAY_MS);
      return;
    }
    if (isSyncError(error)) {
      if (
        error.kind === "gone" &&
        error.code === SYNC_ERROR_CODES.vaultDeleted
      ) {
        void this.vaultDeleted(engine);
        return;
      }
      if (error.kind === "unauthorized") {
        this.refused = true;
        this.cancelTimer();
        this.update({ problem: "unauthorized" });
        return;
      }
      if (error.kind === "rateLimited") {
        const wait = Math.min(
          RATE_LIMIT_MAX_MS,
          Math.max(RATE_LIMIT_MIN_MS, error.retryAfterMs ?? 60_000),
        );
        this.retryAfterUntil = this.options.now() + wait;
        this.holdUntil = Math.max(this.holdUntil, this.retryAfterUntil);
        this.schedule(0);
        return;
      }
    }
    const problem: SyncProblem = !isSyncError(error)
      ? "server"
      : error.kind === "network"
        ? "network"
        : error.kind === "tooLarge"
          ? "tooLarge"
          : "server";
    this.failures += 1;
    const random = this.options.random ?? Math.random;
    const delay =
      Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.failures - 1)) *
      (0.5 + random() / 2);
    this.holdUntil = this.options.now() + delay;
    this.update({ problem });
    this.schedule(0);
  }

  /** Another device deleted the vault: sync turns off here, and the notes stay. */
  private vaultDeleted(engine: SyncEngine): Promise<void> {
    return this.exclusive(async () => {
      if (this.engine !== engine) return;
      this.detach();
      await engine.forget().catch(() => undefined);
      await this.options.keyStore.remove().catch(() => undefined);
      this.update({
        status: "off",
        problem: "deleted",
        lastSyncAt: undefined,
        syncing: false,
      });
    });
  }
}
