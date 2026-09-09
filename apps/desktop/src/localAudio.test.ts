import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeMonoWav } from "./localAudio";

it("converts stereo 48kHz into mono 16kHz PCM WAV", () => {
  const bytes = encodeMonoWav([new Float32Array(480).fill(0.75), new Float32Array(480).fill(0.25)], 48_000);
  const view = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 320);
  assert.equal(view.getInt16(44, true), 16384);
});
it("clips samples and preserves silence", () => {
  const data = new DataView(encodeMonoWav([new Float32Array([2, -2, 0])], 16_000).buffer);
  assert.equal(data.getInt16(44, true), 32767);
  assert.equal(data.getInt16(46, true), -32768);
  assert.equal(data.getInt16(48, true), 0);
});
it("rejects invalid or empty audio before inference", () => {
  assert.throws(() => encodeMonoWav([], 0));
  assert.throws(() => encodeMonoWav([new Float32Array()], 16_000));
  assert.throws(() => encodeMonoWav([new Float32Array([NaN])], 16_000));
});
