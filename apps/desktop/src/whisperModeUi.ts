/**
 * Whisper-mode UI state helpers — pure functions for managing
 * the whisper/normal/noisy toggle and input-level display.
 */

import type { AudioPreset } from "./audioPreprocessing";
import { suggestPreset } from "./audioPreprocessing";

export type WhisperModeState = {
  enabled: boolean;
  inputLevel: number;
  suggestedPreset: AudioPreset;
  activePreset: AudioPreset;
};

/** Create the default (disabled) whisper-mode state. */
export function createWhisperModeState(): WhisperModeState {
  return {
    enabled: false,
    inputLevel: 0,
    suggestedPreset: "normal",
    activePreset: "normal",
  };
}

/** Update input level and auto-suggest a preset (does not change activePreset). */
export function updateInputLevel(
  state: WhisperModeState,
  rmsLevel: number,
): WhisperModeState {
  return {
    ...state,
    inputLevel: rmsLevel,
    suggestedPreset: suggestPreset(rmsLevel),
  };
}

/** Toggle between normal and whisper presets. */
export function toggleWhisperMode(state: WhisperModeState): WhisperModeState {
  const enabled = !state.enabled;
  return {
    ...state,
    enabled,
    activePreset: enabled ? "whisper" : "normal",
  };
}

/** Return a human-readable label for the current mode. */
export function getWhisperModeLabel(state: WhisperModeState): string {
  switch (state.activePreset) {
    case "whisper":
      return "Whisper Mode";
    case "noisy":
      return "Noisy Environment";
    default:
      return "Normal Mode";
  }
}

const LEVEL_BARS = "▁▂▃▄▅▆▇█";

/**
 * Return a visual bar indicator for the given input level (0-1).
 * Maps the level to one of 8 bar characters.
 */
export function getInputLevelIndicator(level: number): string {
  const clamped = Math.max(0, Math.min(1, level));
  const index = Math.min(
    LEVEL_BARS.length - 1,
    Math.floor(clamped * LEVEL_BARS.length),
  );
  return LEVEL_BARS[index]!;
}
