import { createAuthHeaders } from "./localDevAuth";
import {
  transcribeWithDesktopWhisper,
  type DesktopWhisperResult,
} from "./desktopWhisper";
import type { TranscriptSegment } from "./segmentEditor";

export type VoiceCaptureMetadata = {
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
};

type AudioJobStatus = "queued" | "processing" | "completed" | "failed";

type AudioJobResponse = {
  id?: string;
  jobId?: string;
  status?: AudioJobStatus;
  transcriptId?: string;
  message?: string;
};

export type TranscriptJobResult = {
  jobId?: string;
  transcript?: string;
  segments?: TranscriptSegment[];
  language?: string;
  status: "submitted" | "completed" | "offline";
  message?: string;
};

type SubmitCapturedAudioOptions = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  language?: string;
  desktopTranscriber?: (
    audio: Blob,
    metadata: VoiceCaptureMetadata,
    language?: string,
  ) => Promise<DesktopWhisperResult | undefined>;
};

const API_URL = import.meta.env?.VITE_SONOLECT_API_URL?.trim();
const AUDIO_JOBS_PATH = "/audio/jobs";

export function isVoiceApiConfigured() {
  return Boolean(API_URL);
}

export function createCapturedAudioJobPayload(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
  language?: string,
) {
  const payload: Record<string, unknown> = {
    fileName: `sonolect-capture.${extensionForMime(metadata.mimeType)}`,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes || audio.size,
    durationMs: Math.max(1, Math.round(metadata.durationMs)),
    source: "desktop" as const,
    transcriptTitle: "Desktop voice capture",
  };
  if (language && language !== "auto") {
    payload.language = language;
  }
  return payload;
}

export async function submitCapturedAudio(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
  options: SubmitCapturedAudioOptions = {},
): Promise<TranscriptJobResult> {
  const desktopResult = await (
    options.desktopTranscriber ?? transcribeWithDesktopWhisper
  )(audio, metadata, options.language).catch(() => undefined);
  if (desktopResult) {
    return {
      status: "completed",
      transcript: desktopResult.text.trim(),
      segments: desktopResult.segments,
      ...(desktopResult.language ? { language: desktopResult.language } : {}),
      message: "Capture transcrite localement avec Whisper desktop.",
    };
  }

  const apiUrl = options.apiUrl ?? API_URL;
  if (!apiUrl) {
    return offlineResult(
      "VITE_SONOLECT_API_URL absent : capture conservée localement sans envoi backend.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const endpoint = new URL(AUDIO_JOBS_PATH, apiUrl).toString();
    const headers: Record<string, string> = {
      ...createAuthHeaders(),
      "content-type": "application/json",
    };

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(
        createCapturedAudioJobPayload(audio, metadata, options.language),
      ),
    });

    if (!response.ok) {
      throw new Error(`Backend audio job failed (${response.status})`);
    }

    const payload = (await response
      .json()
      .catch(() => ({}))) as AudioJobResponse;
    const jobId = payload.jobId ?? payload.id;
    if (jobId) {
      await uploadCapturedAudioBinary(
        fetchImpl,
        apiUrl,
        jobId,
        audio,
        metadata,
      );
    }

    const result: TranscriptJobResult = {
      status: payload.status === "completed" ? "completed" : "submitted",
      message: jobId
        ? "Capture envoyée au backend Sonolect avec audio local."
        : (payload.message ?? "Capture envoyée au backend Sonolect."),
    };

    const transcript = payload.transcriptId;
    if (jobId) result.jobId = jobId;
    if (transcript) result.transcript = transcript;

    return result;
  } catch (error) {
    return offlineResult(
      error instanceof Error
        ? `Backend local indisponible : capture conservée localement (${error.message}).`
        : "Backend local indisponible : capture conservée localement.",
    );
  }
}

export const submitTranscriptJob = submitCapturedAudio;

async function uploadCapturedAudioBinary(
  fetchImpl: typeof fetch,
  apiUrl: string,
  jobId: string,
  audio: Blob,
  metadata: VoiceCaptureMetadata,
) {
  const uploadEndpoint = new URL(
    `${AUDIO_JOBS_PATH}/${encodeURIComponent(jobId)}/audio`,
    apiUrl,
  ).toString();
  const uploadHeaders: Record<string, string> = {
    ...createAuthHeaders(),
    "content-type": metadata.mimeType || audio.type || "audio/webm",
  };
  const uploadResponse = await fetchImpl(uploadEndpoint, {
    method: "POST",
    headers: uploadHeaders,
    body: audio,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Backend audio upload failed (${uploadResponse.status})`);
  }
}

function offlineResult(message: string): TranscriptJobResult {
  return { status: "offline", message };
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
