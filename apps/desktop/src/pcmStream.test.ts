import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPTURE_PIECE_SAMPLES,
  PcmBatcher,
  PcmResampler,
  capturePieceSamples,
  floatToPcm16,
  interleave,
  mixToMono,
  pcmBytes,
  pcmLevel,
} from "./pcmStream";

function tone(frequency: number, sampleRate: number, seconds: number) {
  return Float32Array.from(
    { length: Math.round(sampleRate * seconds) },
    (_, index) =>
      0.5 * Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
}

/** Feeds a signal in uneven blocks, as an audio thread delivers it. */
function resample(signal: Float32Array, sampleRate: number, block: number) {
  const resampler = new PcmResampler(sampleRate);
  const parts: number[] = [];
  for (let offset = 0; offset < signal.length; offset += block)
    parts.push(...resampler.push(signal.subarray(offset, offset + block)));
  return Float32Array.from(parts);
}

describe("live recording audio", () => {
  it("leaves 16 kHz audio untouched", () => {
    const block = tone(440, 16000, 0.1);
    assert.equal(new PcmResampler(16000).push(block), block);
  });

  it("brings 48 kHz and 44.1 kHz down to 16 kHz without drifting", () => {
    for (const [rate, block] of [
      [48000, 128],
      [48000, 1000],
      [44100, 128],
      [44100, 4096],
      [96000, 333],
    ] as const) {
      const output = resample(tone(440, rate, 2), rate, block);
      // Two seconds stay two seconds, whatever the block size.
      assert.ok(
        Math.abs(output.length - 32000) <= 1,
        `${rate} Hz in blocks of ${block}: ${output.length}`,
      );
      // Still a 440 Hz tone: count the upward zero crossings.
      let crossings = 0;
      for (let index = 1; index < output.length; index++)
        if (output[index - 1]! < 0 && output[index]! >= 0) crossings += 1;
      assert.ok(Math.abs(crossings - 880) <= 2, `${rate}: ${crossings}`);
      assert.ok(pcmLevel(output) > 0.3, `${rate}: ${pcmLevel(output)}`);
    }
  });

  it("gives the same result whatever the block size", () => {
    const signal = tone(300, 44100, 0.5);
    assert.deepEqual(
      resample(signal, 44100, 128),
      resample(signal, 44100, 5000),
    );
  });

  it("dampens frequencies that 16 kHz cannot carry", () => {
    // 12 kHz would fold down to 4 kHz at full strength (0.35) if samples
    // were simply dropped; averaging leaves about a third of it.
    const folded = resample(tone(12000, 48000, 0.5), 48000, 128);
    assert.ok(pcmLevel(folded) < 0.13, String(pcmLevel(folded)));
    // 16 kHz, a whole number of periods per output sample, vanishes.
    const gone = resample(tone(16000, 48000, 0.5), 48000, 128);
    assert.ok(pcmLevel(gone) < 0.001, String(pcmLevel(gone)));
  });

  it("stretches a slower source and ignores broken samples", () => {
    const output = resample(tone(200, 8000, 1), 8000, 160);
    assert.equal(output.length, 16000);
    const broken = new PcmResampler(48000).push(
      Float32Array.from([Number.NaN, Infinity, 0.3, 0.3, 0.3, 0.3]),
    );
    assert.ok(broken.every(Number.isFinite));
    assert.throws(() => new PcmResampler(0), RangeError);
    assert.throws(() => new PcmResampler(Number.NaN), RangeError);
  });

  it("converts to 16-bit samples with clipping", () => {
    assert.deepEqual(
      [...floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5, Number.NaN]))],
      [0, 32767, -32768, 32767, -32768, 16384, 0],
    );
    assert.deepEqual(
      [...pcmBytes(Int16Array.from([1, -2, 0x1234]))],
      [1, 0, 0xfe, 0xff, 0x34, 0x12],
    );
  });

  it("measures loudness between silence and full scale", () => {
    assert.equal(pcmLevel(new Float32Array(0)), 0);
    assert.equal(pcmLevel(new Float32Array(100)), 0);
    assert.equal(pcmLevel(new Float32Array(100).fill(1)), 1);
    assert.ok(Math.abs(pcmLevel(tone(440, 16000, 1)) - 0.3536) < 0.01);
  });

  it("groups samples into half-second pieces and keeps the rest", () => {
    const batcher = new PcmBatcher();
    assert.equal(CAPTURE_PIECE_SAMPLES, 8000);
    assert.deepEqual(batcher.push(new Int16Array(7999).fill(1)), []);
    const pieces = batcher.push(new Int16Array(8003).fill(2));
    assert.equal(pieces.length, 2);
    assert.equal(pieces[0]!.length, 8000);
    assert.equal(pieces[0]![7998], 1);
    assert.equal(pieces[0]![7999], 2);
    // Pieces are not reused once handed over.
    assert.notEqual(pieces[0], pieces[1]);
    const rest = batcher.flush()!;
    assert.equal(rest.length, 2);
    assert.equal(batcher.flush(), undefined);
  });
  it("sizes high-quality pieces as half a second of whole frames", () => {
    assert.equal(capturePieceSamples(16000, 1), CAPTURE_PIECE_SAMPLES);
    assert.equal(capturePieceSamples(48000, 2), 48000);
    assert.equal(capturePieceSamples(44100, 2), 44100);
    assert.equal(capturePieceSamples(44100, 1), 22050);
    // An odd rate still ends each piece on a frame.
    assert.equal(capturePieceSamples(22051, 2) % 2, 0);
    // 96 kB a piece at 48 kHz stereo, far under the 2 MB a call may carry.
    assert.equal(
      pcmBytes(new Int16Array(capturePieceSamples(48000, 2))).length,
      96000,
    );
  });

  it("interleaves channels frame by frame and mixes them back to mono", () => {
    const left = Float32Array.from([0.1, 0.2, 0.3]);
    const right = Float32Array.from([-0.1, -0.2, -0.3, 9]);
    const both = interleave([left, right]);
    // A channel longer than the others is cut to whole frames.
    assert.deepEqual(
      [...both],
      [...Float32Array.from([0.1, -0.1, 0.2, -0.2, 0.3, -0.3])],
    );
    assert.equal(interleave([left]), left);
    assert.deepEqual([...mixToMono(both, 2)], [0, 0, 0]);
    assert.deepEqual(
      [...mixToMono(Float32Array.from([0.5, 0.25, 1, 0, 7]), 2)],
      [0.375, 0.5],
    );
    assert.equal(mixToMono(left, 1), left);
  });
});
