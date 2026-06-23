import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const historySource = await readFile(
  new URL("./transcriptHistory.ts", import.meta.url),
  "utf8",
);

// The in-timeline audio-playback UI (AudioPlaybackCard / inline Waveform) was
// removed when the home/history screen was migrated to the new Tailwind design.
// The history data layer still preserves audio URLs for a future playback UI.
describe("transcript history audio data", () => {
  it("preserves history audio URLs when the API provides an audio source", () => {
    assert.match(historySource, /audioUrl\?: string/);
    assert.match(historySource, /audio\?\.uri/);
  });
});
