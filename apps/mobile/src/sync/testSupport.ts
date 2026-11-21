/**
 * Test doubles for the sync tests (not a test file itself, and never
 * imported by the app): an in-memory AsyncStorage, an in-memory SecureStore,
 * timers the test moves forward by hand, and phones on one vault.
 */
import {
  type Hlc,
  type SyncEngine,
  type NoteStore as SyncNoteStore,
  createMemoryStateStore,
  deriveVaultKeys,
  generateRootKey,
  isPastRetention,
  openSyncEngine,
} from "@sonolect/sync-core";
import { createMemoryVaultServer } from "@sonolect/sync-core/testing";

import type { TranscriptTurn } from "../domain";
import {
  type KeyValueStore,
  type NoteStore,
  SYNC_COMPANION_PREFIX,
  createNoteStore,
} from "../storageCore";
import {
  type DeleteScope,
  type Stamp,
  type Tombstone,
  addNote,
  changeNote,
  deleteNotes,
} from "./edits";
import type { SecretStore } from "./keyStore";
import { createNotesHost, createSyncNoteStore } from "./noteStore";
import type { Timers } from "./timers";

export type KvOp =
  | "getItem"
  | "setItem"
  | "removeItem"
  | "multiGet"
  | "multiSet"
  | "multiRemove"
  | "getAllKeys";

/** AsyncStorage in memory, with fault injection. */
export class MemoryKv implements KeyValueStore {
  readonly data = new Map<string, string>();
  /** Return true to make the call reject. */
  fail: (op: KvOp, keys: readonly string[]) => boolean = () => false;
  /** Awaited before each call runs. */
  gate: (op: KvOp, keys: readonly string[]) => Promise<void> = () =>
    Promise.resolve();

  private async run<T>(
    op: KvOp,
    keys: readonly string[],
    action: () => T,
  ): Promise<T> {
    await this.gate(op, keys);
    if (this.fail(op, keys)) throw new Error(`${op} failed (test)`);
    return action();
  }

  getItem(key: string) {
    return this.run("getItem", [key], () => this.data.get(key) ?? null);
  }
  setItem(key: string, value: string) {
    return this.run("setItem", [key], () => {
      this.data.set(key, value);
    });
  }
  removeItem(key: string) {
    return this.run("removeItem", [key], () => {
      this.data.delete(key);
    });
  }
  multiGet(keys: readonly string[]) {
    return this.run("multiGet", keys, () =>
      keys.map((key) => [key, this.data.get(key) ?? null] as const),
    );
  }
  multiSet(pairs: readonly (readonly [string, string])[]) {
    return this.run(
      "multiSet",
      pairs.map(([key]) => key),
      () => {
        for (const [key, value] of pairs) this.data.set(key, value);
      },
    );
  }
  multiRemove(keys: readonly string[]) {
    return this.run("multiRemove", keys, () => {
      for (const key of keys) this.data.delete(key);
    });
  }
  getAllKeys() {
    return this.run("getAllKeys", [], () => [...this.data.keys()]);
  }
}

/** SecureStore in memory. */
export class MemorySecrets implements SecretStore {
  readonly data = new Map<string, string>();
  fail: (op: "get" | "set" | "delete") => boolean = () => false;
  async getItem(key: string) {
    if (this.fail("get")) throw new Error("keychain locked (test)");
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    if (this.fail("set")) throw new Error("keychain write failed (test)");
    this.data.set(key, value);
  }
  async deleteItem(key: string) {
    if (this.fail("delete")) throw new Error("keychain delete failed (test)");
    this.data.delete(key);
  }
}

interface FakeTimer {
  id: number;
  at: number;
  run: () => void;
}

/** setTimeout and a clock that only move when the test says so. */
export class FakeClock {
  private time: number;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(start: number) {
    this.time = start;
  }

  now = (): number => this.time;

