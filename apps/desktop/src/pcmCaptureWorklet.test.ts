import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

type Processor = { process: (inputs: Float32Array[][]) => boolean };
type ProcessorClass = new (options?: unknown) => Processor;

/**
 * Loads the audio-thread script as the webview does, with the two names it
 * finds there, and returns a processor and the blocks it posts.
 */
function loadWorklet(options?: unknown) {
  const posted: number[][] = [];
  let registered: { name: string; processor: ProcessorClass } | undefined;
  class AudioWorkletProcessor {
    // Posting copies the block, as structured cloning does.
    readonly port = {
      postMessage: (block: Float32Array) => void posted.push([...block]),
    };
  }
  runInNewContext(
    readFileSync(
      join(import.meta.dirname, "../public/pcm-capture.worklet.js"),
      "utf8",
    ),
    {
      AudioWorkletProcessor,
      Float32Array,
      registerProcessor: (name: string, processor: ProcessorClass) => {
        registered = { name, processor };
      },
    },
  );
  assert.equal(registered?.name, "pcm-capture");
  return { processor: new registered.processor(options), posted };
}

/** A render quantum of 128 frames, counting from `start`. */
const quantum = (start: number, sign = 1) =>
  Float32Array.from({ length: 128 }, (_, index) => sign * (start + index));

describe("the audio-thread capture script", () => {
  it("posts mono blocks of 1024 frames", () => {
    const { processor, posted } = loadWorklet({ processorOptions: {} });
    for (let index = 0; index < 9; index++)
      assert.equal(processor.process([[quantum(index * 128)]]), true);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.length, 1024);
    assert.deepEqual(posted[0]!.slice(0, 3), [0, 1, 2]);
    assert.equal(posted[0]![1023], 1023);
  });

  it("interleaves two channels when asked to, in blocks of 1024 frames", () => {
    const { processor, posted } = loadWorklet({
      processorOptions: { channels: 2 },
    });
    for (let index = 0; index < 8; index++)
      processor.process([[quantum(index * 128), quantum(index * 128, -1)]]);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.length, 2048);
    assert.deepEqual(posted[0]!.slice(0, 6), [0, -0, 1, -1, 2, -2]);
    assert.deepEqual(posted[0]!.slice(-2), [1023, -1023]);
  });

  it("copies a one-channel input to both sides, and waits through silence", () => {
    const { processor, posted } = loadWorklet({
      processorOptions: { channels: 2 },
    });
    // No input yet: nothing is posted, and the processor stays alive.
    assert.equal(processor.process([[]]), true);
    assert.equal(processor.process([]), true);
    for (let index = 0; index < 8; index++)
      processor.process([[quantum(index * 128)]]);
    assert.deepEqual(posted[0]!.slice(0, 4), [0, 0, 1, 1]);
  });

  it("records one channel when the option is missing or unknown", () => {
    for (const options of [undefined, { processorOptions: { channels: 6 } }]) {
      const { processor, posted } = loadWorklet(options);
      for (let index = 0; index < 8; index++)
        processor.process([[quantum(index * 128), quantum(index * 128, -1)]]);
      assert.equal(posted[0]!.length, 1024);
      assert.deepEqual(posted[0]!.slice(0, 2), [0, 1]);
    }
  });
});
