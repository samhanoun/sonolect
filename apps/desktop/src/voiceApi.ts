export type VoiceCaptureMetadata = {
  durationMs: number;
  mimeType: string;
  sizeBytes: number;
};

export type TranscriptJobResult = {
  jobId?: string;
  transcript?: string;
  status: "submitted" | "completed" | "offline";
  message?: string;
};

const API_URL = import.meta.env.VITE_SONOLECT_API_URL?.trim();

export function isVoiceApiConfigured() {
  return Boolean(API_URL);
}

export async function submitTranscriptJob(
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

  const endpoint = new URL("/transcript-jobs", API_URL).toString();
  const formData = new FormData();
  formData.append(
    "audio",
    audio,
    `sonolect-capture.${extensionForMime(metadata.mimeType)}`,
  );
  formData.append("durationMs", String(metadata.durationMs));
  formData.append("mimeType", metadata.mimeType);
  formData.append("sizeBytes", String(metadata.sizeBytes));

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Backend transcript job failed (${response.status})`);
  }

  const payload = (await response
    .json()
    .catch(() => ({}))) as Partial<TranscriptJobResult>;
  const result: TranscriptJobResult = {
    status: payload.status ?? "submitted",
    message: payload.message ?? "Capture envoyée au backend Sonolect.",
  };

  if (payload.jobId) result.jobId = payload.jobId;
  if (payload.transcript) result.transcript = payload.transcript;

  return result;
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
