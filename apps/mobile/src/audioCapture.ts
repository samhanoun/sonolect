import type {
  CompanionSettings,
  DictionaryEntry,
  Snippet,
  TranscriptTurn,
} from "./domain";
import { createId } from "./domain";
import type { MobileAudioUploadResult, MobileCapturedAudio } from "./localApi";
import {
  resolveMobileLocalApiConfig,
  submitCapturedMobileAudio,
} from "./localApi";
import { cleanTranscript } from "./refine";

export type CapturedAudioPayload = MobileCapturedAudio;

export type CaptureSettings = Pick<
  CompanionSettings,
  | "cloudSyncEnabled"
  | "localApiUrl"
  | "privacyLevel"
  | "saveHistory"
  | "language"
> & { apiToken?: string | undefined };

export type StopCaptureWithAudioOptions = {
  captureStartedAt?: string | undefined;
  settings: CaptureSettings;
  /** Final text from the on-device recognizer, if it produced any. */
  recognizedText?: string | undefined;
  /** Audio recorded during the capture, if the platform persisted it. */
  audio?: CapturedAudioPayload | undefined;
  dictionary?: readonly DictionaryEntry[];
  snippets?: readonly Snippet[];
  uploadAudio?: (
    audio: CapturedAudioPayload,
  ) => Promise<MobileAudioUploadResult>;
  now?: () => number;
};

export function shouldUploadCapturedAudio(settings: CaptureSettings): boolean {
  return Boolean(resolveMobileLocalApiConfig(settings).apiUrl);
}

function defaultSyncState(
  settings: CaptureSettings,
): TranscriptTurn["syncState"] {
  if (!settings.saveHistory || settings.privacyLevel === "ephemeral") {
    return "local";
  }
  return shouldUploadCapturedAudio(settings) ? "queued" : "local";
}

export function buildTurn({
  settings,
  rawText,
  refinedText,
  startedAtMs,
  source,
  syncState,
  now = Date.now,
  durationMs,
}: {
  settings: CaptureSettings;
  rawText: string;
  refinedText: string;
  startedAtMs: number;
  source: TranscriptTurn["source"];
  syncState?: TranscriptTurn["syncState"];
  now?: () => number;
  durationMs?: number;
}): TranscriptTurn {
  return {
    id: createId("turn"),
    rawText,
    refinedText,
    mode: "dictate",
    language: settings.language,
    privacyMode: settings.privacyLevel !== "standard",
    createdAt: new Date(now()).toISOString(),
    durationMs: Math.max(0, durationMs ?? now() - startedAtMs),
    source,
    syncState: syncState ?? defaultSyncState(settings),
  };
}

/**
 * Turns a finished capture into a transcript. Prefers the Sonolect API's
 * transcript when the audio was uploaded and processed; otherwise uses the
 * on-device recognizer's text. Returns undefined when nothing was heard, so
 * the caller can show an honest "no speech detected" state instead of
 * inventing a transcript.
 */
export async function stopCaptureWithAudio({
  captureStartedAt,
  settings,
  recognizedText,
  audio,
  dictionary = [],
  snippets = [],
  uploadAudio,
  now = Date.now,
}: StopCaptureWithAudioOptions): Promise<TranscriptTurn | undefined> {
  const startedAtMs = captureStartedAt ? Date.parse(captureStartedAt) : now();
  const context = { language: settings.language, dictionary, snippets };
  const spoken = recognizedText?.trim() ?? "";

  if (audio && shouldUploadCapturedAudio(settings)) {
    const config = resolveMobileLocalApiConfig(settings);
    const result = await (
      uploadAudio ??
      ((payload: CapturedAudioPayload) =>
        submitCapturedMobileAudio(payload, config, {
          language: settings.language,
        }))
    )(audio).catch((): MobileAudioUploadResult => ({ status: "offline" }));

    if (result.status === "completed" && result.turn) {
      return {
        ...result.turn,
        language: result.turn.language || settings.language,
        privacyMode: settings.privacyLevel !== "standard",
        source: "microphone",
        syncState: "synced",
        durationMs: result.turn.durationMs || audio.durationMs,
      };
    }

    if (result.status === "submitted") {
      // The API owns this transcript now; keep its id so a later history pull
      // replaces this entry instead of duplicating it.
      const id = result.transcriptId ?? result.jobId;
      return {
        ...buildTurn({
          settings,
          rawText:
            spoken || (result.message ?? "Audio sent to the Sonolect API."),
          refinedText: spoken
            ? cleanTranscript(spoken, context)
            : "Transcribing on the Sonolect API…",
          startedAtMs,
          source: "microphone",
          syncState: "synced",
          now,
          durationMs: audio.durationMs,
        }),
        ...(id ? { id } : {}),
      };
    }
  }

  if (!spoken) return undefined;

  return buildTurn({
    settings,
    rawText: spoken,
    refinedText: cleanTranscript(spoken, context),
    startedAtMs,
    source: "microphone",
    now,
    ...(audio ? { durationMs: audio.durationMs } : {}),
  });
}
