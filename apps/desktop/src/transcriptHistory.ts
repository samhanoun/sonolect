import type {
  SonolectMode,
  Transcript,
  TranscriptStatus,
} from "@sonolect/types";
import { resolveDesktopAuthConfig } from "./localDevAuth";
import { getLocale } from "./i18n";

export type TranscriptHistoryStatus = TranscriptStatus | "synced" | "actioned";

export type TranscriptHistoryRow = {
  id: string;
  title: string;
  preview: string;
  transcript: string;
  timestamp: string;
  duration: string;
  mode: SonolectMode;
  status: TranscriptHistoryStatus;
  metadata: string;
  updatedAt: string;
};

export type TranscriptHistoryResult = {
  source: "api" | "offline";
  items: TranscriptHistoryRow[];
  nextCursor?: string;
  message?: string;
};

export type TranscriptHistoryClientOptions = {
  apiUrl?: string;
  token?: string | undefined;
  limit?: number;
  fetchImpl?: typeof fetch;
};

const fallbackTimestamp = new Date("2026-05-02T09:42:00.000Z").toISOString();

export const offlineTranscriptHistory: TranscriptHistoryRow[] = [
  {
    id: "session-1",
    title: "Préparer la démo investisseurs",
    preview:
      "Résumer la traction, clarifier le positionnement voix-first, puis créer un mail de suivi.",
    transcript:
      "Résumer la traction, clarifier le positionnement voix-first, puis créer un mail de suivi.\n\nAction proposée : Préparer la démo investisseurs.",
    timestamp: "Aujourd’hui · 09:42",
    duration: "2m 18s",
    mode: "summarize",
    status: "actioned",
    metadata: "fallback offline · summarize",
    updatedAt: fallbackTimestamp,
  },
  {
    id: "session-2",
    title: "Réponse client urgente",
    preview:
      "Transformer mes notes en réponse concise, rassurante et professionnelle.",
    transcript:
      "Transformer mes notes en réponse concise, rassurante et professionnelle.\n\nAction proposée : Réponse client urgente.",
    timestamp: "Hier · 18:07",
    duration: "48s",
    mode: "reply",
    status: "synced",
    metadata: "fallback offline · reply",
    updatedAt: fallbackTimestamp,
  },
  {
    id: "session-3",
    title: "Idées roadmap desktop",
    preview:
      "Palette de commandes, overlay micro, mode confidentiel et actions agentiques.",
    transcript:
      "Palette de commandes, overlay micro, mode confidentiel et actions agentiques.\n\nAction proposée : Idées roadmap desktop.",
    timestamp: "Lun. · 14:16",
    duration: "3m 04s",
    mode: "task_creation",
    status: "draft",
    metadata: "fallback offline · task_creation",
    updatedAt: fallbackTimestamp,
  },
];

export function isTranscriptHistoryApiConfigured(apiUrl = envApiUrl()) {
  return Boolean(apiUrl?.trim());
}

export async function fetchTranscriptHistory(
  options: TranscriptHistoryClientOptions = {},
): Promise<TranscriptHistoryResult> {
  const apiUrl = (options.apiUrl ?? envApiUrl())?.trim();
  if (!apiUrl) {
    return {
      source: "offline",
      items: offlineTranscriptHistory,
      message:
        "VITE_SONOLECT_API_URL absent : historique de démonstration conservé localement.",
    };
  }

  const endpoint = new URL("/transcripts", apiUrl);
  endpoint.searchParams.set("limit", String(options.limit ?? 20));

  const response = await (options.fetchImpl ?? fetch)(endpoint.toString(), {
    headers: createJsonHeaders(
      options.token ?? resolveDesktopAuthConfig().token,
    ),
  });

  if (!response.ok) {
    throw new Error(`Transcript history fetch failed (${response.status})`);
  }

  const payload = (await response.json().catch(() => ({ items: [] }))) as {
    items?: Transcript[];
    nextCursor?: string;
  };

  const result: TranscriptHistoryResult = {
    source: "api",
    items: (payload.items ?? []).map(normalizeTranscriptRecord),
  };
  if (payload.nextCursor) result.nextCursor = payload.nextCursor;
  return result;
}

export async function fetchTranscriptDetail(
  id: string,
  options: TranscriptHistoryClientOptions = {},
): Promise<TranscriptHistoryRow | undefined> {
  const apiUrl = (options.apiUrl ?? envApiUrl())?.trim();
  if (!apiUrl) return offlineTranscriptHistory.find((item) => item.id === id);

  const response = await (options.fetchImpl ?? fetch)(
    new URL(`/transcripts/${encodeURIComponent(id)}`, apiUrl).toString(),
    {
      headers: createJsonHeaders(
        options.token ?? resolveDesktopAuthConfig().token,
      ),
    },
  );

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Transcript detail fetch failed (${response.status})`);
  }

  return normalizeTranscriptRecord((await response.json()) as Transcript);
}

export function normalizeTranscriptRecord(
  transcript: Transcript,
): TranscriptHistoryRow {
  const body = (transcript.finalText ?? transcript.rawText ?? "").trim();
  const preview = body || "Transcription en attente de contenu.";
  const title = transcript.title?.trim() || truncateText(preview, 51);
  const metadata = [
    transcript.status,
    transcript.language,
    ...(transcript.tags ?? []),
  ].filter(Boolean);

  return {
    id: transcript.id,
    title,
    preview,
    transcript: body || preview,
    timestamp: formatTranscriptTimestamp(transcript.createdAt),
    duration: formatTranscriptDuration(transcript.durationMs),
    mode: transcript.mode,
    status: transcript.status,
    metadata: metadata.join(" · "),
    updatedAt: transcript.updatedAt,
  };
}

export function formatTranscriptDuration(durationMs?: number) {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return "Durée inconnue";
  }
  if (durationMs < 60_000) {
    return `${Math.max(0, Math.round(durationMs / 1000))}s`;
  }
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

function formatTranscriptTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  const locale = getLocale() === "fr" ? "fr-FR" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(" à ", ", ");
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function createJsonHeaders(token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
  return headers;
}

function envApiUrl() {
  return import.meta.env.VITE_SONOLECT_API_URL?.trim();
}
