import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveCaptureTransport } from "./liveCapture";
import { recordLive, type PcmSource } from "./liveCaptureNative";

function fakeTransport(failBegin = false) {
  const calls: string[] = [];
  let bytes = 0;
  const transport: LiveCaptureTransport = {
    listen: async () => {
      calls.push("listen");
      return () => void calls.push("unlisten");
    },
    begin: async () => {
      if (failBegin) throw new Error("Install the local speech model first.");
      calls.push("begin");
      return "17-1";
    },
    append: async (_captureId, pcm) => {
      bytes += pcm.length;
      calls.push(`append ${pcm.length}`);
      return bytes / 32;
    },
    finish: async () => {
      calls.push("finish");
      return { text: " Hello. ", segments: [], captureId: "17-1" };
    },
    cancel: async () => void calls.push("cancel"),
  };
  return { transport, calls };
}

type Feed = (block: Float32Array, sampleRate: number) => void;

/** A microphone that hands over its blocks only when the test says so. */
function fakeMicrophone() {
  const state: { feed?: Feed; closed: boolean } = { closed: false };
  const open = async (_stream: MediaStream, onBlock: Feed) => {
    state.feed = onBlock;
    const source: PcmSource = {
      sampleRate: 16000,
      kind: "worklet",
      close: async () => {
        state.closed = true;
      },
    };
    return source;
  };
  return { open, state };
}

const stream = {} as MediaStream;
const second = () => new Float32Array(16000).fill(0.1);

describe("recordLive", () => {
  it("records once audio arrives and finishes with the transcript", async () => {
    const { transport, calls } = fakeTransport();
    const microphone = fakeMicrophone();
    const open: typeof microphone.open = async (stream, onBlock) => {
      const source = await microphone.open(stream, onBlock);
      // The first block arrives right after the source opens.
      setTimeout(() => onBlock(second(), 16000), 0);
      return source;
    };
    const recording = await recordLive(stream, {}, {}, transport, open, 500);
    assert.ok(recording);
    assert.equal(recording.captureId, "17-1");
    microphone.state.feed!(second(), 16000);
    const result = await recording.finish();
    assert.equal(microphone.state.closed, true);
    assert.equal(result.text, "Hello.");
    assert.equal(result.durationMs, 2000);
    // Two seconds, in half-second pieces, then the end.
    assert.deepEqual(calls, [
      "listen",
      "begin",
      "append 16000",
      "append 16000",
      "append 16000",
      "append 16000",
      "finish",
      "unlisten",
    ]);
  });

  it("gives up when no audio arrives, so the caller can record another way", async () => {
    const { transport, calls } = fakeTransport();
    const microphone = fakeMicrophone();
    const recording = await recordLive(
      stream,
      {},
      {},
      transport,
      microphone.open,
      20,
    );
    assert.equal(recording, undefined);
    assert.equal(microphone.state.closed, true);
    // The empty recording is thrown away on the native side.
    assert.deepEqual(calls, ["listen", "begin", "cancel", "unlisten"]);
  });

  it("gives up when the audio capture cannot open", async () => {
    const { transport, calls } = fakeTransport();
    const recording = await recordLive(
      stream,
      {},
      {},
      transport,
      async () => {
        throw new Error("no audio worklet");
      },
      20,
    );
    assert.equal(recording, undefined);
    assert.deepEqual(calls, ["listen", "begin", "cancel", "unlisten"]);
  });

  it("gives up without touching the microphone when the recorder cannot start", async () => {
    const { transport, calls } = fakeTransport(true);
    let opened = false;
    const recording = await recordLive(
      stream,
      {},
      {},
      transport,
      async () => {
        opened = true;
        throw new Error("unreachable");
      },
      20,
    );
    assert.equal(recording, undefined);
    assert.equal(opened, false);
    assert.deepEqual(calls, ["listen", "unlisten"]);
  });

  it("cancel closes the microphone feed and deletes the recording", async () => {
    const { transport, calls } = fakeTransport();
    const microphone = fakeMicrophone();
    const open: typeof microphone.open = async (stream, onBlock) => {
      const source = await microphone.open(stream, onBlock);
      setTimeout(() => onBlock(second(), 16000), 0);
      return source;
    };
    const recording = await recordLive(stream, {}, {}, transport, open, 500);
    assert.ok(recording);
    await recording.cancel();
    assert.equal(microphone.state.closed, true);
    assert.equal(calls.at(-2), "cancel");
    assert.equal(calls.at(-1), "unlisten");
    assert.ok(!calls.includes("finish"));
  });
});
