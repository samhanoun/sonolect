/**
 * Runs note sync on desktop: turns it on, joins another device's vault,
 * turns it off, and decides when the engine syncs.
 *
 * - At start (when a sync key is saved), about 5 s after a note changes
 *   here, every 60 s while the window has focus, and on "Sync now".
 * - On a rate limit it waits as long as the server asks, saying nothing.
 *   When the server fails or the network is gone it retries with growing,
 *   spread-out delays, and says so in one line in the Sync settings only.
 * - When another device deleted the vault, it forgets the sync key and the
 *   sync state and keeps the notes ("This sync was deleted"). When the server
 *   refuses the key, it stops and waits for the user to turn sync off.
 *
 * The sync key lives in the OS keychain; the engine gets it only to derive
 * the vault keys. Nothing here logs: no key, token or note ever reaches a
 * console.
 */
import {
  type Hlc,
  type LocalDelete,
  type NoteStore,
  type QrMatrix,
  READER_VERSION,
  SYNC_ERROR_CODES,
  SyncClosedError,
  type SyncEngine,
  type SyncEngineOptions,
  SyncError,
  type SyncReport,
  base64urlDecode,
  base64urlEncode,
  deriveVaultKeys,
  generateRootKey,
  isPastRetention,
  openSyncEngine,
  pairingCode,
  pairingCodeGroups,
  pairingLink,
  parsePairing,
  pendingDeletesOf,
  qrMatrix,
} from "@sonolect/sync-core";

import { createDesktopNoteStore } from "./desktopNotes";
import { createDesktopStateStore } from "./desktopState";
import { createDesktopTransport } from "./desktopTransport";
import {
  type PreferenceStorage,
  type SyncPlatform,
  nativeError,
} from "./platform";

/** A sync after a note changed here waits this long, so edits travel together. */
export const LOCAL_CHANGE_DELAY_MS = 5_000;
/** While the window has focus, a sync runs at least this often. */
export const FOCUSED_INTERVAL_MS = 60_000;
/** A note changed while a remote change was being written: sync again soon. */
export const DEFERRED_DELAY_MS = 2_000;
/** Retries after a failure wait this long, doubling up to RETRY_MAX_MS (±25 %). */
export const RETRY_BASE_MS = 10_000;
export const RETRY_MAX_MS = 5 * 60_000;
/** A rate limit without Retry-After waits this long. */
const RATE_LIMIT_MS = 60_000;

/** Remembers that notes from a newer app version were seen, per reader version. */
export const NEWER_SCHEMA_KEY = "sonolect.sync.newerSchema";

/** Why sync is not working right now. */
export type SyncProblem =
  /** The server does not accept this key: offer to turn sync off. */
  | { kind: "unauthorized" }
  /** Another device deleted the server copy; sync is off, the notes stay. */
  | { kind: "deleted" }
  /** The server refused a request for its size. */
  | { kind: "tooLarge" }
  /** The server failed or answered something this version does not read. */
  | { kind: "server" }
  /** No answer: offline, or the server cannot be reached. */
  | { kind: "offline" }
  /** Something on this device failed: the keychain, or the sync files. */
  | { kind: "device"; detail: string };

/** Lasting facts about the vault, shown until a sync no longer finds them. */
export interface SyncNotices {
  /** The vault is full: new notes are not uploaded. */
  quotaExceeded: boolean;
  /** A note is too large to sync. */
  tooLarge: boolean;
  /** A newer app version wrote notes this one cannot read. */
  newerSchema: boolean;
}

export interface SyncView {
  /** This build has a sync server (`sync_config`). Without one sync is invisible. */
  available: boolean;
  /** The server's host, for the settings. */
  server: string | undefined;
  /** "loading" until the saved key was looked up. */
  phase: "loading" | "off" | "on";
  syncing: boolean;
  /** When the last sync finished (ms). */
  lastSyncAt: number | undefined;
  problem: SyncProblem | undefined;
  notices: SyncNotices;
}

