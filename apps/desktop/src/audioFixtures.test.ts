import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateWavHeader,
  generateSilenceWav,
  generateToneWav,
  generateWhiteNoiseWav,
  wavToFloat32,
} from "./audioFixtures";

describe("audioFixtures — WAV generation utilities", () => {
  describe("generateWavHeader", () => {
    it("produces a 44-byte RIFF/WAVE header", () => {
      const header = generateWavHeader(100, 16000, 16);
      assert.equal(header.byteLength, 44);
    });

    it("starts with RIFF magic bytes", () => {
      const header = generateWavHeader(100, 16000, 16);
      const bytes = new Uint8Array(header);
      const riff = String.fromCharCode(
        bytes[0]!,
        bytes[1]!,
        bytes[2]!,
        bytes[3]!,
      );
      assert.equal(riff, "RIFF");
    });

    it("contains WAVE identifier at offset 8", () => {
      const header = generateWavHeader(100, 16000, 16);
      const bytes = new Uint8Array(header);
      const wave = String.fromCharCode(
        bytes[8]!,
        bytes[9]!,
        bytes[10]!,
        bytes[11]!,
      );
      assert.equal(wave, "WAVE");
    });

    it("contains fmt and data sub-chunk markers", () => {
      const header = generateWavHeader(100, 16000, 16);
      const bytes = new Uint8Array(header);
      const fmt = String.fromCharCode(
        bytes[12]!,
        bytes[13]!,
        bytes[14]!,
        bytes[15]!,
      );
      const data = String.fromCharCode(
        bytes[36]!,
        bytes[37]!,
        bytes[38]!,
        bytes[39]!,
      );
      assert.equal(fmt, "fmt ");
      assert.equal(data, "data");
    });

    it("encodes PCM format (1) at offset 20", () => {
      const header = generateWavHeader(100, 16000, 16);
      const view = new DataView(header);
      assert.equal(view.getUint16(20, true), 1);
    });

    it("encodes correct sample rate and channel count", () => {
      const header = generateWavHeader(100, 44100, 16);
      const view = new DataView(header);
      assert.equal(view.getUint16(22, true), 1); // mono
      assert.equal(view.getUint32(24, true), 44100);
    });

    it("sets correct data size for given sample count", () => {
      const numSamples = 256;
      const header = generateWavHeader(numSamples, 16000, 16);
      const view = new DataView(header);
      // data size = numSamples * 2 bytes (16-bit)
      assert.equal(view.getUint32(40, true), numSamples * 2);
    });
  });

  describe("generateSilenceWav", () => {
    it("generates a valid WAV buffer", () => {
      const wav = generateSilenceWav(1000);
      const bytes = new Uint8Array(wav);
      const riff = String.fromCharCode(
        bytes[0]!,
        bytes[1]!,
        bytes[2]!,
        bytes[3]!,
      );
      assert.equal(riff, "RIFF");
    });

    it("contains all zero samples", () => {
      const wav = generateSilenceWav(100);
      const samples = wavToFloat32(wav);
      const allZero = samples.every((s) => s === 0);
      assert.ok(allZero, "Expected all samples to be zero for silence");
    });

    it("has correct sample count for given duration", () => {
      const durationMs = 500;
      const sampleRate = 16000;
      const wav = generateSilenceWav(durationMs, sampleRate);
      const samples = wavToFloat32(wav);
      const expectedSamples = Math.round((durationMs / 1000) * sampleRate);
      assert.equal(samples.length, expectedSamples);
    });

    it("has correct total byte length (header + PCM data)", () => {
      const durationMs = 1000;
      const sampleRate = 16000;
      const wav = generateSilenceWav(durationMs, sampleRate);
      const expectedSamples = Math.round((durationMs / 1000) * sampleRate);
      assert.equal(wav.byteLength, 44 + expectedSamples * 2);
    });
  });

  describe("generateToneWav", () => {
    it("generates non-zero samples", () => {
      const wav = generateToneWav(100, 440);
      const samples = wavToFloat32(wav);
      const hasNonZero = samples.some((s) => Math.abs(s) > 0.01);
      assert.ok(hasNonZero, "Expected tone to have non-zero samples");
    });

    it("has correct sample count for given duration", () => {
      const durationMs = 250;
      const sampleRate = 16000;
      const wav = generateToneWav(durationMs, 440, sampleRate);
      const samples = wavToFloat32(wav);
      const expectedSamples = Math.round((durationMs / 1000) * sampleRate);
      assert.equal(samples.length, expectedSamples);
    });

    it("generates samples within valid 16-bit range when converted back", () => {
      const wav = generateToneWav(100, 440);
      const samples = wavToFloat32(wav);
      const inRange = samples.every((s) => s >= -1 && s <= 1);
      assert.ok(inRange, "Expected all samples to be in [-1, 1]");
    });

    it("produces audible energy above VAD threshold", () => {
      const wav = generateToneWav(100, 440);
      const samples = wavToFloat32(wav);
      // Compute RMS energy
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i]! * samples[i]!;
      }
      const rms = Math.sqrt(sum / samples.length);
      // Should be well above the default VAD threshold of 0.01
      assert.ok(rms > 0.1, `Expected RMS ${rms} to be above 0.1`);
    });
  });

  describe("generateWhiteNoiseWav", () => {
    it("generates non-zero samples", () => {
      const wav = generateWhiteNoiseWav(100, 0.5);
      const samples = wavToFloat32(wav);
      const hasNonZero = samples.some((s) => Math.abs(s) > 0.001);
      assert.ok(hasNonZero, "Expected white noise to have non-zero samples");
    });

    it("respects amplitude parameter", () => {
      const lowAmp = generateWhiteNoiseWav(100, 0.1);
      const highAmp = generateWhiteNoiseWav(100, 0.9);

      const lowSamples = wavToFloat32(lowAmp);
      const highSamples = wavToFloat32(highAmp);

      let lowMax = 0;
      for (let i = 0; i < lowSamples.length; i++) {
        lowMax = Math.max(lowMax, Math.abs(lowSamples[i]!));
      }
      let highMax = 0;
      for (let i = 0; i < highSamples.length; i++) {
        highMax = Math.max(highMax, Math.abs(highSamples[i]!));
      }

      assert.ok(
        highMax > lowMax,
        `Expected high amplitude max ${highMax} > low amplitude max ${lowMax}`,
      );
    });
  });

  describe("wavToFloat32", () => {
    it("throws on invalid buffer (no RIFF header)", () => {
      const bad = new ArrayBuffer(44);
      assert.throws(() => wavToFloat32(bad), /RIFF/);
    });

    it("roundtrips tone samples correctly", () => {
      const wav = generateToneWav(50, 440, 16000);
      const samples = wavToFloat32(wav);
      const expectedSamples = Math.round((50 / 1000) * 16000);
      assert.equal(samples.length, expectedSamples);

      // Verify sine-like pattern: first quarter-period should be positive
      const quarterPeriodSamples = Math.floor(16000 / 440 / 4);
      for (let i = 1; i < Math.min(quarterPeriodSamples, samples.length); i++) {
        assert.ok(
          samples[i]! > 0,
          `Expected positive sample at index ${i} in first quarter period`,
        );
      }
    });

    it("roundtrips silence correctly", () => {
      const wav = generateSilenceWav(50, 16000);
      const samples = wavToFloat32(wav);
      const allZero = samples.every((s) => s === 0);
      assert.ok(allZero, "Silence roundtrip should yield all zeros");
    });

    it("sample count matches duration", () => {
      for (const durationMs of [100, 500, 1000, 2500]) {
        const sampleRate = 16000;
        const wav = generateToneWav(durationMs, 440, sampleRate);
        const samples = wavToFloat32(wav);
        const expected = Math.round((durationMs / 1000) * sampleRate);
        assert.equal(
          samples.length,
          expected,
          `Duration ${durationMs}ms: expected ${expected} samples, got ${samples.length}`,
        );
      }
    });
  });
});
