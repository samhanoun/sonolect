import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeClock } from "./sync/testSupport";
import {
  PICKER_POLL_MS,
  PICKER_WATCH_MS,
  watchKeyboardChange,
} from "./voiceKeyboardWatch";

/** The keyboard status the card reads, as the user picks in the system picker. */
function picker(selectedAfterReads: number) {
  let reads = 0;
  return {
    read: () => {
      reads += 1;
      return { selected: reads >= selectedAfterReads };
    },
    reads: () => reads,
  };
}

describe("the voice keyboard card after the keyboard picker opens", () => {
  it("shows the new keyboard once the user picks it, while the picker is still up", async () => {
    const clock = new FakeClock(0);
    // The picker answered at once; the user picks after about 2 s.
    const user = picker(4);
    const shown: { selected: boolean }[] = [];
    watchKeyboardChange({
      read: user.read,
      changed: (status) => status.selected,
      onStatus: (status) => shown.push(status),
      timers: clock.timersApi,
    });
    await clock.advance(1_000);
    assert.deepEqual(shown, [], "nothing changed yet");
    await clock.advance(1_000);
    assert.deepEqual(shown, [{ selected: true }]);
    assert.deepEqual(clock.pending(), [], "stops once it changed");
    assert.equal(user.reads(), 4);
  });

  it("stops after a while, showing what it read last", async () => {
    const clock = new FakeClock(0);
    const user = picker(Number.POSITIVE_INFINITY);
    const shown: { selected: boolean }[] = [];
    watchKeyboardChange({
      read: user.read,
      changed: (status) => status.selected,
      onStatus: (status) => shown.push(status),
      timers: clock.timersApi,
    });
    await clock.advance(PICKER_WATCH_MS + PICKER_POLL_MS);
    assert.deepEqual(shown, [{ selected: false }]);
    assert.equal(user.reads(), PICKER_WATCH_MS / PICKER_POLL_MS);
    assert.deepEqual(clock.pending(), []);
  });

  it("reads nothing more once stopped", async () => {
    const clock = new FakeClock(0);
    const user = picker(Number.POSITIVE_INFINITY);
    const stop = watchKeyboardChange({
      read: user.read,
      changed: (status) => status.selected,
      onStatus: () => assert.fail("stopped"),
      timers: clock.timersApi,
    });
    await clock.advance(PICKER_POLL_MS);
    stop();
    await clock.advance(PICKER_WATCH_MS);
    assert.equal(user.reads(), 1);
  });
});
