import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  createWhisperModeState,
  updateInputLevel,
  toggleWhisperMode,
  getWhisperModeLabel,
  getInputLevelIndicator,
} from "./whisperModeUi";

describe("whisperModeUi", () => {
  describe("createWhisperModeState", () => {
    it("starts disabled with normal preset", () => {
      const state = createWhisperModeState();
      assert.equal(state.enabled, false);
      assert.equal(state.inputLevel, 0);
      assert.equal(state.suggestedPreset, "normal");
      assert.equal(state.activePreset, "normal");
    });
  });

  describe("updateInputLevel", () => {
    it("updates level and suggests whisper for quiet input", () => {
      const state = createWhisperModeState();
      const updated = updateInputLevel(state, 0.02);

      assert.equal(updated.inputLevel, 0.02);
      assert.equal(updated.suggestedPreset, "whisper");
      assert.equal(updated.activePreset, "normal"); // unchanged
    });

    it("suggests noisy for loud input", () => {
      const state = createWhisperModeState();
      const updated = updateInputLevel(state, 0.5);

      assert.equal(updated.suggestedPreset, "noisy");
    });

    it("suggests normal for moderate input", () => {
      const state = createWhisperModeState();
      const updated = updateInputLevel(state, 0.15);

      assert.equal(updated.suggestedPreset, "normal");
    });

    it("does not mutate original state", () => {
      const state = createWhisperModeState();
      const updated = updateInputLevel(state, 0.3);

      assert.equal(state.inputLevel, 0);
      assert.equal(updated.inputLevel, 0.3);
    });
  });

  describe("toggleWhisperMode", () => {
    it("enables whisper preset from normal", () => {
      const state = createWhisperModeState();
      const toggled = toggleWhisperMode(state);

      assert.equal(toggled.enabled, true);
      assert.equal(toggled.activePreset, "whisper");
    });

    it("disables back to normal", () => {
      const state = createWhisperModeState();
      const enabled = toggleWhisperMode(state);
      const disabled = toggleWhisperMode(enabled);

      assert.equal(disabled.enabled, false);
      assert.equal(disabled.activePreset, "normal");
    });

    it("does not mutate original state", () => {
      const state = createWhisperModeState();
      const toggled = toggleWhisperMode(state);

      assert.equal(state.enabled, false);
      assert.equal(toggled.enabled, true);
    });
  });

  describe("getWhisperModeLabel", () => {
    it('returns "Normal Mode" for normal preset', () => {
      const state = createWhisperModeState();
      assert.equal(getWhisperModeLabel(state), "Normal Mode");
    });

    it('returns "Whisper Mode" when whisper is active', () => {
      const state = toggleWhisperMode(createWhisperModeState());
      assert.equal(getWhisperModeLabel(state), "Whisper Mode");
    });

    it('returns "Noisy Environment" for noisy preset', () => {
      const state = {
        ...createWhisperModeState(),
        activePreset: "noisy" as const,
      };
      assert.equal(getWhisperModeLabel(state), "Noisy Environment");
    });

    it('returns "Normal Mode" for custom preset', () => {
      const state = {
        ...createWhisperModeState(),
        activePreset: "custom" as const,
      };
      assert.equal(getWhisperModeLabel(state), "Normal Mode");
    });
  });

  describe("getInputLevelIndicator", () => {
    it("returns lowest bar for silence", () => {
      assert.equal(getInputLevelIndicator(0), "▁");
    });

    it("returns highest bar for full scale", () => {
      assert.equal(getInputLevelIndicator(1), "█");
    });

    it("returns a mid-range bar for 0.5", () => {
      const bar = getInputLevelIndicator(0.5);
      assert.equal(bar, "▅");
    });

    it("clamps negative levels to lowest bar", () => {
      assert.equal(getInputLevelIndicator(-1), "▁");
    });

    it("clamps levels above 1 to highest bar", () => {
      assert.equal(getInputLevelIndicator(5), "█");
    });

    it("returns progressively taller bars as level increases", () => {
      const levels = [0.0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
      const bars = levels.map(getInputLevelIndicator);
      for (let i = 1; i < bars.length; i++) {
        assert.ok(
          bars[i]! >= bars[i - 1]!,
          `Bar at level ${levels[i]} should be >= bar at level ${levels[i - 1]}`,
        );
      }
    });
  });
});
