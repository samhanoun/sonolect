import type { SonolectMode, Transcript } from "@sonolect/types";

import type { CompanionSettings, TranscriptTurn } from "./domain";

export type MobileLocalApiConfig = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  limit?: number;
};

export type MobileCapturedAudio = {
  bytes: BodyInit | Uint8Array | ArrayBuffer;
  mimeType: string;
  durationMs: number;
  sizeBytes?: number;
  fileName?: string;
};

export type MobileAudioUploadResult = {
  status: "completed" | "submitted" | "offline";
  jobId?: string;
  transcriptId?: string;
  turn?: TranscriptTurn;
  message?: string;
};

type AudioJobResponse = {
  id?: string;
  jobId?: string;
  status?: "queued" | "processing" | "completed" | "failed";
  transcriptId?: string;
  message?: string;
};

type SubmitCapturedMobileAudioOptions = {
  language?: TranscriptTurn["language"];
  source?: "mobile";
  pollAttempts?: number;
};

type TranscriptCreateBody = {
  title: string;
  rawText: string;
  finalText: string;
  language: string;
  mode: SonolectMode;
  privacyMode: boolean;
  durationMs?: number;
  tags: string[];
  status: "completed";
};

export function resolveMobileLocalApiConfig(
  settings: Pick<
    CompanionSettings,
    "cloudSyncEnabled" | "localApiUrl" | "privacyLevel" | "saveHistory"
  >,
): MobileLocalApiConfig {
  if (!settings.cloudSyncEnabled) return {};
  if (!settings.saveHistory || settings.privacyLevel === "ephemeral") return {};

  const apiUrl = settings.localApiUrl?.trim() || envLocalApiUrl();
  return apiUrl ? { apiUrl } : {};
}

export function isLocalApiConfigured(config: MobileLocalApiConfig): boolean {
  return Boolean(config.apiUrl?.trim());
}

export async function fetchLocalTranscriptHistory(
  config: MobileLocalApiConfig,
): Promise<TranscriptTurn[]> {
  const apiUrl = config.apiUrl?.trim();
  if (!apiUrl) return [];

  const endpoint = new URL("/transcripts", apiUrl);
  endpoint.searchParams.set("limit", String(config.limit ?? 25));

  const response = await (config.fetchImpl ?? fetch)(endpoint.toString(), {
    headers: createJsonHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `Mobile transcript history fetch failed (${response.status})`,
    );
  }

  const payload = (await response.json().catch(() => ({ items: [] }))) as {
    items?: Transcript[];
  };
  return (payload.items ?? []).map(transcriptToTurn);
}

export async function fetchLocalTranscriptById(
  transcriptId: string,
  config: MobileLocalApiConfig,
): Promise<TranscriptTurn | undefined> {
  const apiUrl = config.apiUrl?.trim();
  if (!apiUrl || !transcriptId.trim()) return undefined;

  const response = await (config.fetchImpl ?? fetch)(
    new URL(
      `/transcripts/${encodeURIComponent(transcriptId)}`,
      apiUrl,
    ).toString(),
    { headers: createJsonHeaders() },
  );
  if (!response.ok) {
    throw new Error(`Mobile transcript fetch failed (${response.status})`);
  }

  const transcript = (await response.json()) as Transcript;
  return transcriptToTurn(transcript);
}

export async function submitCapturedMobileAudio(
  audio: MobileCapturedAudio,
  config: MobileLocalApiConfig,
  options: SubmitCapturedMobileAudioOptions = {},
): Promise<MobileAudioUploadResult> {
  const apiUrl = config.apiUrl?.trim();
  if (!apiUrl) {
    return {
      status: "offline",
      message: "API locale Sonolect non configurée.",
    };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  try {
    const jobResponse = await fetchImpl(
      new URL("/audio/jobs", apiUrl).toString(),
      {
        method: "POST",
        headers: createJsonHeaders({ contentType: true }),
        body: JSON.stringify(
          createCapturedAudioJobPayload(audio, options.language),
        ),
      },
    );
    if (!jobResponse.ok) {
      throw new Error(`Mobile audio job failed (${jobResponse.status})`);
    }

    const jobPayload = (await jobResponse
      .json()
      .catch(() => ({}))) as AudioJobResponse;
    const jobId = jobPayload.jobId ?? jobPayload.id;
    if (!jobId) {
      return withOptionalTranscriptId(
        {
          status: "submitted",
          message:
            jobPayload.message ?? "Capture audio envoyée à l'API locale.",
        },
        jobPayload.transcriptId,
      );
    }

    const uploadResponse = await fetchImpl(
      new URL(
        `/audio/jobs/${encodeURIComponent(jobId)}/audio`,
        apiUrl,
      ).toString(),
      {
        method: "POST",
        headers: { "content-type": audio.mimeType || "audio/wav" },
        body: audio.bytes as BodyInit,
      },
    );
    if (!uploadResponse.ok) {
      throw new Error(`Mobile audio upload failed (${uploadResponse.status})`);
    }

    const uploadPayload = (await uploadResponse
      .json()
      .catch(() => ({}))) as AudioJobResponse;
    const transcriptId = uploadPayload.transcriptId ?? jobPayload.transcriptId;
    const turn = transcriptId
      ? await tryFetchCompletedTranscript(transcriptId, {
          apiUrl,
          fetchImpl,
          attempts: options.pollAttempts ?? 1,
        })
      : undefined;

    if (turn) {
      return withOptionalTranscriptId(
        { status: "completed", jobId, turn },
        transcriptId,
      );
    }

    return withOptionalTranscriptId(
      {
        status: "submitted",
        jobId,
        message:
          uploadPayload.message ?? "Capture audio envoyée à l'API locale.",
      },
      transcriptId,
    );
  } catch (error) {
    return {
      status: "offline",
      message:
        error instanceof Error
          ? `API locale indisponible: ${error.message}`
          : "API locale indisponible.",
    };
  }
}

export async function syncQueuedTranscriptTurns(
  history: TranscriptTurn[],
  config: MobileLocalApiConfig,
): Promise<TranscriptTurn[]> {
  const apiUrl = config.apiUrl?.trim();
  if (!apiUrl) return history;

  let changed = false;
  const synced: TranscriptTurn[] = [];
  for (const turn of history) {
    if (turn.syncState !== "queued") {
      synced.push(turn);
      continue;
    }

    try {
      const uploaded = await postTranscriptTurn(turn, { ...config, apiUrl });
      synced.push({
        ...turn,
        id: uploaded.id?.trim() || turn.id,
        syncState: "synced",
      });
      changed = true;
    } catch {
      synced.push(turn);
    }
  }

  return changed ? synced : history;
}

export function mergeTranscriptHistory(
  localHistory: TranscriptTurn[],
  remoteHistory: TranscriptTurn[],
): TranscriptTurn[] {
  const byId = new Map<string, TranscriptTurn>();
  for (const turn of [...remoteHistory, ...localHistory]) {
    byId.set(turn.id, turn);
  }

  return Array.from(byId.values())
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, 25);
}

