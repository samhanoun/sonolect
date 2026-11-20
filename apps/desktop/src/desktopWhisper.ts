import type { VoiceCaptureMetadata } from "./voiceApi";
import type { TranscriptSegment } from "./segmentEditor";
import { prepareLocalAudio } from "./localAudio";

/**
 * Audio goes to the native engine as the raw IPC body. Sending it as a JSON
 * number array (the old format) inflated a three-minute recording from 5.8 MB
 * to roughly 20 MB of JSON that both sides had to build and parse.
 * Settings travel as percent-encoded headers so non-ASCII model paths work.
 */
export type DesktopWhisperRequest = {
  body: Uint8Array;
  headers: Record<string, string>;
};

export type DesktopWhisperSegmentPayload = {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
};

export type DesktopWhisperResult = {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
  /** The saved recording behind this transcript, for playback in the editor. */
  captureId?: string;
};

export function createDesktopWhisperRequest(
  audioBytes: Uint8Array,
  metadata: VoiceCaptureMetadata,
  language?: string,
  modelPath?: string,
): DesktopWhisperRequest {
  const headers: Record<string, string> = {
    "x-sonolect-duration-ms": String(
      Math.max(1, Math.round(metadata.durationMs)),
    ),
  };
  if (language && language !== "auto")
    headers["x-sonolect-language"] = encodeURIComponent(language);
  if (modelPath?.trim())
    headers["x-sonolect-model-path"] = encodeURIComponent(modelPath.trim());
  return { body: audioBytes, headers };
}

export function normalizeWhisperSegments(
  segments: DesktopWhisperSegmentPayload[],
): TranscriptSegment[] {
  return segments
    .map((segment, index) => {
      const startMs = Math.max(0, Math.round(segment.startMs));
      const endMs = Math.max(startMs + 1, Math.round(segment.endMs));
      return {
        id: `whisper-${index + 1}`,
        text: segment.text.trim(),
        startMs,
        endMs,
        ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
      };
    })
    .filter((segment) => segment.text.length > 0);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function transcribeWithDesktopWhisper(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
  language?: string,
  modelPath?: string,
): Promise<DesktopWhisperResult | undefined> {
  if (!isTauriRuntime()) return undefined;

  const [{ invoke }, audioBytes] = await Promise.all([
    import("@tauri-apps/api/core"),
    prepareLocalAudio(audio),
  ]);
  const request = createDesktopWhisperRequest(
    audioBytes,
    metadata,
    language,
    modelPath,
  );
  const result = await invoke<{
    text: string;
    segments?: DesktopWhisperSegmentPayload[];
    language?: string;
    captureId?: string;
  }>("transcribe_audio", request.body, { headers: request.headers });

  return {
    text: result.text.trim(),
    segments: normalizeWhisperSegments(result.segments ?? []),
    ...(result.language ? { language: result.language } : {}),
    ...(result.captureId ? { captureId: result.captureId } : {}),
  };
}
