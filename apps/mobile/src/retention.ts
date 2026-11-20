import type { RetentionDays, TranscriptTurn } from "./domain";
import { UNKNOWN_DATE } from "./storageCore";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  /** The notes that stay, in their original order. */
  kept: TranscriptTurn[];
  /** The notes past the limit. */
  expired: TranscriptTurn[];
}

/**
 * Splits saved notes into those that stay and those older than `days`.
 * Pinned notes always stay: pinning is how a note is kept for good. A note
 * whose date cannot be read stays too, so bad data never deletes anything:
 * that is an unparsable date, or the date storage gives such a note
 * (UNKNOWN_DATE, which would otherwise look decades old).
 * `days` 0 keeps everything. Pure, so it is tested without a device.
 */
export function applyRetention(
  history: readonly TranscriptTurn[],
  days: RetentionDays,
  now: number,
): RetentionResult {
  if (days <= 0) return { kept: [...history], expired: [] };
  const cutoff = now - days * DAY_MS;
  const unknown = Date.parse(UNKNOWN_DATE);
  const kept: TranscriptTurn[] = [];
  const expired: TranscriptTurn[] = [];
  for (const turn of history) {
    const created = Date.parse(turn.createdAt);
    const readable = Number.isFinite(created) && created !== unknown;
    if (!turn.pinned && readable && created < cutoff) {
      expired.push(turn);
    } else {
      kept.push(turn);
    }
  }
  return { kept, expired };
}