function withOptionalTranscriptId<T extends MobileAudioUploadResult>(
  result: T,
  transcriptId: string | undefined,
): T {
  if (!transcriptId) return result;
  return { ...result, transcriptId };
}

async function postTranscriptTurn(
  turn: TranscriptTurn,
  config: Required<Pick<MobileLocalApiConfig, "apiUrl">> & MobileLocalApiConfig,
): Promise<{ id?: string }> {
  const response = await (config.fetchImpl ?? fetch)(
    new URL("/transcripts", config.apiUrl).toString(),
    {
      method: "POST",
      headers: createJsonHeaders({ contentType: true }),
      body: JSON.stringify(turnToCreateBody(turn)),
    },
  );
  if (!response.ok) {
    throw new Error(`Mobile transcript sync failed (${response.status})`);
  }
  return (await response.json().catch(() => ({}))) as { id?: string };
}

function transcriptToTurn(transcript: Transcript): TranscriptTurn {
  return {
    id: transcript.id,
    rawText: transcript.rawText ?? transcript.finalText ?? "",
    refinedText: transcript.finalText ?? transcript.rawText ?? "",
    mode: transcript.mode,
    language: normalizeLanguage(transcript.language),
    privacyMode: transcript.privacyMode,
    createdAt: transcript.createdAt,
    durationMs: transcript.durationMs ?? 0,
    source: "sample",
    syncState: "synced",
  };
}

function createCapturedAudioJobPayload(
  audio: MobileCapturedAudio,
  language?: TranscriptTurn["language"],
) {
  return {
    fileName:
      audio.fileName ?? `sonolect-mobile.${extensionForMime(audio.mimeType)}`,
    mimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes ?? sizeOfBody(audio.bytes),
    durationMs: Math.max(1, Math.round(audio.durationMs)),
    source: "mobile" as const,
    transcriptTitle: "Mobile voice capture",
    ...(language && language !== "auto" ? { language } : {}),
  };
}

async function tryFetchCompletedTranscript(
  transcriptId: string,
  config: MobileLocalApiConfig & { attempts?: number },
): Promise<TranscriptTurn | undefined> {
  const attempts = Math.max(1, config.attempts ?? 1);
  for (let index = 0; index < attempts; index += 1) {
    try {
      const turn = await fetchLocalTranscriptById(transcriptId, config);
      if (turn?.refinedText || turn?.rawText) return turn;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function sizeOfBody(body: MobileCapturedAudio["bytes"]): number {
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (typeof body === "string") return body.length;
  return 1;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function turnToCreateBody(turn: TranscriptTurn): TranscriptCreateBody {
  return {
    title: truncateTitle(
      turn.refinedText || turn.rawText || "Mobile transcript",
    ),
    rawText: turn.rawText,
    finalText: turn.refinedText,
    language: turn.language,
    mode: turn.mode,
    privacyMode: turn.privacyMode,
    ...(Number.isFinite(turn.durationMs)
      ? { durationMs: turn.durationMs }
      : {}),
    tags: ["mobile", turn.source],
    status: "completed",
  };
}

function createJsonHeaders(options: { contentType?: boolean } = {}) {
  return {
    accept: "application/json",
    ...(options.contentType ? { "content-type": "application/json" } : {}),
  };
}

function normalizeLanguage(language: string): TranscriptTurn["language"] {
  if (language === "fr-FR" || language === "en-US" || language === "auto") {
    return language;
  }
  if (language.startsWith("fr")) return "fr-FR";
  if (language.startsWith("en")) return "en-US";
  return "auto";
}

function truncateTitle(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ") || "Mobile transcript";
  return normalized.length > 80
    ? `${normalized.slice(0, 79).trimEnd()}…`
    : normalized;
}

function envLocalApiUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_SONOLECT_API_URL?.trim();
}