/** What the "Show code" screen shows. */
export interface SyncPairing {
  /** The typed code, in groups of 4 joined by dashes. */
  code: string;
  groups: string[];
  /** The link in the QR code. */
  link: string;
  qr: QrMatrix;
}

export interface SyncControllerOptions {
  platform: SyncPlatform;
  /** The local retention setting in days (0 keeps everything). */
  retentionDays: () => number;
  /** The engine wrote, deleted or copied local notes: refresh the library. */
  onNotesChanged?: () => void;
  /** Where the newer-version notice is remembered. */
  storage?: PreferenceStorage | undefined;
  /** Opens the engine (tests wrap sync-core's `openSyncEngine`). */
  openEngine?:
    ((options: SyncEngineOptions) => Promise<SyncEngine>) | undefined;
}

const NO_NOTICES: SyncNotices = {
  quotaExceeded: false,
  tooLarge: false,
  newerSchema: false,
};

const INITIAL_VIEW: SyncView = {
  available: false,
  server: undefined,
  phase: "loading",
  syncing: false,
  lastSyncAt: undefined,
  problem: undefined,
  notices: NO_NOTICES,
};

interface SyncConfig {
  available: boolean;
  server?: string;
}

const isConfig = (value: unknown): value is SyncConfig =>
  typeof value === "object" &&
  value !== null &&
  (value as SyncConfig).available === true;

/** A delete made here that the engine has not recorded yet (sync.rs `PendingDelete`). */
interface PendingDelete {
  id: string;
  hlc?: Hlc;
  /** When the user deleted the note. */
  deletedAt?: Hlc;
  /** The version the engine last synced, for a delete kept while sync was off. */
  synced?: { hlc: Hlc; fp?: string };
  /** Kept when sync was turned off: only an engine for this vault takes it. */
  vault?: string;
}

export class SyncController {
  private view: SyncView = INITIAL_VIEW;
  private readonly listeners = new Set<() => void>();
  private readonly platform: SyncPlatform;
  private readonly openEngine: (
    options: SyncEngineOptions,
  ) => Promise<SyncEngine>;
  private engine: SyncEngine | null = null;
  /** The next run; `interval` when only the focused interval asked for it. */
  private timer: { handle: unknown; due: number; interval: boolean } | null =
    null;
  /** No sync before this time (a backoff or a rate limit). */
  private retryAt = 0;
  private failures = 0;
  /** The run in flight. */
  private current: Promise<void> | null = null;
  private again = false;
  /** The server refused the key: no sync until the user acts. */
  private halted = false;
  /** Turning off or forgetting: no sync meanwhile. */
  private stopping = false;
  private focused = false;
  private closed = false;
  private lastRunAt: number | undefined;
  private started: Promise<void> | null = null;
  private actions: Promise<unknown> = Promise.resolve();
  /** The engine wrote, deleted or copied a local note in the run in flight. */
  private notesTouched = false;

  constructor(private readonly options: SyncControllerOptions) {
    this.platform = options.platform;
    this.openEngine = options.openEngine ?? openSyncEngine;
  }

  // ---- state for the interface ----

