import type { TranscriptTurn } from "./domain";

export type LibraryFilter = "all" | "pinned" | "summaries" | "tasks";

export function filterHistory(
  history: readonly TranscriptTurn[],
  query: string,
  filter: LibraryFilter,
): TranscriptTurn[] {
  const needle = query.trim().toLocaleLowerCase();
  return history.filter((turn) => {
    if (filter === "pinned" && !turn.pinned) return false;
    if (filter === "summaries" && turn.mode !== "summarize") return false;
    if (filter === "tasks" && turn.mode !== "task_creation") return false;
    if (!needle) return true;
    return (
      turn.refinedText.toLocaleLowerCase().includes(needle) ||
      turn.rawText.toLocaleLowerCase().includes(needle)
    );
  });
}

/** Pinned first, then newest first. */
export function sortHistory(
  history: readonly TranscriptTurn[],
): TranscriptTurn[] {
  return [...history].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** 'YYYY-MM-DD HH:MM' in UTC, the export's original heading format. */
function utcMinute(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toISOString().slice(0, 16).replace("T", " ");
}

export interface ExportOptions {
  /** The heading's date; defaults to UTC 'YYYY-MM-DD HH:MM'. */
  formatDate?: (iso: string) => string;
  /** The heading's mode name; defaults to the mode key. */
  modeLabel?: (mode: string) => string;
}

export function exportAsMarkdown(
  history: readonly TranscriptTurn[],
  options: ExportOptions = {},
): string {
  const formatDate = options.formatDate ?? utcMinute;
  const modeLabel = options.modeLabel ?? ((mode: string) => mode);
  return history
    .map(
      (turn) =>
        `## ${formatDate(turn.createdAt)} · ${modeLabel(turn.mode)}\n\n${turn.refinedText}`,
    )
    .join("\n\n");
}

/**
 * A note's date and time in the phone's time zone, with explicit Intl
 * options (not dateStyle and timeStyle), e.g. '8 Nov 2026, 22:30' for en-GB.
 * locale undefined: the device's own format. timeZone: for tests.
 */
export function formatNoteDate(
  iso: string,
  locale: string | undefined,
  timeZone?: string,
): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(time));
}

/**
 * The locale for dates and numbers: undefined (the device's own formats,
 * such as en-GB's 24-hour clock) when the device language is the UI
 * language, otherwise the UI language.
 */
export function formattingLocale(
  uiLanguage: string,
  deviceTag: string | null | undefined,
): string | undefined {
  const deviceLanguage = deviceTag?.toLowerCase().split(/[-_]/)[0];
  return deviceLanguage === uiLanguage.toLowerCase() ? undefined : uiLanguage;
}

/** sonolect-notes-YYYY-MM-DD.md, with the local date. */
export function exportFileName(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `sonolect-notes-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
}
