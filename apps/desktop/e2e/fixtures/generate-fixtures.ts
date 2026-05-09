/**
 * Generate test WAV fixture files for E2E tests.
 *
 * Run with: pnpm dlx tsx@4.19.2 e2e/fixtures/generate-fixtures.ts
 *
 * Produces:
 *   - silence.wav  — 1 second of silence (16 kHz, 16-bit, mono)
 *   - tone.wav     — 1 second 440 Hz sine wave (16 kHz, 16-bit, mono)
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 16_000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const WAV_HEADER_SIZE = 44;

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function buildWavHeader(numSamples: number): ArrayBuffer {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const blockAlign = NUM_CHANNELS * bytesPerSample;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = WAV_HEADER_SIZE - 8 + dataSize;

  const buffer = new ArrayBuffer(WAV_HEADER_SIZE);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return buffer;
}

function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): Buffer {
  const result = Buffer.alloc(a.byteLength + b.byteLength);
  result.set(new Uint8Array(a), 0);
  result.set(new Uint8Array(b), a.byteLength);
  return result;
}

function generateSilence(durationMs: number): Buffer {
  const numSamples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const header = buildWavHeader(numSamples);
  const data = new ArrayBuffer(numSamples * 2); // zero-initialized
  return concatBuffers(header, data);
}

function generateTone(durationMs: number, frequencyHz: number): Buffer {
  const numSamples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const header = buildWavHeader(numSamples);
  const data = new ArrayBuffer(numSamples * 2);
  const view = new DataView(data);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    view.setInt16(i * 2, Math.round(sample * 0.9 * 32767), true);
  }

  return concatBuffers(header, data);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));

const silencePath = join(scriptDir, "silence.wav");
const tonePath = join(scriptDir, "tone.wav");

writeFileSync(silencePath, generateSilence(1000));
console.log(`Generated: ${silencePath} (1s silence, 16kHz 16-bit mono)`);

writeFileSync(tonePath, generateTone(1000, 440));
console.log(`Generated: ${tonePath} (1s 440Hz tone, 16kHz 16-bit mono)`);
