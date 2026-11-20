import type { CaptureSession, CaptureStatus, TranscriptTurn } from "./domain";

/**
 * Quick dictation's rules (sonolect://dictate). Pure: the screen applies
 * them to the store and the app's state.
 */

/** Whether a link opens Quick dictation, whatever its scheme or query. */
export function isQuickDictationLink(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return /\/dictate\/?$/.test(path);
}

export type QuickStart = "start" | "adopt" | "wait";

/**
 * What Quick dictation does when it wants a dictation. It waits while the
 * app is not in front, where the microphone can't start, and while the
 * previous dictation is still being polished. One that is already listening
 * becomes its own.
 */
export function quickStart(
  appState: string | null | undefined,
  status: CaptureStatus,
): QuickStart {
  if (appState === "background" || appState === "inactive") return "wait";
  if (status === "processing") return "wait";
  return status === "listening" ? "adopt" : "start";
}

/**
 * Whether a dictation heard while Quick dictation was in front is still
 * under way: listening, or being polished afterwards.
 */
export function stillHeard(heard: boolean, status: CaptureStatus): boolean {
  return status === "listening" || (heard && status === "processing");
}

interface DictationState {
  capture: { status: CaptureStatus };
  latest?: TranscriptTurn | undefined;
}

/**
 * The note a dictation just ended with: polishing ends 'ready' with a new
 * latest note in the same change. The latest note also changes when it is
 * refined or when history syncs, which is no dictation's result.
 */
export function dictationResult(
  previous: DictationState,
  state: DictationState,
): TranscriptTurn | null {
  if (previous.capture.status !== "processing") return null;
  if (state.capture.status !== "ready") return null;
  if (!state.latest || state.latest === previous.latest) return null;
  return state.latest;
}

/**
 * How a dictation ends when Quick dictation leaves the screen: it never
 * keeps listening unseen. What it heard is kept as a note; with nothing
 * heard yet there is nothing to keep, nor a "no speech" notice to raise.
 */
export function leaveAction(
  capture: Pick<CaptureSession, "status" | "partialTranscript">,
): "stop" | "cancel" | "none" {
  if (capture.status !== "listening") return "none";
  return capture.partialTranscript.trim() ? "stop" : "cancel";
}
