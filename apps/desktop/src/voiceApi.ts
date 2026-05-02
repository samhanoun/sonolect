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
  status: "submitted" | "completed" | "offline";
  message?: string;
};

const API_URL = import.meta.env.VITE_SONOLECT_API_URL?.trim();
const API_TOKEN = import.meta.env.VITE_SONOLECT_API_TOKEN?.trim();
const AUDIO_JOBS_PATH = "/audio/jobs";

export function isVoiceApiConfigured() {
  return Boolean(API_URL);
}

export function createCapturedAudioJobPayload(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
) {
  return {
    fileName: `sonolect-capture.${extensionForMime(metadata.mimeType)}`,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes || audio.size,
    durationMs: Math.max(1, Math.round(metadata.durationMs)),
    source: "desktop" as const,
    transcriptTitle: "Desktop voice capture",
  };
}

export async function submitCapturedAudio(
  audio: Blob,
  metadata: VoiceCaptureMetadata,
): Promise<TranscriptJobResult> {
  if (!API_URL) {
    return {
      status: "offline",
      message:
        "VITE_SONOLECT_API_URL absent : capture conservée localement sans envoi backend.",
    };
  }

  const endpoint = new URL(AUDIO_JOBS_PATH, API_URL).toString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(createCapturedAudioJobPayload(audio, metadata)),
  });

  if (!response.ok) {
    throw new Error(`Backend audio job failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => ({}))) as AudioJobResponse;
  const result: TranscriptJobResult = {
    status: payload.status === "completed" ? "completed" : "submitted",
    message: payload.message ?? "Capture envoyée au backend Sonolect.",
  };

  const jobId = payload.jobId ?? payload.id;
  const transcript = payload.transcriptId;

  if (jobId) result.jobId = jobId;
  if (transcript) result.transcript = transcript;

  return result;
}

export const submitTranscriptJob = submitCapturedAudio;

function extensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