  readonly timersApi: Timers = {
    setTimeout: (run, ms) => {
      const timer = { id: this.nextId++, at: this.time + Math.max(0, ms), run };
      this.timers.push(timer);
      return timer.id;
    },
    clearTimeout: (id) => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    },
  };

  /** Timers waiting, by when they fire (ms from now). */
  pending(): number[] {
    return this.timers
      .map((timer) => timer.at - this.time)
      .sort((a, b) => a - b);
  }

  /** Moves the clock forward, firing each timer due on the way, then lets promises settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.run();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

/** Lets every queued promise callback run (a few macrotask turns). */
export async function settle(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

let counter = 0;

/** A phone note. */
export function makeTurn(patch: Partial<TranscriptTurn> = {}): TranscriptTurn {
  counter += 1;
  return {
    id: `turn_${1_763_600_000_000 + counter}_t${String(counter).padStart(5, "0")}`,
    rawText: `note ${counter}`,
    refinedText: `Note ${counter}.`,
    mode: "dictate",
    language: "en-US",
    privacyMode: false,
    createdAt: new Date(1_763_600_000_000 + counter * 1000).toISOString(),
    durationMs: 1000,
    source: "microphone",
    syncState: "local",
    ...patch,
  };
}

/** Random bytes from Node's Web Crypto. */
export const testRandomBytes = (length: number): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

/**
 * The phone's notes as store.ts keeps them: a history in memory, saved
 * through storageCore over an in-memory AsyncStorage, with sync's host and
 * NoteStore adapter on top. Local changes go through the same steps as the
 * store's: stamp, show, save.
 */
export class TestPhone {
  readonly kv = new MemoryKv();
  storage: NoteStore;
  history: TranscriptTurn[] = [];
  latest: TranscriptTurn | undefined;
  /** False: history off, or notes that could not be read. */
  writable = true;
  /** Bumped by a wipe (dataEpoch in store.ts). */
  epoch = 0;
  readonly removedShown: string[] = [];
  readonly notes: SyncNoteStore;

  constructor(readonly now: () => number = Date.now) {
    this.storage = this.newStorage();
    const host = createNotesHost({
      read: () => ({
        history: this.history,
        latest: this.latest,
        writable: this.writable,
      }),
      update: (patch) => {
        this.history = patch.history;
        if ("latest" in patch) this.latest = patch.latest;
      },
      apply: (change) => this.storage.apply(change),
      readCompanion: (id) => this.kv.getItem(`${SYNC_COMPANION_PREFIX}${id}`),
      generation: () => this.epoch,
      now: () => this.now(),
      onRemoved: (ids) => {
        this.removedShown.push(...ids);
      },
    });
    this.notes = createSyncNoteStore(host);
  }

  private newStorage(): NoteStore {
    return createNoteStore(this.kv, {
      companionPrefix: SYNC_COMPANION_PREFIX,
      now: () => this.now(),
    });
  }

  /** Reads the notes from storage, as a launch does. */
  async load(): Promise<void> {
    this.storage = this.newStorage();
    const read = await this.storage.load();
    this.history = read.notes;
    this.latest = read.notes[0];
  }

  /** A restart: memory is lost, storage stays. */
  async restart(): Promise<void> {
    this.history = [];
    this.latest = undefined;
    await this.load();
  }

  get(id: string): TranscriptTurn | undefined {
    return this.history.find((turn) => turn.id === id);
  }

  private async save(history: TranscriptTurn[]): Promise<void> {
    this.history = history;
    await this.storage.save(this.history);
  }

  /** A capture or a typed note, as store.ts adds it. */
  async add(turn: TranscriptTurn, stamp: Stamp): Promise<TranscriptTurn> {
    const added = addNote(this.history, turn, stamp);
    this.latest = added.turn;
    await this.save(added.history);
    return added.turn;
  }

  /** An edit (refine, pin), as store.ts makes it. */
  async edit(
    id: string,
    patch: Partial<TranscriptTurn>,
    stamp: Stamp,
  ): Promise<TranscriptTurn> {
    const turn = this.get(id);
    if (!turn) throw new Error(`no note ${id}`);
    const changed = changeNote(this.history, { ...turn, ...patch }, stamp);
    if (this.latest?.id === id) this.latest = changed.turn;
    await this.save(changed.history);
    return changed.turn;
  }

  /**
   * A delete as store.ts makes it (a note's Delete, Clear history): the
   * tombstones go to `record` before the notes go.
   */
  async delete(
    ids: readonly string[] | "all",
    scope: DeleteScope,
    record: (tombstones: Tombstone[]) => Promise<void>,
  ): Promise<void> {
    const { history, tombstones } = deleteNotes(this.history, ids, scope);
    const recorded = tombstones.length > 0 ? record(tombstones) : undefined;
    if (this.latest && !history.includes(this.latest)) this.latest = undefined;
    await this.save(history);
    await recorded;
  }

  /** Removes a note here without telling sync (retention, or the caller records the delete). */
  async remove(id: string): Promise<void> {
    await this.save(this.history.filter((turn) => turn.id !== id));
  }

  /** Clears every note here (history off), bumping the epoch. */
  async wipe(): Promise<void> {
    this.epoch += 1;
    this.history = [];
    this.latest = undefined;
    await this.storage.clear();
  }
}

/** One phone on a test vault: its notes and its sync engine. */
export interface TestDevice {
  phone: TestPhone;
  engine: SyncEngine;
  stamp: (previous?: Hlc) => Hlc;
}

/**
 * A vault on sync-core's in-memory server, and phones on it, each with its
 * own notes and sync state. Time stands still until `tick`.
 */
export function createTestVault(start: number) {
  let time = start;
  const now = () => time;
  const server = createMemoryVaultServer({ now });
  const root = generateRootKey(testRandomBytes);
  const keys = deriveVaultKeys(root);
  const device = async (
    options: { retentionDays?: number } = {},
  ): Promise<TestDevice> => {
    const phone = new TestPhone(now);
    await phone.load();
    const engine = await openSyncEngine({
      keys,
      transport: server.transport(keys),
      notes: phone.notes,
      state: createMemoryStateStore(),
      randomBytes: testRandomBytes,
      now,
      isExpired: (note) =>
        isPastRetention(note, options.retentionDays ?? 0, now()),
    });
    return { phone, engine, stamp: (previous) => engine.stamp(previous) };
  };
  return {
    server,
    keys,
    now,
    device,
    tick: (ms = 1000) => {
      time += ms;
    },
  };
}
