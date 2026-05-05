import type { SonolectMode, Transcript } from "@sonolect/types";

import type { CompanionSettings, TranscriptTurn } from "./domain";

export type MobileLocalApiConfig = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  limit?: number;
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