  getView = (): SyncView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(change: Partial<SyncView>) {
    this.view = { ...this.view, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  // ---- what the user does ----

  /** Looks up the build's server and the saved key; syncs when there is one. */
  start(): Promise<void> {
    this.started ??= this.exclusive(() => this.boot());
    return this.started;
  }

  /** Turns sync on with a new vault. Throws the native message on failure. */
  turnOn(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.view.available || this.view.phase === "on") return;
      const key = base64urlEncode(generateRootKey(this.platform.randomBytes));
      await this.call("sync_key_create", { key });
      await this.leaveEarlierState();
      this.switchedOn();
    });
  }

  /**
   * Joins the vault of a pairing link or typed code. Throws PairingError for
   * text that is not a valid code, or the native message on failure. The
   * notes on this device join the vault too.
   */
  join(text: string): Promise<void> {
    return this.exclusive(async () => {
      if (!this.view.available || this.view.phase === "on") return;
      const key = base64urlEncode(parsePairing(text));
      await this.call("sync_key_import", { key });
      await this.leaveEarlierState();
      this.switchedOn();
    });
  }

  /**
   * Once the new key is saved: forgets the state of an earlier vault, if
   * any, keeping the deletes it had not uploaded for that vault. The key is
   * saved first, so a keychain that fails leaves the earlier state (and its
   * deletes) as it was. Should the state not be forgotten, the new key is,
   * and sync stays off.
   */
  private async leaveEarlierState() {
    try {
      await this.forgetStateKeepingDeletes();
    } catch (error) {
      try {
        await this.call("sync_key_forget");
      } catch {
        // The error below says what failed first.
      }
      throw error;
    }
  }

  /** The code and QR code for another device, read from the keychain on demand. */
  async pairing(): Promise<SyncPairing | null> {
    const key = await this.call<string | null>("sync_key_load");
    if (!key) return null;
    const root = base64urlDecode(key);
    const link = pairingLink(root);
    return {
      code: pairingCode(root),
      groups: pairingCodeGroups(root),
      link,
      qr: qrMatrix(link),
    };
  }

  /**
   * Turns sync off. With `deleteServerCopy`, deletes the vault on the
   * server first: the other devices then see "This sync was deleted" and
   * keep their notes. If that fails it throws and sync stays on. The notes
   * on this device always stay.
   */
  turnOff(options: { deleteServerCopy: boolean }): Promise<void> {
    return this.exclusive(async () => {
      if (this.view.phase !== "on") return;
      this.stopping = true;
      this.cancelTimer();
      try {
        if (options.deleteServerCopy) {
          // A run in flight may be opening the engine: let it end first.
          if (!this.engine) await this.settled();
          const engine = this.engine ?? (await this.ensureEngine(true));
          // Once the vault is gone the engine is closed, and a run still in
          // flight can no longer change a note or the state.
          if (engine) await engine.deleteVault();
        } else {
          // The server copy stays: deletes made here must still reach it.
          await this.pushDeletes();
          await this.forgetStateKeepingDeletes();
        }
      } catch (error) {
        this.stopping = false;
        this.schedule(0);
        throw error instanceof SyncError ? error : nativeError(error);
      }
      this.engine = null;
      let problem: SyncProblem | undefined;
      try {
        await this.call("sync_key_forget");
      } catch (error) {
        problem = { kind: "device", detail: nativeError(error).message };
      }
      this.stopping = false;
      this.switchedOff(problem);
    });
  }

  /**
   * For "Delete all local data": forgets the sync key and the sync state
   * (the server copy stays unless `turnOff` deleted it first). The key is
   * forgotten even when the state could not be, and sync is off here even
   * when the keychain could not delete the key; the first failure is thrown.
   */
  forgetLocal(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.view.available) return;
      this.stopping = true;
      this.cancelTimer();
      let failure: Error | undefined;
      // The notes here go, but deletes made here still reach the others.
      if (this.view.phase === "on") await this.pushDeletes();
      try {
        await this.forgetState();
      } catch (error) {
        failure = nativeError(error);
      }
      try {
        await this.call("sync_key_forget");
      } catch (error) {
        failure ??= nativeError(error);
      }
      this.stopping = false;
      this.switchedOff(undefined);
      if (failure) throw failure;
    });
  }

  /** "Sync now": runs at once, whatever the backoff. */
  syncNow() {
    this.halted = false;
    this.retryAt = 0;
    this.failures = 0;
    this.schedule(0);
  }

  /** A note was created, changed or deleted on this device. */
  localChange() {
    this.schedule(LOCAL_CHANGE_DELAY_MS);
  }

  /** The window gained or lost focus. */
  setFocused(focused: boolean) {
    this.focused = focused;
    if (!focused) {
      if (this.timer?.interval) this.cancelTimer();
      return;
    }
    // A run in progress schedules the next one when it ends.
    if (this.current) return;
    const since =
      this.lastRunAt === undefined
        ? Infinity
        : this.platform.now() - this.lastRunAt;
    this.schedule(Math.max(0, FOCUSED_INTERVAL_MS - since), true);
  }

  /** The network is back: retry now instead of waiting for the backoff. */
  online() {
    if (this.view.problem?.kind !== "offline") return;
    this.retryAt = 0;
    this.failures = 0;
    this.schedule(0);
  }

  /** Resolves once no action and no sync is in flight. */
  async idle(): Promise<void> {
    await this.actions;
    await this.settled();
  }

  /** Stops syncing (the window closes); the state and the key stay. */
  async close(): Promise<void> {
    this.closed = true;
    this.cancelTimer();
    await this.engine?.close();
  }

  // ---- lifecycle ----

  private async boot() {
    let config: unknown;
    try {
      config = await this.platform.invoke("sync_config");
    } catch {
      config = null;
    }
    if (!isConfig(config)) {
      this.update({ available: false, phase: "off" });
      return;
    }
    this.update({
      available: true,
      server: typeof config.server === "string" ? config.server : undefined,
      notices: { ...NO_NOTICES, newerSchema: this.newerSchemaSeen() },
    });
    let key: string | null;
    try {
      key = await this.call<string | null>("sync_key_load");
    } catch (error) {
      // Sync is on here (the keychain is asked only then), but the key
      // cannot be read yet: a locked keychain, say. It stays on and tries
      // again, and "Turn off" stays offered; turning on or joining would
      // put another key over this one.
      this.update({
        phase: "on",
        problem: { kind: "device", detail: nativeError(error).message },
      });
      const delay = this.backoff();
      this.retryAt = this.platform.now() + delay;
      this.schedule(delay);
      return;
    }
    if (!key) {
      this.update({ phase: "off" });
      return;
    }
    this.update({ phase: "on" });
    this.schedule(0);
  }

  private switchedOn() {
    this.halted = false;
    this.retryAt = 0;
    this.failures = 0;
    this.lastRunAt = undefined;
    this.update({
      phase: "on",
      problem: undefined,
      lastSyncAt: undefined,
      notices: { ...NO_NOTICES, newerSchema: this.newerSchemaSeen() },
    });
    this.schedule(0);
  }

  private switchedOff(problem: SyncProblem | undefined) {
    this.engine = null;
    this.halted = false;
    this.retryAt = 0;
    this.failures = 0;
    this.lastRunAt = undefined;
    this.cancelTimer();
    this.update({
      phase: "off",
      syncing: false,
      problem,
      lastSyncAt: undefined,
      notices: NO_NOTICES,
    });
  }

  /**
   * Opens the engine for the saved key. While sync is being turned off it
   * opens only for `stopping` (to delete the server copy).
   */
  private async ensureEngine(stopping = false): Promise<SyncEngine | null> {
    if (this.engine) return this.engine;
    if (this.view.phase !== "on") return null;
    const key = await this.call<string | null>("sync_key_load");
    if (!key) {
      this.switchedOff(undefined);
      return null;
    }
    const keys = deriveVaultKeys(base64urlDecode(key));
    const { invoke, now, randomBytes } = this.platform;
    const engine = await this.openEngine({
      keys,
      transport: createDesktopTransport(invoke, keys, now),
      notes: this.watchNotes(createDesktopNoteStore(invoke)),
      state: createDesktopStateStore(invoke),
      randomBytes,
      now,
      isExpired: (note) =>
        isPastRetention(note, this.options.retentionDays(), now()),
    });
    if (this.view.phase !== "on" || (this.stopping && !stopping)) {
      await engine.close();
      return null;
    }
    this.engine = engine;
    this.update({ lastSyncAt: engine.status().lastSyncAt });
    return engine;
  }

  /**
   * Closes the engine and forgets its state: a run in flight can then no
   * longer change a note or the state. Without an engine, a run in flight
   * may be opening one, so it is let to end before the state is cleared.
   */
  private async forgetState() {
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.forget();
    else await this.settled();
    await this.call("sync_state_clear");
  }

  /**
   * Closes the engine and forgets its state, keeping the deletes it had not
   * uploaded (and those it had not been handed yet) for a later rejoin of
   * the same vault. They are read from the saved state, so this works even
   * when the key cannot be read.
   */
  private async forgetStateKeepingDeletes() {
    const engine = this.engine;
    this.engine = null;
    if (engine) await engine.close();
    await this.settled();
    const kept = await pendingDeletesOf(
      createDesktopStateStore(this.platform.invoke),
    );
    await this.call("sync_state_clear", {
      keep: { vault: kept?.vaultId ?? null, deletes: kept?.deletes ?? [] },
    });
  }

  /**
   * Before sync is turned off with the server copy kept: one last try to
   * upload the deletes made here. What fails stays for later.
   */
  private async pushDeletes() {
    try {
      if (!this.engine) await this.settled();
      const engine = this.engine ?? (await this.ensureEngine(true));
      if (!engine) return;
      await this.recordLocalDeletes(engine);
      if (engine.status().pendingDeletes > 0) await engine.sync();
    } catch {
      // Kept: the deletes not uploaded stay for a later rejoin.
    } finally {
      if (this.notesTouched) {
        this.notesTouched = false;
        this.options.onNotesChanged?.();
      }
    }
  }

  /** The engine's note store, noting when a run changes a local note. */
  private watchNotes(notes: NoteStore): NoteStore {
    return {
      list: () => notes.list(),
      read: (id) => notes.read(id),
      applyRemote: async (change) => {
        const written = await notes.applyRemote(change);
        if (written) this.notesTouched = true;
        return written;
      },
      saveConflictCopy: async (id, note, hlc) => {
        this.notesTouched = true;
        await notes.saveConflictCopy(id, note, hlc);
      },
    };
  }

  /** Resolves once no run is in flight. */
  private async settled() {
    while (this.current) await this.current;
  }

  // ---- scheduling ----

  /**
   * Runs a sync in `delayMs`, unless one is due sooner; never before
   * `retryAt`. `interval`: only for the focused interval, which losing
   * focus cancels.
   */
  private schedule(delayMs: number, interval = false) {
    if (this.closed || this.stopping || this.halted || this.view.phase !== "on")
      return;
    const now = this.platform.now();
    const due = Math.max(now + delayMs, this.retryAt);
    if (this.timer && this.timer.due <= due) {
      if (!interval) this.timer.interval = false;
      return;
    }
    const wasInterval = this.timer?.interval ?? true;
    this.cancelTimer();
    const handle = this.platform.timers.setTimeout(
      () => {
        this.timer = null;
        void this.run();
      },
      Math.max(0, due - now),
    );
    this.timer = { handle, due, interval: interval && wasInterval };
  }

  private cancelTimer() {
    if (!this.timer) return;
    this.platform.timers.clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private run(): Promise<void> {
    if (this.closed || this.stopping || this.halted) return Promise.resolve();
    if (this.current) {
      this.again = true;
      return this.current;
    }
    const current = this.runOnce().finally(() => {
      if (this.current === current) this.current = null;
    });
    this.current = current;
    return current;
  }

  private async runOnce(): Promise<void> {
    this.update({ syncing: true });
    let next: number | null = null;
    try {
      const engine = await this.ensureEngine();
      if (engine) {
        await this.recordLocalDeletes(engine);
        const report = await engine.sync();
        this.succeeded(engine, report);
        if (report.deferred) next = DEFERRED_DELAY_MS;
      }
    } catch (error) {
      next = await this.failed(error);
    } finally {
      this.lastRunAt = this.platform.now();
      this.update({ syncing: false });
      // Whether the run ended well or not: a page applied before a later
      // one failed has already changed the library.
      if (this.notesTouched) {
        this.notesTouched = false;
        this.options.onNotesChanged?.();
      }
    }
    if (this.again) {
      this.again = false;
      this.schedule(0);
    }
    if (next !== null) this.schedule(next);
    if (this.focused) this.schedule(FOCUSED_INTERVAL_MS, true);
  }

  /** Hands the deletes the user made here to the engine, which keeps them until they are uploaded. */
  private async recordLocalDeletes(engine: SyncEngine) {
    const pending = await this.call<PendingDelete[]>("sync_pending_deletes");
    // Those kept for another vault wait for a rejoin of that vault.
    const deletes = (pending ?? []).filter(
      ({ vault }) => vault === undefined || vault === engine.vaultId,
    );
    if (deletes.length === 0) return;
    await engine.recordDeletes(
      deletes.map(({ id, hlc, deletedAt, synced }): LocalDelete => ({
        id,
        ...(hlc ? { hlc } : {}),
        ...(deletedAt ? { deletedAt } : {}),
        ...(synced ? { synced } : {}),
      })),
    );
    await this.call("sync_pending_deletes_done", { deletes });
  }

  private succeeded(engine: SyncEngine, report: SyncReport) {
    this.retryAt = 0;
    this.failures = 0;
    if (report.newerSchema > 0) this.rememberNewerSchema();
    this.update({
      problem: undefined,
      lastSyncAt: engine.status().lastSyncAt,
      notices: {
        quotaExceeded: report.quotaExceeded,
        tooLarge: report.tooLarge.length > 0,
        newerSchema: this.view.notices.newerSchema || report.newerSchema > 0,
      },
    });
    if (report.pulled > 0 || report.conflictCopies.length > 0)
      this.notesTouched = true;
  }

  /** Decides what a failed run means; returns when to try again (null: not by itself). */
  private async failed(error: unknown): Promise<number | null> {
    if (error instanceof SyncClosedError) return null;
    if (error instanceof SyncError) {
      if (error.kind === "unauthorized") {
        this.halted = true;
        this.update({ problem: { kind: "unauthorized" } });
        return null;
      }
      if (
        error.kind === "gone" &&
        error.code === SYNC_ERROR_CODES.vaultDeleted
      ) {
        await this.vaultDeleted();
        return null;
      }
      if (error.kind === "rateLimited") {
        const wait = Math.max(1_000, error.retryAfterMs ?? RATE_LIMIT_MS);
        this.retryAt = this.platform.now() + wait;
        return wait;
      }
      this.update({
        problem: {
          kind:
            error.kind === "network"
              ? "offline"
              : error.kind === "tooLarge"
                ? "tooLarge"
                : "server",
        },
      });
    } else {
      this.update({
        problem: { kind: "device", detail: nativeError(error).message },
      });
    }
    const delay = this.backoff();
    this.retryAt = this.platform.now() + delay;
    return delay;
  }

  private backoff(): number {
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures);
    this.failures = Math.min(this.failures + 1, 16);
    return Math.round(delay * (0.75 + 0.5 * this.platform.random()));
  }

  /** Another device deleted the server copy: forget the key and the state, keep the notes. */
  private async vaultDeleted() {
    const engine = this.engine;
    this.engine = null;
    try {
      if (engine) await engine.forget();
      else await this.call("sync_state_clear");
    } catch {
      // Forgotten next time: the server keeps answering that it is deleted.
    }
    try {
      await this.call("sync_key_forget");
    } catch {
      // Likewise.
    }
    this.switchedOff({ kind: "deleted" });
  }

  // ---- helpers ----

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.actions.then(run, run);
    this.actions = result.catch(() => undefined);
    return result;
  }

  private async call<T = void>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await this.platform.invoke<T>(command, args);
    } catch (error) {
      throw nativeError(error);
    }
  }

  private newerSchemaSeen(): boolean {
    try {
      return (
        this.options.storage?.getItem(NEWER_SCHEMA_KEY) ===
        String(READER_VERSION)
      );
    } catch {
      return false;
    }
  }

  private rememberNewerSchema() {
    try {
      this.options.storage?.setItem(NEWER_SCHEMA_KEY, String(READER_VERSION));
    } catch {
      // The notice still shows until the app closes.
    }
  }
}
