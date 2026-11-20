/**
 * Floating dictation bubble: the always-on-top glass pill that shows the
 * dictation state while you talk in any app, then pastes the result into the
 * app that has focus.
 *
 * The main window owns the microphone, the speech engine and insertion. The
 * bubble window (label "recorder") only renders what the main window sends it
 * and sends back button presses. This module holds the shared protocol and the
 * pure helpers so both sides (and the tests) agree on it.
 */

import type { RecordingState } from "./store/appStore";

export const BUBBLE_WINDOW_LABEL = "recorder";
export const MAIN_WINDOW_LABEL = "main";

/** main → bubble: full state snapshot (sent on every change). */
export const BUBBLE_STATE_EVENT = "sonolect://bubble/state";
/** main → bubble: microphone level frames while listening. */
export const BUBBLE_LEVEL_EVENT = "sonolect://bubble/level";
/** bubble → main: button presses. */
export const BUBBLE_ACTION_EVENT = "sonolect://bubble/action";
/** bubble → main: the bubble mounted and wants the current state. */
export const BUBBLE_READY_EVENT = "sonolect://bubble/ready";

export type BubbleVisibility = "always" | "dictating" | "off";
export const BUBBLE_VISIBILITY_KEY = "sonolect.bubbleVisibility";
export const DEFAULT_BUBBLE_VISIBILITY: BubbleVisibility = "always";

export type BubblePhase =
  "idle" | "listening" | "transcribing" | "inserted" | "copied" | "error";

export type DictationSource = "app" | "hotkey" | "bubble";

/** What happened to the last bubble dictation once it was transcribed. */
export type DictationOutcome =
  | { kind: "inserted"; text: string }
  | { kind: "copied"; text: string; reason: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export type BubbleState = {
  phase: BubblePhase;
  /** Epoch ms when listening started, for the live timer. */
  startedAt: number | null;
  /** Short status line under the pill (result preview or error). */
  detail: string | null;
  /** Accelerator shown in the idle hint, e.g. "Ctrl+Shift+M". */
  hotkey: string;
};

export type BubbleAction = "toggle" | "finish" | "cancel" | "open-app";

const BUBBLE_ACTIONS: readonly BubbleAction[] = [
  "toggle",
  "finish",
  "cancel",
  "open-app",
];

export function isBubbleAction(value: unknown): value is BubbleAction {
  return (
    typeof value === "string" &&
    (BUBBLE_ACTIONS as readonly string[]).includes(value)
  );
}

export function parseBubbleVisibility(
  raw: string | null | undefined,
): BubbleVisibility {
  return raw === "always" || raw === "dictating" || raw === "off"
    ? raw
    : DEFAULT_BUBBLE_VISIBILITY;
}

/** Map the store's capture state plus the last outcome to what the bubble shows. */
export function bubblePhaseFor(
  recordingState: RecordingState,
  outcome: DictationOutcome | undefined,
  source: DictationSource,
): BubblePhase {
  switch (recordingState) {
    case "requesting-permission":
    case "recording":
      return "listening";
    case "uploading":
      return "transcribing";
    case "error":
      return "error";
    case "completed":
      // In-app captures land in the editor; the bubble just goes back to idle.
      if (source === "app") return "idle";
      // Transcribed, still pasting into the focused app.
      if (!outcome) return "transcribing";
      if (outcome.kind === "inserted") return "inserted";
      if (outcome.kind === "copied") return "copied";
      if (outcome.kind === "error") return "error";
      return "idle";
    default:
      return "idle";
  }
}

const DETAIL_MAX = 64;

export function previewDetail(text: string, max = DETAIL_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function bubbleDetailFor(
  phase: BubblePhase,
  outcome: DictationOutcome | undefined,
  voiceError: string | undefined,
): string | null {
  if (phase === "inserted" && outcome?.kind === "inserted") {
    return previewDetail(outcome.text);
  }
  if (phase === "copied" && outcome?.kind === "copied") {
    return "Copied. Press Ctrl+V to paste.";
  }
  if (phase === "error") {
    if (outcome?.kind === "error") return previewDetail(outcome.message);
    if (voiceError) return previewDetail(humanizeVoiceError(voiceError));
    return "Something went wrong.";
  }
  return null;
}

const VOICE_ERROR_TEXT: Record<string, string> = {
  "error.micUnavailable": "No microphone found.",
  "error.micPermissionDenied": "Microphone access was denied.",
  "error.mediaRecorderUnsupported": "Recording is not supported here.",
  "error.recordingError": "Recording stopped unexpectedly.",
  "error.sendFailed": "Transcription failed.",
};

export function humanizeVoiceError(code: string): string {
  return VOICE_ERROR_TEXT[code] ?? code;
}

/** Whether the bubble window should be on screen. */
export function shouldShowBubble(
  visibility: BubbleVisibility,
  phase: BubblePhase,
): boolean {
  if (visibility === "off") return false;
  if (visibility === "always") return true;
  return phase !== "idle";
}

/** How long a finished state (inserted / copied / error) stays before idle. */
export const OUTCOME_LINGER_MS = 2200;

/** Bubble window sizes in logical pixels (the window hugs the pill). */
export const BUBBLE_IDLE_SIZE = { width: 132, height: 40 } as const;
export const BUBBLE_ACTIVE_SIZE = { width: 300, height: 92 } as const;

export function bubbleSizeFor(phase: BubblePhase): {
  width: number;
  height: number;
} {
  return phase === "idle" ? BUBBLE_IDLE_SIZE : BUBBLE_ACTIVE_SIZE;
}

/** Root-mean-square of a block of PCM samples, scaled to a 0..1 meter value. */
export function levelFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  // Speech RMS sits around 0.02–0.2; a soft-knee curve keeps quiet voices visible.
  const scaled = Math.min(1, Math.sqrt(rms * 6));
  return Math.round(scaled * 100) / 100;
}

/** Keep a rolling window of the last `count` levels for the waveform. */
export function pushLevel(
  history: number[],
  level: number,
  count = 18,
): number[] {
  const next = history.length >= count ? history.slice(1) : history.slice();
  next.push(Math.max(0, Math.min(1, level)));
  return next;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "CommandOrControl+Shift+M" → "Ctrl+Shift+M" (or ⌘⇧M on macOS). */
export function displayAccelerator(accelerator: string, mac = false): string {
  const parts = accelerator.split("+").map((p) => p.trim());
  if (mac) {
    const map: Record<string, string> = {
      CommandOrControl: "⌘",
      Shift: "⇧",
      Alt: "⌥",
      Control: "⌃",
    };
    return parts.map((p) => map[p] ?? p).join("");
  }
  return parts
    .map((p) => (p === "CommandOrControl" || p === "Control" ? "Ctrl" : p))
    .join("+");
}
