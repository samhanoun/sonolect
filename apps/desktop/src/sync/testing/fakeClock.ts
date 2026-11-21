/**
 * A clock and timers that move only when a test says so, for the sync
 * controller's schedule. Not for the app.
 */
import type { Invoke, SyncPlatform, Timers } from "../platform";

interface Pending {
  id: number;
  due: number;
  run: () => void;
}

/** Lets every promise chain that does not wait on a real timer finish. */
export async function flush(rounds = 8) {
  for (let round = 0; round < rounds; round += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

export class FakeClock {
  private pending: Pending[] = [];
  private nextId = 1;

  constructor(public time: number) {}

  now = () => this.time;

  readonly timers: Timers = {
    setTimeout: (run, ms) => {
      const id = this.nextId++;
      this.pending.push({ id, due: this.time + Math.max(0, ms), run });
      return id;
    },
    clearTimeout: (handle) => {
      this.pending = this.pending.filter((timer) => timer.id !== handle);
    },
  };

  /** When the next timer fires, or undefined. */
  nextDue(): number | undefined {
    return this.pending.reduce<number | undefined>(
      (soonest, timer) =>
        soonest === undefined || timer.due < soonest ? timer.due : soonest,
      undefined,
    );
  }

  /** Moves time forward, firing each timer due on the way and letting its work finish. */
  async advance(ms: number) {
    const target = this.time + ms;
    for (;;) {
      const due = this.nextDue();
      if (due === undefined || due > target) break;
      const timer = this.pending.find((pending) => pending.due === due)!;
      this.pending = this.pending.filter((pending) => pending !== timer);
      this.time = Math.max(this.time, due);
      timer.run();
      await flush();
    }
    this.time = target;
    await flush();
  }
}

/** A platform for the sync modules over a fake clock and a fake native side. */
export function fakePlatform(
  invoke: Invoke,
  clock: FakeClock,
  random = () => 0.5,
): SyncPlatform {
  return {
    invoke,
    timers: clock.timers,
    now: clock.now,
    // Real randomness for keys and nonces; the schedule's jitter is fixed.
    randomBytes: (length) =>
      globalThis.crypto.getRandomValues(new Uint8Array(length)),
    random,
  };
}
