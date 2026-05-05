import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractWaveformPeaks } from "./waveform";

type MockAudioBuffer = {
  length: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
};

describe("waveform peak extraction", () => {
  it("extracts normalized RMS peaks from actual audio samples", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.25, 0]);
    const buffer: MockAudioBuffer = {
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    };

    const peaks = extractWaveformPeaks(buffer, 4);

    assert.equal(peaks.length, 4);
    assert.deepEqual(
      peaks.map((peak) => Number(peak.toFixed(3))),
      [0.354, 0.791, 0.729, 0.177],
    );
  });

  it("pads silent buckets instead of animating fake CSS-only bars", () => {
    const buffer: MockAudioBuffer = {
      length: 2,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.25, 0.5]),
    };

    const peaks = extractWaveformPeaks(buffer, 5);

    assert.equal(peaks.length, 5);
    assert.ok(peaks[0]! > 0);
    assert.ok(peaks[1]! > peaks[0]!);
    assert.deepEqual(peaks.slice(2), [0, 0, 0]);
  });
});
