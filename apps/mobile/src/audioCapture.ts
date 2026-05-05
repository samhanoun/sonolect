import type { CompanionSettings, TranscriptTurn } from "./domain";
import { SAMPLE_TRANSCRIPTS } from "./domain";
import type { MobileAudioUploadResult, MobileCapturedAudio } from "./localApi";
import {
  resolveMobileLocalApiConfig,
  submitCapturedMobileAudio,
} from "./localApi";
import type { SonolectMode } from "@sonolect/types";

export type CapturedAudioPayload = MobileCapturedAudio;

export interface MobileAudioCaptureAdapter {
  start(): Promise<void>;
  stop(): Promise<CapturedAudioPayload | undefined>;
  cancel(): Promise<void>;
}

export type StopCaptureWithAudioOptions = {
  captureStartedAt?: string | undefined;
  settings: CompanionSettings;
  historyLength: number;
  captureAdapter?: MobileAudioCaptureAdapter;
  uploadAudio?: (
    audio: CapturedAudioPayload,
  ) => Promise<MobileAudioUploadResult>;
};

class DeferredMobileAudioCaptureAdapter implements MobileAudioCaptureAdapter {
  async start(): Promise<void> {
    // Native Expo/React Native recording can be wired here later without changing
    // store or local API code. Node tests inject byte payloads directly.
  }

  async stop(): Promise<CapturedAudioPayload | undefined> {
    return undefined;
  }

  async cancel(): Promise<void> {}
}

export const mobileAudioCaptureAdapter =
  new DeferredMobileAudioCaptureAdapter();

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function refineText(rawText: string, mode: SonolectMode): string {
  const cleaned = rawText.trim().replace(/\s+/g, " ");

  switch (mode) {
    case "summarize":
      return `Résumé — ${cleaned}.\n\nActions: vérifier le contexte, confirmer le destinataire, envoyer une version concise.`;
    case "reply":
      return `Bonjour, merci pour le retour. Je valide l'approche et je reviens vers vous avec une version finalisée rapidement.`;
    case "task_creation":
      return `À faire\n• Clarifier la demande\n• Préparer la réponse\n• Programmer le suivi`;
    case "translate":
      return `Translation draft — ${cleaned}`;
    case "command":
      return `Commande détectée: ${cleaned}`;
    case "code":
      return `Note technique: ${cleaned}`;
    case "meeting_notes":
      return `Notes de réunion\n• ${cleaned}\n• Décisions et prochaines étapes à confirmer.`;
    case "rewrite":
      return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} Merci de me confirmer si cela vous convient.`;
    case "dictate":
    default:
      return cleaned;
  }
}

export function shouldUploadCapturedAudio(
  settings: Pick<
    CompanionSettings,
    "cloudSyncEnabled" | "localApiUrl" | "privacyLevel" | "saveHistory"
  >,
): boolean {
  return Boolean(resolveMobileLocalApiConfig(settings).apiUrl);
}

export function buildTurnFromCapture({
  settings,
  historyLength,
  startedAtMs,
  rawText,
  refinedText,
  syncState,
}: {
  settings: CompanionSettings;
  historyLength: number;
  startedAtMs: number;
  rawText?: string;
  refinedText?: string;
  syncState?: TranscriptTurn["syncState"];
}): TranscriptTurn {
  const sample =
    rawText ??
    SAMPLE_TRANSCRIPTS[historyLength % SAMPLE_TRANSCRIPTS.length] ??
    SAMPLE_TRANSCRIPTS[0];
  const refined = refinedText ?? refineText(sample, "dictate");

  return {
    id: id("turn"),
    rawText: sample,
    refinedText: refined,
    mode: "dictate",
    language: settings.language,
    privacyMode: settings.privacyLevel !== "standard",
    createdAt: new Date().toISOString(),
    durationMs: Math.max(1200, Date.now() - startedAtMs),
    source: "microphone",
    syncState:
      syncState ??
      (settings.saveHistory && settings.privacyLevel !== "ephemeral"
        ? settings.cloudSyncEnabled
          ? "queued"
          : "local"
        : "local"),
  };
}

export async function stopCaptureWithAudio({
  captureStartedAt,
  settings,
  historyLength,
  captureAdapter = mobileAudioCaptureAdapter,
  uploadAudio,
}: StopCaptureWithAudioOptions): Promise<TranscriptTurn> {
  const startedAtMs = captureStartedAt
    ? Date.parse(captureStartedAt)
    : Date.now();
  const capturedAudio = await captureAdapter.stop().catch(() => undefined);

  if (capturedAudio && shouldUploadCapturedAudio(settings)) {
    const config = resolveMobileLocalApiConfig(settings);
    const result = await (
      uploadAudio ??
      ((audio: CapturedAudioPayload) =>
        submitCapturedMobileAudio(audio, config, {
          language: settings.language,
        }))
    )(capturedAudio);

    if (result.status === "completed" && result.turn) {
      return {
        ...result.turn,
        language: result.turn.language || settings.language,
        privacyMode: settings.privacyLevel !== "standard",
        source: "microphone",
        syncState: "synced",
        durationMs: result.turn.durationMs || capturedAudio.durationMs,
      };
    }

    if (result.status === "submitted") {
      return buildTurnFromSubmittedAudio({
        settings,
        audio: capturedAudio,
        result,
        startedAtMs,
      });
    }
  }

  return buildTurnFromCapture({ settings, historyLength, startedAtMs });
}

function buildTurnFromSubmittedAudio({
  settings,
  audio,
  result,
  startedAtMs,
}: {
  settings: CompanionSettings;
  audio: CapturedAudioPayload;
  result: MobileAudioUploadResult;
  startedAtMs: number;
}): TranscriptTurn {
  const message = result.message ?? "Capture audio envoyée à l'API locale.";
  return {
    id: result.transcriptId ?? result.jobId ?? id("turn"),
    rawText: message,
    refinedText: "Transcription locale en cours…",
    mode: "dictate",
    language: settings.language,
    privacyMode: settings.privacyLevel !== "standard",
    createdAt: new Date().toISOString(),
    durationMs: Math.max(audio.durationMs, Date.now() - startedAtMs, 1200),
    source: "microphone",
    syncState: "synced",
  };
}
