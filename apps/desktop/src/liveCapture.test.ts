import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LiveCaptureSession,
  type LiveCaptureTransport,
  type LivePartialEvent,
  type PcmFormat,
} from "./liveCapture";

type Fake = LiveCaptureTransport & {
  calls: string[];
  pieces: Uint8Array[];
  /** The format each piece was sent with; none means 16 kHz mono. */
  formats: (PcmFormat | undefined)[];
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
    formats: [],
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
    append: async (captureId, pcm, format) => {
      await fake.hold;
      if (fake.failAppendWith) throw new Error(fake.failAppendWith);
      fake.calls.push(`append ${captureId} ${pcm.length}`);
      fake.pieces.push(pcm);
      fake.formats.push(format);
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

/** Interleaved stereo: the left channel at `left`, the right at `right`. */
function stereo(frames: number, left: number, right: number) {
  const block = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    block[2 * frame] = left;
    block[2 * frame + 1] = right;
  }
  return block;
}

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

  it("names no recording when the note was deleted before it was saved", async () => {
    const transport = fakeTransport();
    const finish = transport.finish;
    // The native side leaves the id out for a note deleted meanwhile.
    transport.finish = async (captureId) => {
      const { captureId: _kept, ...rest } = await finish(captureId);
      return rest;
    };
    const session = await LiveCaptureSession.start(transport, {
      language: "en",
      modelPath: "ggml-base.bin",
    });
    session.push(new Float32Array(16000).fill(0.25), 16000);
    const result = await session.finish();
    assert.equal(result.text, "Hello there.");
    assert.equal("captureId" in result, false);
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
  it("sends a high-quality recording as it comes, in half-second pieces of whole frames", async () => {
    const transport = fakeTransport();
    const levels: number[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      { language: "en", quality: "high" },
      { onLevel: (level) => levels.push(level) },
    );
    // 1.2 seconds at 48 kHz stereo, in audio-thread sized blocks.
    for (let sent = 0; sent < 57600; sent += 1024)
      session.push(stereo(Math.min(1024, 57600 - sent), 0.25, -0.25), 48000, 2);
    await session.finish();

    assert.deepEqual(transport.calls.slice(0, 5), [
      "listen",
      'begin {"language":"en","quality":"high"}',
      // 24,000 frames of two 16-bit samples, then the 9,600 frames left.
      "append 17-1 96000",
      "append 17-1 96000",
      "append 17-1 38400",
    ]);
    assert.deepEqual(transport.formats, [
      { rate: 48000, channels: 2 },
      { rate: 48000, channels: 2 },
      { rate: 48000, channels: 2 },
    ]);
    // Not resampled nor mixed: left then right, as they came.
    assert.deepEqual(
      [...transport.pieces[0]!.subarray(0, 8)],
      [0, 32, 0, 224, 0, 32, 0, 224],
    );
    assert.ok(levels.length > 0 && levels.every((level) => level > 0.2));
  });

  it("sends a 44.1 kHz mono microphone at its own rate in high quality", async () => {
    const transport = fakeTransport();
    const session = await LiveCaptureSession.start(transport, {
      quality: "high",
    });
    session.push(second(44100), 44100, 1);
    await session.finish();
    assert.deepEqual(
      transport.calls.filter((call) => call.startsWith("append")),
      ["append 17-1 44100", "append 17-1 44100"],
    );
    assert.deepEqual(transport.formats, [
      { rate: 44100, channels: 1 },
      { rate: 44100, channels: 1 },
    ]);
  });

  it("mixes two channels to mono at 16 kHz in speech quality, without format headers", async () => {
    const transport = fakeTransport();
    const session = await LiveCaptureSession.start(transport, {});
    session.push(stereo(16000, 0.5, 0), 16000, 2);
    await session.finish();
    assert.deepEqual(
      transport.calls.filter((call) => call.startsWith("append")),
      ["append 17-1 16000", "append 17-1 16000"],
    );
    assert.deepEqual(transport.formats, [undefined, undefined]);
    // The average of the two channels: 0.25 of full scale.
    assert.deepEqual([...transport.pieces[0]!.subarray(0, 4)], [0, 32, 0, 32]);
  });

  it("stops a high-quality recording whose format changes, and keeps what it has", async () => {
    const transport = fakeTransport();
    const stalls: string[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      { quality: "high" },
      { onStalled: (message) => stalls.push(message) },
    );
    session.push(stereo(24000, 0.25, 0.25), 48000, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.push(stereo(1024, 0.25, 0.25), 44100, 2);
    session.push(stereo(24000, 0.25, 0.25), 48000, 2);
    assert.equal(stalls.length, 1);
    assert.match(stalls[0]!, /format changed/);
    const result = await session.finish();
    assert.equal(result.text, "Hello there.");
    assert.deepEqual(
      transport.calls.filter((call) => call.startsWith("append")),
      ["append 17-1 96000"],
    );
  });

  it("gives up when high-quality pieces pile up behind a stuck recorder", async () => {
    const transport = fakeTransport();
    let release!: () => void;
    transport.hold = new Promise((resolve) => (release = resolve));
    const stalls: string[] = [];
    const session = await LiveCaptureSession.start(
      transport,
      { quality: "high" },
      { onStalled: (message) => stalls.push(message) },
    );
    // Half a second each: 240 pieces wait, the next one is refused.
    for (let index = 0; index < 241; index++)
      session.push(stereo(24000, 0.1, 0.1), 48000, 2);
    assert.equal(stalls.length, 1);
    assert.match(stalls[0]!, /not keeping up/);
    release();
    await session.cancel();
  });
});
