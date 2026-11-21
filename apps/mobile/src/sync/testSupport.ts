/**
 * Test doubles for the sync tests (not a test file itself, and never
 * imported by the app): an in-memory AsyncStorage, an in-memory SecureStore
 * and timers the test moves forward by hand.
 */
import type { TranscriptTurn } from "../domain";
import type { KeyValueStore } from "../storageCore";
import type { SecretStore } from "./keyStore";
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
