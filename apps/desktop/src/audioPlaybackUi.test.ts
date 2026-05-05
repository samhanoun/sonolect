import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const mainSource = await readFile(
  new URL("./main.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("./styles.css", import.meta.url),
  "utf8",
);
const historySource = await readFile(
  new URL("./transcriptHistory.ts", import.meta.url),
  "utf8",
);

describe("desktop audio playback UI wiring", () => {
  it("renders playback controls for recent captures and timeline entries with audio URLs", () => {
    assert.match(mainSource, /function AudioPlaybackCard/);
    assert.match(mainSource, /voiceCapture\.objectUrl/);
    assert.match(mainSource, /entry\.audioUrl/);
    assert.match(mainSource, /<audio/);
    assert.match(mainSource, /aria-label=\{t\("audio\.playPause"\)\}/);
  });

  it("drives waveform bars from decoded audio peaks", () => {
    assert.match(mainSource, /decodeAudioWaveform/);
    assert.doesNotMatch(mainSource, /animationDelay: `\$\{index \* 45\}ms`/);
    assert.match(mainSource, /aria-label=\{t\("audio\.waveform"\)\}/);
    assert.match(stylesSource, /\.waveform-bar/);
    assert.doesNotMatch(stylesSource, /@keyframes waveformPulse/);
  });

  it("preserves history audio URLs when the API provides an audio source", () => {
    assert.match(historySource, /audioUrl\?: string/);
    assert.match(historySource, /audio\?\.uri/);
  });
});
