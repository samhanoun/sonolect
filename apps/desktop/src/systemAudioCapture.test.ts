import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialAudioState,
  getSetupGuide,
  type Platform,
} from "./systemAudioCapture";

describe("systemAudioCapture", () => {
  describe("createInitialAudioState", () => {
    it("returns unavailable status with defaults", () => {
      const state = createInitialAudioState();
      assert.equal(state.status, "unavailable");
      assert.equal(state.sampleRate, 44100);
      assert.equal(state.channels, 1);
      assert.equal(state.error, undefined);
    });
  });

  describe("getSetupGuide", () => {
    it("returns PulseAudio guide for Linux", () => {
      const guide = getSetupGuide("linux");
      assert.equal(guide.platform, "linux");
      assert.ok(guide.title.includes("PulseAudio"));
      assert.ok(guide.steps.length > 0);
      assert.ok(guide.checkCommand.includes("pactl"));
    });

    it("returns BlackHole guide for macOS", () => {
      const guide = getSetupGuide("macos");
      assert.equal(guide.platform, "macos");
      assert.ok(guide.title.includes("BlackHole"));
      assert.ok(guide.steps.length > 0);
    });

    it("returns Stereo Mix guide for Windows", () => {
      const guide = getSetupGuide("windows");
      assert.equal(guide.platform, "windows");
      assert.ok(
        guide.title.includes("Stereo Mix") || guide.title.includes("WASAPI"),
      );
      assert.ok(guide.steps.length > 0);
    });

    it("returns unsupported for unknown platform", () => {
      const guide = getSetupGuide("unknown");
      assert.ok(guide.title.includes("Unsupported"));
    });

    const platforms: Platform[] = ["linux", "macos", "windows", "unknown"];
    for (const p of platforms) {
      it(`guide for ${p} has non-empty steps`, () => {
        assert.ok(getSetupGuide(p).steps.length > 0);
      });
    }
  });
});
