/**
 * Test doubles for the sync tests (not a test file itself, and never
 * imported by the app): an in-memory AsyncStorage, an in-memory SecureStore
 * and timers the test moves forward by hand.
 */
import type { NoteStore as SyncNoteStore } from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";
import {
  type KeyValueStore,
  type NoteStore,
  SYNC_COMPANION_PREFIX,
  createNoteStore,
} from "../storageCore";
import { type Stamp, placeNotes, stampTurn } from "./edits";
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

  /** A capture or a typed note. */
  async add(turn: TranscriptTurn, stamp: Stamp): Promise<TranscriptTurn> {
    const stamped = stampTurn(turn, stamp);
    this.latest = stamped;
    await this.save([stamped, ...this.history]);
    return stamped;
  }

  /** An edit (refine, pin). */
  async edit(
    id: string,
    patch: Partial<TranscriptTurn>,
    stamp: Stamp,
  ): Promise<TranscriptTurn> {
    const turn = this.get(id);
    if (!turn) throw new Error(`no note ${id}`);
    const edited = stampTurn({ ...turn, ...patch }, stamp);
    await this.save(placeNotes(this.history, [edited]));
    return edited;
  }

  /** Removes a note here (the caller records the delete for sync, or not for retention). */
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
