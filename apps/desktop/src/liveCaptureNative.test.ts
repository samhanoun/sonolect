import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveCaptureTransport } from "./liveCapture";
import {
  captureAppendHeaders,
  captureChannels,
  loadCaptureSource,
  openPcmSource,
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
function fakeFeed(calls: string[], failStart?: string, endsAtStart?: string) {
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
      // The recorder process can exit before its start is acknowledged.
      if (endsAtStart) state.ended?.({ id: captureId, message: endsAtStart });
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

  it("treats a feed that ends while starting as a failed start, with the reason", async () => {
    const { transport, calls } = fakeTransport();
    const { feed } = fakeFeed(calls, undefined, "System audio stopped.");
    const stalled: string[] = [];
    await assert.rejects(
      recordSystemAudio(
        {},
        { onStalled: (message) => stalled.push(message) },
        transport,
        feed,
      ),
      /System audio stopped\./,
    );
    // Nobody is told to stop a recording that never began.
    assert.deepEqual(stalled, []);
    assert.deepEqual(calls.slice(-4), [
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

/** A microphone stream whose track reports `channelCount`, as Chromium does. */
function microphoneStream(channelCount?: number) {
  return {
    getAudioTracks: () => [
      { getSettings: () => (channelCount ? { channelCount } : {}) },
    ],
  } as unknown as MediaStream;
}

const audioNode = () => ({ connect() {}, disconnect() {} });

/** An audio context that records how it was made and used. */
class FakeContext {
  static made: FakeContext[] = [];
  /** Rates the webview refuses, as some refuse 48 kHz. */
  static refused = new Set<number>();
  static worklets = true;
  readonly sampleRate: number;
  state = "running";
  readonly destination = audioNode();
  readonly modules: string[] = [];
  processorArgs: number[] = [];
  processor:
    | {
        onaudioprocess:
          | ((event: {
              inputBuffer: { getChannelData: (index: number) => Float32Array };
            }) => void)
          | null;
      }
    | undefined;
  readonly audioWorklet = {
    addModule: async (url: string) => {
      this.modules.push(url);
      if (!FakeContext.worklets) throw new Error("no audio worklet");
    },
  };

  constructor(options?: { sampleRate?: number }) {
    if (options?.sampleRate && FakeContext.refused.has(options.sampleRate))
      throw new Error("NotSupportedError");
    this.sampleRate = options?.sampleRate ?? 44100;
    FakeContext.made.push(this);
  }

  createMediaStreamSource() {
    return audioNode();
  }

  createGain() {
    return { ...audioNode(), gain: { value: 1 } };
  }

  createScriptProcessor(size: number, inputs: number, outputs: number) {
    this.processorArgs = [size, inputs, outputs];
    const processor = { ...audioNode(), onaudioprocess: null };
    this.processor = processor;
    return processor;
  }

  async resume() {}

  async close() {
    this.state = "closed";
  }
}

class FakeWorkletNode {
  static made: FakeWorkletNode[] = [];
  readonly port: {
    onmessage: ((event: { data: Float32Array }) => void) | null;
  } = { onmessage: null };

  constructor(
    readonly context: FakeContext,
    readonly name: string,
    readonly options: Record<string, unknown>,
  ) {
    FakeWorkletNode.made.push(this);
  }

  connect() {}
  disconnect() {}
}

/** Runs `body` with the fake audio classes in place of the webview's. */
async function withFakeAudio(body: () => Promise<void>) {
  FakeContext.made = [];
  FakeContext.refused = new Set();
  FakeContext.worklets = true;
  FakeWorkletNode.made = [];
  Object.assign(globalThis, {
    AudioContext: FakeContext,
    AudioWorkletNode: FakeWorkletNode,
  });
  try {
    await body();
  } finally {
    Reflect.deleteProperty(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis, "AudioWorkletNode");
  }
}

type Block = {
  block: number[];
  sampleRate: number;
  channels: number | undefined;
};

describe("reading the microphone", () => {
  it("records two channels only in high quality and from a stereo microphone", () => {
    assert.equal(captureChannels(microphoneStream(2)), 1);
    assert.equal(captureChannels(microphoneStream(2), "speech"), 1);
    assert.equal(captureChannels(microphoneStream(2), "high"), 2);
    assert.equal(captureChannels(microphoneStream(1), "high"), 1);
    // WebKit reports no channel count: its microphones record mono.
    assert.equal(captureChannels(microphoneStream(), "high"), 1);
    assert.equal(captureChannels({} as MediaStream, "high"), 1);
  });

  it("reads speech at 16 kHz in mono, whatever the microphone has", async () => {
    await withFakeAudio(async () => {
      const blocks: Block[] = [];
      const source = await openPcmSource(
        microphoneStream(2),
        (block, sampleRate, channels) =>
          blocks.push({ block: [...block], sampleRate, channels }),
      );
      assert.equal(FakeContext.made[0]!.sampleRate, 16000);
      assert.equal(source.sampleRate, 16000);
      assert.equal(source.channels, 1);
      assert.equal(source.kind, "worklet");
      assert.deepEqual(FakeWorkletNode.made[0]!.options, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { channels: 1 },
      });
      FakeWorkletNode.made[0]!.port.onmessage!({
        data: Float32Array.from([0.5, -0.5]),
      });
      assert.deepEqual(blocks, [
        { block: [0.5, -0.5], sampleRate: 16000, channels: 1 },
      ]);
      await source.close();
      assert.equal(FakeContext.made[0]!.state, "closed");
      assert.equal(FakeWorkletNode.made[0]!.port.onmessage, null);
    });
  });

  it("reads high quality at 48 kHz with the microphone's two channels", async () => {
    await withFakeAudio(async () => {
      const blocks: Block[] = [];
      const source = await openPcmSource(
        microphoneStream(2),
        (block, sampleRate, channels) =>
          blocks.push({ block: [...block], sampleRate, channels }),
        "high",
      );
      assert.equal(FakeContext.made[0]!.sampleRate, 48000);
      assert.equal(source.sampleRate, 48000);
      assert.equal(source.channels, 2);
      assert.deepEqual(FakeContext.made[0]!.modules, [
        "/pcm-capture.worklet.js",
      ]);
      assert.equal(FakeWorkletNode.made[0]!.options.channelCount, 2);
      assert.deepEqual(FakeWorkletNode.made[0]!.options.processorOptions, {
        channels: 2,
      });
      FakeWorkletNode.made[0]!.port.onmessage!({
        data: Float32Array.from([0.5, -0.5, 0.25, -0.25]),
      });
      assert.deepEqual(blocks, [
        { block: [0.5, -0.5, 0.25, -0.25], sampleRate: 48000, channels: 2 },
      ]);
    });
  });

  it("takes the webview's own rate when it refuses 48 kHz", async () => {
    await withFakeAudio(async () => {
      FakeContext.refused.add(48000);
      const source = await openPcmSource(microphoneStream(1), () => {}, "high");
      assert.equal(FakeContext.made.length, 1);
      assert.equal(source.sampleRate, 44100);
      assert.equal(source.channels, 1);
    });
  });

  it("interleaves the script processor's channels when there is no audio worklet", async () => {
    await withFakeAudio(async () => {
      FakeContext.worklets = false;
      const blocks: Block[] = [];
      const source = await openPcmSource(
        microphoneStream(2),
        (block, sampleRate, channels) =>
          blocks.push({ block: [...block], sampleRate, channels }),
        "high",
      );
      assert.equal(source.kind, "processor");
      const context = FakeContext.made[0]!;
      assert.deepEqual(context.processorArgs, [4096, 2, 2]);
      const left = Float32Array.from([0.5, 0.25]);
      const right = Float32Array.from([-0.5, -0.25]);
      context.processor!.onaudioprocess!({
        inputBuffer: { getChannelData: (index) => (index ? right : left) },
      });
      assert.deepEqual(blocks, [
        { block: [0.5, -0.5, 0.25, -0.25], sampleRate: 48000, channels: 2 },
      ]);
      // The block is a copy: the webview reuses its buffers.
      left[0] = 0;
      assert.equal(blocks[0]!.block[0], 0.5);
      await source.close();
      assert.equal(context.processor!.onaudioprocess, null);
    });
  });

  it("says the rate and channels of a high-quality piece, and nothing for speech", () => {
    assert.deepEqual(captureAppendHeaders("17-1"), {
      "x-sonolect-capture": "17-1",
    });
    assert.deepEqual(
      captureAppendHeaders("17-1", { rate: 44100, channels: 2 }),
      {
        "x-sonolect-capture": "17-1",
        "x-sonolect-rate": "44100",
        "x-sonolect-channels": "2",
      },
    );
  });

  it("opens the microphone for the recording's quality and sends what it gives", async () => {
    const { transport, calls } = fakeTransport();
    const formats: unknown[] = [];
    const sending: LiveCaptureTransport = {
      ...transport,
      begin: async (settings) => {
        calls.push(`begin ${settings.quality}`);
        return "17-1";
      },
      append: async (captureId, pcm, format) => {
        formats.push(format);
        return transport.append(captureId, pcm, format);
      },
    };
    const qualities: unknown[] = [];
    const open = async (
      _stream: MediaStream,
      onBlock: (block: Float32Array, rate: number, channels?: number) => void,
      quality?: string,
    ) => {
      qualities.push(quality);
      setTimeout(() => onBlock(new Float32Array(48000 * 2), 48000, 2), 0);
      return {
        sampleRate: 48000,
        channels: 2,
        kind: "worklet" as const,
        close: async () => {},
      };
    };
    const recording = await recordLive(
      stream,
      { quality: "high" },
      {},
      sending,
      open,
      500,
    );
    assert.ok(recording);
    await recording.finish();
    assert.deepEqual(qualities, ["high"]);
    assert.equal(calls[1], "begin high");
    assert.deepEqual(formats, [
      { rate: 48000, channels: 2 },
      { rate: 48000, channels: 2 },
    ]);
  });
});
