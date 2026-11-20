import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createKeepAwake } from "./keepAwake";

/** Lets the queued native calls run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function recorder() {
  const calls: string[] = [];
  const keepAwake = createKeepAwake({
    activate: async () => {
      calls.push("activate");
    },
    deactivate: async () => {
      calls.push("deactivate");
    },
  });
  return { calls, keepAwake };
}

describe("createKeepAwake", () => {
  it("is released only by the dictation that holds it", async () => {
    const { calls, keepAwake } = recorder();
    keepAwake.hold("a");
    // A typed note replaced the capture: its id is 'idle'.
    keepAwake.release("idle");
    await flush();
    assert.deepEqual(calls, ["activate"]);
    keepAwake.release("a");
    keepAwake.release("a");
    await flush();
    assert.deepEqual(calls, ["activate", "deactivate"]);
  });

  it("never lets an older dictation release a newer one's hold", async () => {
    const { calls, keepAwake } = recorder();
    keepAwake.hold("a");
    keepAwake.hold("b");
    keepAwake.release("a");
    await flush();
    assert.deepEqual(calls, ["activate"]);
    keepAwake.release("b");
    await flush();
    assert.deepEqual(calls, ["activate", "deactivate"]);
  });

  it("is released by any exit without an id", async () => {
    const { calls, keepAwake } = recorder();
    keepAwake.hold("a");
    keepAwake.release();
    await flush();
    assert.deepEqual(calls, ["activate", "deactivate"]);
  });

  it("does nothing when nothing is held", async () => {
    const { calls, keepAwake } = recorder();
    keepAwake.release();
    keepAwake.release("a");
    await flush();
    assert.deepEqual(calls, []);
  });

  it("runs a release after the activation it follows", async () => {
    const calls: string[] = [];
    let finishActivation = () => {};
    const keepAwake = createKeepAwake({
      activate: () =>
        new Promise<void>((resolve) => {
          calls.push("activate");
          finishActivation = () => {
            calls.push("activated");
            resolve();
          };
        }),
      deactivate: async () => {
        calls.push("deactivate");
      },
    });
    keepAwake.hold("a");
    keepAwake.release("a");
    await flush();
    assert.deepEqual(calls, ["activate"]);
    finishActivation();
    await flush();
    assert.deepEqual(calls, ["activate", "activated", "deactivate"]);
  });

  it("keeps going after a native call fails", async () => {
    const calls: string[] = [];
    const keepAwake = createKeepAwake({
      activate: async () => {
        calls.push("activate");
        throw new Error("no window");
      },
      deactivate: async () => {
        calls.push("deactivate");
      },
    });
    keepAwake.hold("a");
    keepAwake.release("a");
    keepAwake.hold("b");
    await flush();
    assert.deepEqual(calls, ["activate", "deactivate", "activate"]);
  });
});
