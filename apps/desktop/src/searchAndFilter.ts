import type { TranscriptHistoryRow } from "./transcriptHistory";

export type SearchResult = {
  id: string;
  title: string;
  snippet: string;
  matchCount: number;
  highlightRanges: [number, number][];
};

export type HistoryFilter = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  minDuration?: number;
  hasSpeakers?: boolean;
  exportFormat?: string;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeHighlightRanges(
  text: string,
  query: string,
): [number, number][] {
  if (!query.trim()) return [];
  const pattern = new RegExp(escapeRegex(query), "gi");
  const ranges: [number, number][] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function buildSnippet(text: string, query: string, maxLength = 120): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLength);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  const snippet = text.slice(start, end).trim();
  return (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "");
}

export function searchTranscripts(
  history: TranscriptHistoryRow[],
  query: string,
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const results: SearchResult[] = [];
  const pattern = new RegExp(escapeRegex(q), "gi");

  for (const row of history) {
    const titleMatches = (row.title.match(pattern) ?? []).length;
    const transcriptMatches = (row.transcript.match(pattern) ?? []).length;
    const matchCount = titleMatches + transcriptMatches;

    if (matchCount > 0) {
      const searchText = `${row.title} ${row.transcript}`;
      results.push({
        id: row.id,
        title: row.title,
        snippet: buildSnippet(row.transcript, q),
        matchCount,
        highlightRanges: computeHighlightRanges(searchText, q),
      });
    }
  }

  return results.sort((a, b) => b.matchCount - a.matchCount);
}

function parseDurationToMs(duration: string): number {
  const minMatch = duration.match(/(\d+)m/);
  const secMatch = duration.match(/(\d+)s/);
  const minutes = minMatch ? parseInt(minMatch[1]!, 10) : 0;
  const seconds = secMatch ? parseInt(secMatch[1]!, 10) : 0;
  return (minutes * 60 + seconds) * 1000;
}

export function filterHistory(
  history: TranscriptHistoryRow[],
  filter: HistoryFilter,
): TranscriptHistoryRow[] {
  return history.filter((row) => {
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const inTitle = row.title.toLowerCase().includes(q);
      const inTranscript = row.transcript.toLowerCase().includes(q);
      if (!inTitle && !inTranscript) return false;
    }

    if (filter.dateFrom) {
      const rowDate = new Date(row.updatedAt).getTime();
      const fromDate = new Date(filter.dateFrom).getTime();
      if (
        !Number.isNaN(rowDate) &&
        !Number.isNaN(fromDate) &&
        rowDate < fromDate
      ) {
        return false;
      }
    }

    if (filter.dateTo) {
      const rowDate = new Date(row.updatedAt).getTime();
      const toDate = new Date(filter.dateTo).getTime();
      if (!Number.isNaN(rowDate) && !Number.isNaN(toDate) && rowDate > toDate) {
        return false;
      }
    }

    if (filter.minDuration !== undefined) {
      const durationMs = parseDurationToMs(row.duration);
      if (durationMs < filter.minDuration) return false;
    }

    return true;
  });
}

export function highlightMatches(text: string, query: string): string {
  const q = query.trim();
  if (!q) return text;
  const pattern = new RegExp(`(${escapeRegex(q)})`, "gi");
  return text.replace(pattern, "**$1**");
}

export function sortResults(
  results: SearchResult[],
  by: "relevance" | "date" | "duration",
): SearchResult[] {
  const sorted = [...results];
  switch (by) {
    case "relevance":
      return sorted.sort((a, b) => b.matchCount - a.matchCount);
    case "date":
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    case "duration":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return sorted;
  }
}
