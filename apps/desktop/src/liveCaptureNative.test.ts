import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveCaptureTransport } from "./liveCapture";
import {
  loadCaptureSource,
  recordLive,
  recordSystemAudio,
  saveCaptureSource,
  type PcmSource,
  type SystemAudioEnded,
  type SystemAudioFeed,
} from "./liveCaptureNative";

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

/** A system-audio feed that reports what the test tells it to. */
function fakeFeed(calls: string[], failStart?: string) {
  const state: {
    level?: (level: number) => void;
    ended?: (event: SystemAudioEnded) => void;
  } = {};
  const feed: SystemAudioFeed = {
    available: async () => true,
    listen: async ({ onLevel, onEnded }) => {
      calls.push("feed listen");
      state.level = onLevel;
      state.ended = onEnded;
      return () => void calls.push("feed unlisten");
    },
    start: async (captureId) => {
      if (failStart) throw new Error(failStart);
      calls.push(`feed start ${captureId}`);
    },
    stop: async () => void calls.push("feed stop"),
  };
  return { feed, state };
}

describe("recordSystemAudio", () => {
  it("feeds the recording natively and stops the feed before finishing", async () => {
    const { transport, calls } = fakeTransport();
    const { feed, state } = fakeFeed(calls);
    const levels: number[] = [];
    let clock = 1000;
    const recording = await recordSystemAudio(
      {},
      { onLevel: (level) => levels.push(level) },
      transport,
      feed,
      () => clock,
    );
    assert.equal(recording.captureId, "17-1");
    state.level!(0.4);
    clock = 61_000;
    const result = await recording.finish();
    assert.equal(result.text, "Hello.");
    // The length is the time recorded: the window saw none of the audio.
    assert.equal(result.durationMs, 60_000);
    // A level that arrives late is not passed on.
    state.level!(0.9);
    assert.deepEqual(levels, [0.4, 0]);
    assert.deepEqual(calls, [
      "listen",
      "begin",
      "feed listen",
      "feed start 17-1",
      "feed unlisten",
      "feed stop",
      "finish",
      "unlisten",
    ]);
  });

  it("reports a feed that ended by itself, once, for this recording only", async () => {
    const { transport, calls } = fakeTransport();
    const { feed, state } = fakeFeed(calls);
    const stalled: string[] = [];
    const recording = await recordSystemAudio(
      {},
      { onStalled: (message) => stalled.push(message) },
      transport,
      feed,
    );
    state.ended!({ id: "another", message: "System audio stopped." });
    assert.deepEqual(stalled, []);
    state.ended!({ id: "17-1", message: "System audio stopped." });
    assert.deepEqual(stalled, ["System audio stopped."]);
    await recording.finish();
    state.ended!({ id: "17-1", message: "System audio stopped." });
    assert.equal(stalled.length, 1);
  });

  it("throws the recording away and says why when the feed cannot start", async () => {
    const { transport, calls } = fakeTransport();
    const { feed } = fakeFeed(calls, "There is no playback device to record.");
    await assert.rejects(
      recordSystemAudio({}, {}, transport, feed),
      /no playback device/,
    );
    assert.deepEqual(calls, [
      "listen",
      "begin",
      "feed listen",
      "feed unlisten",
      "feed stop",
      "cancel",
      "unlisten",
    ]);
  });

  it("rejects without touching the feed when the recorder cannot start", async () => {
    const { transport, calls } = fakeTransport(true);
    const { feed } = fakeFeed(calls);
    await assert.rejects(
      recordSystemAudio({}, {}, transport, feed),
      /speech model/,
    );
    assert.equal(
      calls.some((call) => call.startsWith("feed")),
      false,
    );
  });

  it("cancel stops the feed and deletes the recording", async () => {
    const { transport, calls } = fakeTransport();
    const { feed } = fakeFeed(calls);
    const recording = await recordSystemAudio({}, {}, transport, feed);
    await recording.cancel();
    assert.deepEqual(calls.slice(-4), [
      "feed unlisten",
      "feed stop",
      "cancel",
      "unlisten",
    ]);
  });
});

describe("the choice of what to record", () => {
  function memory() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
  }

  it("is the microphone until this computer's sound is chosen", () => {
    const storage = memory();
    assert.equal(loadCaptureSource(storage), "microphone");
    saveCaptureSource("system", storage);
    assert.equal(loadCaptureSource(storage), "system");
    saveCaptureSource("microphone", storage);
    assert.equal(loadCaptureSource(storage), "microphone");
  });

  it("is the microphone when the saved value is unknown or storage fails", () => {
    const storage = memory();
    storage.setItem("sonolect.captureSource", "tape");
    assert.equal(loadCaptureSource(storage), "microphone");
    assert.equal(loadCaptureSource(undefined), "microphone");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(loadCaptureSource(broken), "microphone");
    saveCaptureSource("system", broken);
  });
});
