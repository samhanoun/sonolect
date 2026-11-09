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

export function exportAsMarkdown(history: readonly TranscriptTurn[]): string {
  return history
    .map(
      (turn) =>
        `## ${new Date(turn.createdAt).toISOString().slice(0, 16).replace("T", " ")} · ${turn.mode}\n\n${turn.refinedText}`,
    )
    .join("\n\n");
}
