import type { Hlc, SyncNote } from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";
import { sanitizeTurn } from "../storageCore";

/**
 * A phone note (TranscriptTurn) to and from a synced note ("note/1": the
 * field table is in packages/sync-core/README.md).
 *
 * The turn holds what the phone shows. What else a synced note carries is
 * kept in the note's companion value (storageCore SYNC_COMPANION_PREFIX), so
 * a note changed on the phone goes back with every field another device
 * wrote:
 * - `extra`: fields the phone has no place for (title, segments, origin,
 *   updatedAt and fields it does not know), written back unchanged;
 * - `kept`: fields the phone shows another way, such as a desktop "system"
 *   source shown as "remote", a text cut at 200,000 characters or an absent
 *   language shown as "auto". Each keeps the note's value and a digest of
 *   what the phone showed: while the phone still shows that, the note's
 *   value goes back; once the user changed the field here, the phone's does.
 *
 * Local only, never synced: `syncState` (the dormant API sync).
 */

/** The note/1 fields a turn shows. Everything else is `extra`. */
const SHOWN_FIELDS = [
  "createdAt",
  "rawText",
  "refinedText",
  "language",
  "mode",
  "durationMs",
  "source",
  "pinned",
  "conflictOf",
  "privacyMode",
] as const;
type ShownField = (typeof SHOWN_FIELDS)[number];
const SHOWN = new Set<string>(SHOWN_FIELDS);

/** Sources a turn can hold; another device's ("system", "file") shows as "remote". */
const TURN_SOURCES: readonly string[] = ["microphone", "typed", "remote"];

/**
 * A companion is never cut: whatever it drops, the phone's next upload of
 * the note (a pin, say) would erase on every device. It holds fields of one
 * note, whose JSON sync-core keeps under 4 MiB, and storageCore splits a
 * value over one AsyncStorage key's limit over several keys.
 */

/** A kept field: the note's value (absent when the note had none) and what the turn showed. */
interface KeptField {
  shown: string;
  value?: unknown;
}

export interface Companion {
  v: 1;
  extra: Record<string, unknown>;
  kept: Partial<Record<ShownField, KeptField>>;
}

/** The note/1 value of each shown field, from the turn alone. */
function ownFields(turn: TranscriptTurn): Record<ShownField, unknown> {
  return {
    createdAt: turn.createdAt,
    rawText: turn.rawText,
    // note/1 leaves out a refined text equal to the transcript.
    refinedText:
      turn.refinedText !== turn.rawText ? turn.refinedText : undefined,
    language: turn.language !== "auto" ? turn.language : undefined,
    mode: turn.mode,
    durationMs: turn.durationMs,
    source: turn.source,
    pinned: turn.pinned === true ? true : undefined,
    conflictOf: turn.conflictOf,
    privacyMode: turn.privacyMode,
  };
}

/** What the turn shows for a field, as compared with `kept`. */
function shownValue(turn: TranscriptTurn, field: ShownField): unknown {
  switch (field) {
    case "pinned":
      return turn.pinned === true;
    case "conflictOf":
      return turn.conflictOf ?? null;
    default:
      return turn[field];
  }
}

/** A 53-bit string hash (cyrb53). Not for security: it only tells values apart. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A short digest of a value: its JSON length and hash. */
function digest(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return `${json.length.toString(36)}.${hash53(json).toString(36)}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The turn that shows a synced note, and the companion value to store with
 * it (null when the turn says it all). `previous` is the note this replaces,
 * if any: its local-only fields stay.
 */
export function noteToTurn(
  id: string,
  note: SyncNote,
  hlc: Hlc,
  nowMs: number,
  previous?: TranscriptTurn,
): { turn: TranscriptTurn; companion: string | null } {
  const turn = sanitizeTurn(
    {
      id,
      rawText: note.rawText,
      refinedText: note.refinedText,
      mode: note.mode,
      language: note.language,
      privacyMode: note.privacyMode,
      createdAt: note.createdAt,
      durationMs: note.durationMs,
      source:
        typeof note.source === "string" && TURN_SOURCES.includes(note.source)
          ? note.source
          : "remote",
      syncState: previous?.syncState ?? "local",
      pinned: note.pinned,
      conflictOf: note.conflictOf,
      hlc,
    },
    nowMs,
  );
  // A parsed note always has an id and text; this guards the contract.
  if (!turn) throw new Error("a synced note could not be shown");

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(note))
    if (!SHOWN.has(key) && value !== undefined) extra[key] = value;
  const own = ownFields(turn);
  const kept: Companion["kept"] = {};
  for (const field of SHOWN_FIELDS) {
    const value = note[field];
    if (sameValue(own[field], value)) continue;
    const shown = digest(shownValue(turn, field));
    kept[field] = value === undefined ? { shown } : { shown, value };
  }
  const empty =
    Object.keys(kept).length === 0 &&
    Object.keys(extra).every(
      (key) => key === "origin" && extra[key] === "mobile",
    );
  const companion = empty
    ? null
    : JSON.stringify({ v: 1, extra, kept } satisfies Companion);
  return { turn, companion };
}

/** A stored companion value, or null when there is none or it is not one. */
export function parseCompanion(
  raw: string | null | undefined,
): Companion | null {
  if (raw === null || raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1) return null;
  const extra: Record<string, unknown> = {};
  if (isRecord(value.extra))
    for (const [key, field] of Object.entries(value.extra))
      if (!SHOWN.has(key)) extra[key] = field;
  const kept: Companion["kept"] = {};
  if (isRecord(value.kept))
    for (const field of SHOWN_FIELDS) {
      const entry = value.kept[field];
      if (!isRecord(entry) || typeof entry.shown !== "string") continue;
      kept[field] =
        "value" in entry
          ? { shown: entry.shown, value: entry.value }
          : { shown: entry.shown };
    }
  return { v: 1, extra, kept };
}

/**
 * The synced note for a turn and its companion. Not validated: the engine
 * checks it (parseSyncNote) and reports a note it cannot send as invalid,
 * where a throw here would stop the whole sync run.
 */
export function turnToNote(
  turn: TranscriptTurn,
  companion: Companion | null,
): SyncNote {
  const own = ownFields(turn);
  const fields: Record<string, unknown> = { ...(companion?.extra ?? {}) };
  for (const field of SHOWN_FIELDS) {
    const kept = companion?.kept[field];
    if (kept && kept.shown === digest(shownValue(turn, field))) {
      // Unchanged here: the value another device wrote.
      if ("value" in kept) fields[field] = kept.value;
      continue;
    }
    const value = own[field];
    if (value !== undefined) fields[field] = value;
  }
  if (typeof fields.origin !== "string" || !fields.origin)
    fields.origin = "mobile";
  return fields as SyncNote;
}
