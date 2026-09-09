import type { VoiceCaptureMetadata } from "./voiceApi";
import type { TranscriptSegment } from "./segmentEditor";

export type DesktopWhisperPayload = {
  audioBytes: number[];
  mimeType: string;
  durationMs: number;
  language?: string;
  modelPath?: string;
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
};

export function createDesktopWhisperPayload(
  audioBytes: Uint8Array,
  metadata: VoiceCaptureMetadata,
  language?: string,
  modelPath?: string,
): DesktopWhisperPayload {
  return {
    audioBytes: Array.from(audioBytes),
    mimeType: metadata.mimeType,
    durationMs: Math.max(1, Math.round(metadata.durationMs)),
    ...(language && language !== "auto" ? { language } : {}),
    ...(modelPath?.trim() ? { modelPath: modelPath.trim() } : {}),
  };
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

  const { invoke } = await import("@tauri-apps/api/core");
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const payload = createDesktopWhisperPayload(audioBytes, metadata, language, modelPath);
  const result = await invoke<{
    text: string;
    segments?: DesktopWhisperSegmentPayload[];
    language?: string;
  }>("transcribe_audio", { payload });

  return {
    text: result.text.trim(),
    segments: normalizeWhisperSegments(result.segments ?? []),
    ...(result.language ? { language: result.language } : {}),
  };
}
