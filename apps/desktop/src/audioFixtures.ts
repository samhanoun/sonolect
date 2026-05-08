/**
 * Programmatic WAV generation for tests.
 *
 * Generates valid 16-bit mono PCM WAV buffers without external dependencies.
 * All audio is Whisper-compatible: 16 kHz, 16-bit, mono.
 */

const DEFAULT_SAMPLE_RATE = 16_000;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const WAV_HEADER_SIZE = 44;

/**
 * Build a canonical 44-byte RIFF/WAVE header for PCM audio.
 */
export function generateWavHeader(
  numSamples: number,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
  bitsPerSample: number = BITS_PER_SAMPLE,
): ArrayBuffer {
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = NUM_CHANNELS * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = WAV_HEADER_SIZE - 8 + dataSize;

  const buffer = new ArrayBuffer(WAV_HEADER_SIZE);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize, true);
  writeString(view, 8, "WAVE");

  // "fmt " sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true); // audio format (PCM = 1)
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return buffer;
}

/**
 * Generate a WAV buffer containing silence (all-zero samples).
 */
export function generateSilenceWav(
  durationMs: number,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): ArrayBuffer {
  const numSamples = Math.round((durationMs / 1000) * sampleRate);
  const header = generateWavHeader(numSamples, sampleRate, BITS_PER_SAMPLE);
  const dataSize = numSamples * (BITS_PER_SAMPLE / 8);
  const data = new ArrayBuffer(dataSize); // zero-initialized

  return concatBuffers(header, data);
}

/**
 * Generate a WAV buffer containing a pure sine-wave tone.
 */
export function generateToneWav(
  durationMs: number,
  frequencyHz: number = 440,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): ArrayBuffer {
  const numSamples = Math.round((durationMs / 1000) * sampleRate);
  const header = generateWavHeader(numSamples, sampleRate, BITS_PER_SAMPLE);
  const data = new ArrayBuffer(numSamples * 2);
  const view = new DataView(data);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequencyHz * t);
    // Scale to 16-bit range (-32768..32767), use 0.9 amplitude to avoid clipping
    const int16 = Math.round(sample * 0.9 * 32767);
    view.setInt16(i * 2, int16, true);
  }

  return concatBuffers(header, data);
}

/**
 * Generate a WAV buffer containing white noise at a given amplitude.
 */
export function generateWhiteNoiseWav(
  durationMs: number,
  amplitude: number = 0.5,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): ArrayBuffer {
  const numSamples = Math.round((durationMs / 1000) * sampleRate);
  const header = generateWavHeader(numSamples, sampleRate, BITS_PER_SAMPLE);
  const data = new ArrayBuffer(numSamples * 2);
  const view = new DataView(data);

  // Simple deterministic pseudo-random (xorshift32) for reproducibility
  let seed = 42;
  for (let i = 0; i < numSamples; i++) {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    // Map to [-1, 1]
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    const int16 = Math.round(noise * amplitude * 32767);
    view.setInt16(i * 2, int16, true);
  }

  return concatBuffers(header, data);
}

/**
 * Extract raw PCM samples from a WAV buffer as Float32Array.
 * Assumes 16-bit mono PCM with a standard 44-byte header.
 */
export function wavToFloat32(wavBuffer: ArrayBuffer): Float32Array {
  const view = new DataView(wavBuffer);

  // Validate RIFF header
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV: missing RIFF header");
  }

  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (wave !== "WAVE") {
    throw new Error("Invalid WAV: missing WAVE identifier");
  }

  const dataSize = view.getUint32(40, true);
  const numSamples = dataSize / 2; // 16-bit = 2 bytes per sample
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const int16 = view.getInt16(WAV_HEADER_SIZE + i * 2, true);
    samples[i] = int16 / 32768;
  }

  return samples;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function concatBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const result = new ArrayBuffer(a.byteLength + b.byteLength);
  const view = new Uint8Array(result);
  view.set(new Uint8Array(a), 0);
  view.set(new Uint8Array(b), a.byteLength);
  return result;
}
