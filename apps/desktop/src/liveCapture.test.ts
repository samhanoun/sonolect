import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LiveCaptureSession,
  type LiveCaptureTransport,
  type LivePartialEvent,
} from "./liveCapture";

type Fake = LiveCaptureTransport & {
  calls: string[];
  pieces: Uint8Array[];
  emit: (event: LivePartialEvent) => void;
  listening: () => boolean;
  failAppendWith?: string;
  /** Resolves appends only when released, to model a slow recorder. */
  hold?: Promise<void>;
};

function fakeTransport(): Fake {
  let listener: ((event: LivePartialEvent) => void) | undefined;
  const fake: Fake = {
    calls: [],
    pieces: [],
    emit: (event) => listener?.(event),
    listening: () => listener !== undefined,
    listen: async (onPartial) => {
      fake.calls.push("listen");
      listener = onPartial;
      return () => {
        fake.calls.push("unlisten");
        listener = undefined;
      };
    },
    begin: async (settings) => {
      fake.calls.push(`begin ${JSON.stringify(settings)}`);
      return "17-1";
    },
    append: async (captureId, pcm) => {
      await fake.hold;
      if (fake.failAppendWith) throw new Error(fake.failAppendWith);
      fake.calls.push(`append ${captureId} ${pcm.length}`);
      fake.pieces.push(pcm);
      return fake.pieces.reduce((total, piece) => total + piece.length, 0) / 32;
    },
    finish: async (captureId) => {
      fake.calls.push(`finish ${captureId}`);
      return {
        text: " Hello there. ",
        segments: [{ startMs: 0, endMs: 900, text: " Hello there. " }],
        language: "en",
        captureId,
      };
    },
    cancel: async (captureId) => {
      fake.calls.push(`cancel ${captureId}`);
    },
  };
  return fake;
}

const second = (rate: number) => new Float32Array(rate).fill(0.25);

describe("live capture session", () => {
  it("sends half-second pieces in order and returns the transcript", async () => {
    const transport = fakeTransport();
    const levels: number[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      { language: "en", modelPath: "ggml-base.bin" },
      { onLevel: (level) => levels.push(level) },
    );
    assert.equal(session.captureId, "17-1");
    // 1.2 seconds at 48 kHz, in audio-thread sized blocks.
    const audio = new Float32Array(57600).fill(0.25);
    for (let offset = 0; offset < audio.length; offset += 1024)
      session.push(audio.subarray(offset, offset + 1024), 48000);
    const result = await session.finish();

    assert.deepEqual(transport.calls, [
      "listen",
      'begin {"language":"en","modelPath":"ggml-base.bin"}',
      "append 17-1 16000",
      "append 17-1 16000",
      "append 17-1 6400",
      "finish 17-1",
      "unlisten",
    ]);
    assert.equal(session.durationMs, 1200);
    // 0.25 of full scale as little-endian 16-bit samples.
    assert.deepEqual([...transport.pieces[0]!.subarray(0, 2)], [0, 32]);
    assert.ok(levels.length > 50 && levels.every((level) => level === 0.25));
    assert.deepEqual(result, {
      text: "Hello there.",
      segments: [
        { id: "whisper-1", text: "Hello there.", startMs: 0, endMs: 900 },
      ],
      language: "en",
      captureId: "17-1",
    });
    await assert.rejects(session.finish(), /already ended/);
  });

  it("reports live text for this recording only, until it ends", async () => {
    const transport = fakeTransport();
    const seen: string[][] = [];
    const session = await LiveCaptureSession.start(
      transport,
      {},
      { onPartial: (segments) => seen.push(segments.map((s) => s.text)) },
    );
    transport.emit({
      captureId: "17-1",
      segments: [{ startMs: 0, endMs: 2000, text: " First part." }],
    });
    transport.emit({
      captureId: "another",
      segments: [{ startMs: 0, endMs: 2000, text: "Not ours." }],
    });
    transport.emit({
      captureId: "17-1",
      segments: [{ startMs: 2000, endMs: 4000, text: "Second part." }],
    });
    assert.deepEqual(seen, [["First part."], ["First part.", "Second part."]]);
    assert.deepEqual(
      session.partialSegments.map((segment) => segment.id),
      ["live-1", "live-2"],
    );
    await session.finish();
    assert.equal(transport.listening(), false);
  });

  it("stops once when the recorder refuses audio, and still finishes", async () => {
    const transport = fakeTransport();
    const stalls: string[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      {},
      { onStalled: (message) => stalls.push(message) },
    );
    session.push(second(16000), 16000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.failAppendWith = "The recording reached the four-hour limit.";
    session.push(second(16000), 16000);
    session.push(second(16000), 16000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(stalls, ["The recording reached the four-hour limit."]);
    // Nothing more is sent, but what was recorded is transcribed.
    session.push(second(16000), 16000);
    const result = await session.finish();
    assert.equal(result.text, "Hello there.");
    assert.equal(
      transport.calls.filter((call) => call.startsWith("append")).length,
      2,
    );
  });

  it("gives up when pieces pile up behind a stuck recorder", async () => {
    const transport = fakeTransport();
    let release!: () => void;
    transport.hold = new Promise((resolve) => (release = resolve));
    const stalls: string[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      {},
      { onStalled: (message) => stalls.push(message) },
    );
    // More than two minutes of audio while nothing gets through.
    for (let index = 0; index < 125; index++)
      session.push(second(16000), 16000);
    assert.equal(stalls.length, 1);
    assert.match(stalls[0]!, /not keeping up/);
    release();
    await session.cancel();
    assert.deepEqual(transport.calls.slice(-2), ["cancel 17-1", "unlisten"]);
  });

  it("cancels without transcribing and ignores later audio and text", async () => {
    const transport = fakeTransport();
    const seen: unknown[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      {},
      { onPartial: (segments) => seen.push(segments) },
    );
    session.push(second(16000), 16000);
    await session.cancel();
    await session.cancel();
    session.push(second(16000), 16000);
    transport.emit({
      captureId: "17-1",
      segments: [{ startMs: 0, endMs: 1, text: "late" }],
    });
    assert.deepEqual(seen, []);
    assert.deepEqual(
      transport.calls.filter((call) => !call.startsWith("append")),
      ["listen", "begin {}", "cancel 17-1", "unlisten"],
    );
  });

  it("stops listening when the recording cannot start", async () => {
    const transport = fakeTransport();
    transport.begin = async () => {
      throw new Error("Install the local speech model in Settings first.");
    };
    await assert.rejects(
      LiveCaptureSession.start(transport, {}),
      /Install the local speech model/,
    );
    assert.equal(transport.listening(), false);
  });
});
