import type { SonolectMode, Transcript } from "@sonolect/types";

import type { CompanionSettings, TranscriptTurn } from "./domain";

export type MobileLocalApiConfig = {
  apiUrl?: string;
  apiToken?: string;
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
  language?: string;
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
  > & { apiToken?: string | undefined },
): MobileLocalApiConfig {
  if (!settings.cloudSyncEnabled) return {};
  if (!settings.saveHistory || settings.privacyLevel === "ephemeral") return {};

  const apiUrl = settings.localApiUrl?.trim() || envLocalApiUrl();
  if (!apiUrl || !isAllowedApiUrl(apiUrl)) return {};
  const apiToken = settings.apiToken?.trim();
  return apiToken ? { apiUrl, apiToken } : { apiUrl };
}

/**
 * Only https endpoints, or plain http on loopback / private LAN addresses
 * (a desktop running the local API), may receive transcripts and audio.
 */
export function isAllowedApiUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith(".local")
  );
}

export type PolishResult =
  | { status: "completed"; text: string; model?: string }
  | { status: "unavailable"; message: string };

/** Asks the Sonolect API (Vertex Gemini) to refine text. Never throws. */
export async function refineWithApi(
  transcript: string,
  stylePreset: string,
  config: MobileLocalApiConfig,
  options: {
    locale?: string;
    dictionary?: { spoken: string; written: string }[];
  } = {},
): Promise<PolishResult> {
  const apiUrl = config.apiUrl?.trim();
  if (!apiUrl) {
    return {
      status: "unavailable",
      message: "Sonolect API is not configured.",
    };
  }
  try {
    const response = await (config.fetchImpl ?? fetch)(
      new URL("/v1/polish", apiUrl).toString(),
      {
        method: "POST",
        headers: createJsonHeaders({
          contentType: true,
          token: config.apiToken,
        }),
        body: JSON.stringify({
          transcript,
          stylePreset,
          ...(options.locale ? { locale: options.locale } : {}),
          ...(options.dictionary?.length
            ? { dictionary: options.dictionary }
            : {}),
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      polished?: unknown;
      model?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok || typeof payload.polished !== "string") {
      const message =
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `Sonolect API returned ${response.status}.`;
      return { status: "unavailable", message };
    }
    return {
      status: "completed",
      text: payload.polished,
      ...(typeof payload.model === "string" ? { model: payload.model } : {}),
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof Error
          ? `Sonolect API unreachable: ${error.message}`
          : "Sonolect API unreachable.",
    };
  }
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
    headers: createJsonHeaders({ token: config.apiToken }),
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
    { headers: createJsonHeaders({ token: config.apiToken }) },
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
      message: "Sonolect API is not configured.",
    };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  try {
    const jobResponse = await fetchImpl(
      new URL("/audio/jobs", apiUrl).toString(),
      {
        method: "POST",
        headers: createJsonHeaders({
          contentType: true,
          token: config.apiToken,
        }),
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
          message: jobPayload.message ?? "Audio sent to the Sonolect API.",
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
        headers: {
          "content-type": audio.mimeType || "audio/wav",
          ...(config.apiToken
            ? { authorization: `Bearer ${config.apiToken}` }
            : {}),
        },
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
          ...(config.apiToken ? { apiToken: config.apiToken } : {}),
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
        message: uploadPayload.message ?? "Audio sent to the Sonolect API.",
      },
      transcriptId,
    );
  } catch (error) {
    return {
      status: "offline",
      message:
        error instanceof Error
          ? `Sonolect API unreachable: ${error.message}`
          : "Sonolect API unreachable.",
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
      headers: createJsonHeaders({ contentType: true, token: config.apiToken }),
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
    source: "remote",
    syncState: "synced",
  };
}

function createCapturedAudioJobPayload(
  audio: MobileCapturedAudio,
  language?: string,
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

function createJsonHeaders(
  options: { contentType?: boolean; token?: string | undefined } = {},
): Record<string, string> {
  return {
    accept: "application/json",
    ...(options.contentType ? { "content-type": "application/json" } : {}),
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };
}

function normalizeLanguage(language: string | undefined): string {
  const trimmed = language?.trim();
  return trimmed ? trimmed : "auto";
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
