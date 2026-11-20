import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSweepableCacheFile } from "./cacheFiles";

describe("isSweepableCacheFile", () => {
  it("matches recordings, recorder temp files and note exports", () => {
    for (const name of [
      "recording_1A2B.wav",
      "recording_x.caf",
      "recording_1731240000000.wav",
      "recording_6F9619FF-8B86-D011-B42D-00CF4FC964FF.wav",
      "temp_0b9d.pcm",
      "temp_3f2c9a4e-8d1b-4c55-9a51-0f7e2d6b1c33.pcm",
      "sonolect-notes-2026-11-10.md",
    ]) {
      assert.equal(isSweepableCacheFile(name), true, name);
    }
  });

  it("leaves every other file alone", () => {
    for (const name of [
      "notes.md",
      "recording.wav",
      "some_temp_x.pcm",
      "ExpoSpeechService.log",
      "recording_1A2B.wav.bak",
      "temp_0b9d.pcm.tmp",
      "my-recording_1.wav",
      "sonolect-notes-2026-11-10.txt",
      "",
    ]) {
      assert.equal(isSweepableCacheFile(name), false, name);
    }
  });
});
