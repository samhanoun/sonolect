import { isHlc, toHlc } from "@sonolect/sync-core";
import type { SonolectMode } from "@sonolect/types";

import type { DictionaryEntry, Snippet, TranscriptTurn } from "./domain";
import { sanitizeSegments } from "./noteSegments";

/**
 * Notes on the phone, one key per note plus an index of ids (data-1,
 * data-2). Pure: the key-value store is passed in, so tests can inject
 * faults, and storage.ts passes AsyncStorage. The rules:
 * - a read error never deletes anything;
 * - a note whose JSON is broken is copied to `<key>.corrupt`, then removed;
 * - a save writes the changed notes, then removes the deleted ones, then
 *   writes the index, so a crash never brings a deleted note back;
 * - after a load that failed, a save adds, updates and removes the notes
 *   this session showed, but never writes the index; the ids it removes
 *   are recorded first, so the v2 history can't bring them back;
 * - the v2 history value is removed only after the new index was written
 *   and read back;
 * - a note's companion value (sync's sidecar, `<companion prefix><id>`) is
 *   written with the note and removed with it. One over COMPANION_PART_BYTES
 *   is split over `<companion prefix><id>~1`, `~2`… (Android cannot read an
 *   AsyncStorage value over about 2 MB back), its own key naming the parts.
 */

/** AsyncStorage's own signatures satisfy this. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(
    keys: readonly string[],
  ): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

/** Every key Sonolect stores in AsyncStorage starts with this: Erase all removes them all. */
export const APP_KEY_PREFIX = "sonolect.mobile.";
export const NOTE_PREFIX = "sonolect.mobile.note.";
/** `{"v":3,"ids":[...]}`, newest first. */
export const INDEX_KEY = "sonolect.mobile.notes.index.v3";
/** The whole history as one JSON array, before v3. */
export const LEGACY_V2_KEY = "sonolect.mobile.history.v2";
/**
 * `{"v":3,"ids":[...]}`: the notes deleted after a load that failed. The v2
 * history may still hold them, so the migration skips them.
 */
export const DELETED_KEY = "sonolect.mobile.notes.deleted.v3";
/** v0.1's history key. */
export const LEGACY_V1_KEY = "sonolect.mobile.history";
/**
 * What sync keeps of a note beyond the note itself (src/sync/noteMapping.ts),
 * one key per note: `<prefix><id>`. Outside NOTE_PREFIX, so a load never
 * reads it as a note.
 */
export const SYNC_COMPANION_PREFIX = "sonolect.mobile.sync.note.";
/** sync-core's key-value state store: the vault's cursor, records and clock. */
export const SYNC_STATE_PREFIX = "sonolect.mobile.sync.state.";
/** A value that could not be parsed is kept under its key plus this. */
export const CORRUPT_SUFFIX = ".corrupt";
const INDEX_VERSION = 3;

export const MAX_ID_LENGTH = 128;
export const MAX_TEXT_LENGTH = 200_000;
export const MAX_LANGUAGE_LENGTH = 35;
/** A note dated later than this after now gets now as its date. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** The date of a note whose date can't be read: it sorts last. */
export const UNKNOWN_DATE = "1970-01-01T00:00:00.000Z";

const KNOWN_MODES: Record<SonolectMode, true> = {
  dictate: true,
  rewrite: true,
  translate: true,
  summarize: true,
  reply: true,
  command: true,
  code: true,
  meeting_notes: true,
  task_creation: true,
};
const SOURCES: readonly TranscriptTurn["source"][] = [
  "microphone",
  "typed",
  "remote",
];
const SYNC_STATES: readonly TranscriptTurn["syncState"][] = [
  "local",
  "queued",
  "synced",
];

function isKnownMode(value: unknown): value is SonolectMode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(KNOWN_MODES, value)
  );
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

function isNoteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_ID_LENGTH
  );
}

/** The text, capped; undefined when absent; null when it is not text. */
function readText(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  return value.length > MAX_TEXT_LENGTH
    ? value.slice(0, MAX_TEXT_LENGTH)
    : value;
}

function readCreatedAt(value: unknown, nowMs: number): string {
  if (typeof value !== "string") return UNKNOWN_DATE;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return UNKNOWN_DATE;
  if (ms > nowMs + FUTURE_TOLERANCE_MS) return new Date(nowMs).toISOString();
  return value;
}

/**
 * A note read from storage (or from the API) in the shape the app renders,
 * or null when it can't be one. Unknown fields are dropped (security-6).
 */
export function sanitizeTurn(
  value: unknown,
  nowMs: number,
): TranscriptTurn | null {
  if (typeof value !== "object" || value === null) return null;
  const note = value as Record<string, unknown>;
  if (!isNoteId(note.id)) return null;
  const raw = readText(note.rawText);
  const refined = readText(note.refinedText);
  if (raw === null || refined === null) return null;
  const rawText = raw ?? refined;
  const refinedText = refined ?? raw;
  if (rawText === undefined || refinedText === undefined) return null;
  const { language, durationMs } = note;
  const segments = sanitizeSegments(note.segments, MAX_TEXT_LENGTH);
  return {
    id: note.id,
    rawText,
    refinedText,
    mode: isKnownMode(note.mode) ? note.mode : "dictate",
    language:
      typeof language === "string" &&
      language.length >= 1 &&
      language.length <= MAX_LANGUAGE_LENGTH
        ? language
        : "auto",
    privacyMode:
      typeof note.privacyMode === "boolean" ? note.privacyMode : false,
    createdAt: readCreatedAt(note.createdAt, nowMs),
    durationMs:
      typeof durationMs === "number" &&
      Number.isFinite(durationMs) &&
      durationMs >= 0
        ? durationMs
        : 0,
    source: oneOf(note.source, SOURCES, "microphone"),
    syncState: oneOf(note.syncState, SYNC_STATES, "local"),
    ...(note.pinned === true ? { pinned: true } : {}),
    ...(isHlc(note.hlc) ? { hlc: toHlc(note.hlc) } : {}),
    ...(isNoteId(note.conflictOf) ? { conflictOf: note.conflictOf } : {}),
    ...(segments ? { segments } : {}),
  };
}

/**
 * The sample sentences v0.1 saved as microphone captures when a capture
 * failed (commit 775a450, apps/mobile/src/domain.ts:112-116). They are not
 * the user's words, so the migration drops them (data-13).
 */
export const V01_SAMPLE_TRANSCRIPTS = [
  "Rappelle-moi de préparer la synthèse client avant seize heures et d'envoyer la version courte à l'équipe.",
  "Réponds à Camille que je valide la proposition mais que je veux garder une marge sur le planning.",
  "Note réunion produit: simplifier l'onboarding mobile, garder le mode privé visible, puis tester la capture vocale.",
] as const;

export function isV01Sample(turn: Pick<TranscriptTurn, "rawText">): boolean {
  return (V01_SAMPLE_TRANSCRIPTS as readonly string[]).includes(
    turn.rawText.trim(),
  );
}

export function noteKey(id: string): string {
  return `${NOTE_PREFIX}${id}`;
}

/**
 * The largest companion value in one AsyncStorage key, in UTF-8 bytes: a
 * value over about 2 MB cannot be read back on Android.
 */
export const COMPANION_PART_BYTES = 1_500_000;
/**
 * The most parts of one companion value. A companion holds fields of one
 * synced note, whose JSON is at most 4 MiB (sync-core's
 * maxPlaintextBytes): 3 parts at most, and one more to spare.
 */
export const MAX_COMPANION_PARTS = 4;
/** A companion's own key, when the value is split: `parts:<n>`. */
const PARTS_HEADER = "parts:";

const companionPartKey = (key: string, part: number) => `${key}~${part}`;

/** The UTF-8 length of one UTF-16 code unit (a surrogate half counts 2). */
const utf8Units = (code: number) =>
  code < 0x80 ? 1 : code < 0x800 || (code & 0xf800) === 0xd800 ? 2 : 3;

/** The UTF-8 length of a string, without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1)
    bytes += utf8Units(text.charCodeAt(i));
  return bytes;
}

/** Splits text into pieces of at most `maxBytes` UTF-8 bytes, never inside a surrogate pair. */
export function splitUtf8(text: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    const pair =
      code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    const size = pair ? 4 : utf8Units(code);
    if (bytes + size > maxBytes && i > start) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
    i += pair ? 2 : 1;
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * The key-value pairs that store a companion value under `key`, and the
 * part keys to remove: those a shorter value no longer uses. Null when the
 * value is over MAX_COMPANION_PARTS parts.
 */
export function companionPairs(
  key: string,
  value: string,
): { pairs: [string, string][]; stale: string[] } | null {
  const parts = splitUtf8(value, COMPANION_PART_BYTES);
  if (parts.length === 1) return { pairs: [[key, value]], stale: [] };
  if (parts.length > MAX_COMPANION_PARTS) return null;
  const pairs: [string, string][] = [[key, `${PARTS_HEADER}${parts.length}`]];
  parts.forEach((part, index) =>
    pairs.push([companionPartKey(key, index + 1), part]),
  );
  const stale: string[] = [];
  for (let part = parts.length + 1; part <= MAX_COMPANION_PARTS; part += 1)
    stale.push(companionPartKey(key, part));
  return { pairs, stale };
}

/** A companion's key and every key of its parts. */
export function companionKeys(key: string): string[] {
  const keys = [key];
  for (let part = 1; part <= MAX_COMPANION_PARTS; part += 1)
    keys.push(companionPartKey(key, part));
  return keys;
}

/** Reads a companion value stored by companionPairs; null when absent or a part is missing. */
export async function readCompanionValue(
  kv: Pick<KeyValueStore, "getItem" | "multiGet">,
  key: string,
): Promise<string | null> {
  const head = await kv.getItem(key);
  if (head === null || head === undefined || !head.startsWith(PARTS_HEADER))
    return head ?? null;
  const count = Number(head.slice(PARTS_HEADER.length));
  if (!Number.isInteger(count) || count < 1 || count > MAX_COMPANION_PARTS)
    return null;
  const keys = Array.from({ length: count }, (_, index) =>
    companionPartKey(key, index + 1),
  );
  const parts = await kv.multiGet(keys);
  let value = "";
  for (const [, part] of parts) {
    if (part === null || part === undefined) return null;
    value += part;
  }
  return value;
}

function isNoteKey(key: string): boolean {
  return key.startsWith(NOTE_PREFIX) && !key.endsWith(CORRUPT_SUFFIX);
}

/** JSON.parse that returns undefined (never a JSON value) on a failure. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function serializeIndex(ids: readonly string[]): string {
  return JSON.stringify({ v: INDEX_VERSION, ids });
}

/** The ids of an index value, or null when it is not a v3 index. */
export function parseIndex(raw: string): string[] | null {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null) return null;
  const { v, ids } = value as { v?: unknown; ids?: unknown };
  if (v !== INDEX_VERSION || !Array.isArray(ids)) return null;
  const unique = new Set<string>();
  for (const id of ids as unknown[]) if (isNoteId(id)) unique.add(id);
  return [...unique];
}

/** The ids of a DELETED_KEY value; none when absent or unparseable. */
function parseDeleted(raw: string | null | undefined): string[] {
  return raw === null || raw === undefined ? [] : (parseIndex(raw) ?? []);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** A note as stored. */
interface StoredNote {
  turn: TranscriptTurn;
  /** The JSON the key-value store holds for it. */
  json: string;
  /**
   * False when the stored JSON must be written again at the next save: its
   * date was in the future, and the clamped date would change every launch.
   */
  current: boolean;
}

interface NotesRead {
  notes: Map<string, StoredNote>;
  /** Keys whose value is not a valid note, with that value. */
  broken: [string, string][];
}

function dateOf(note: StoredNote): number {
  return Date.parse(note.turn.createdAt);
}

function newestFirst(left: StoredNote, right: StoredNote): number {
  return dateOf(right) - dateOf(left);
}

/**
 * Inserts `others` (newest first) into `ordered` by date, keeping the order
 * of `ordered`.
 */
function mergeByDate(
  ordered: readonly StoredNote[],
  others: readonly StoredNote[],
): StoredNote[] {
  const merged: StoredNote[] = [];
  let next = 0;
  for (const note of ordered) {
    while (next < others.length && dateOf(others[next]!) > dateOf(note)) {
      merged.push(others[next]!);
      next += 1;
    }
    merged.push(note);
  }
  return merged.concat(others.slice(next));
}

function sameIds(left: readonly string[] | null, right: readonly string[]) {
  return (
    left !== null &&
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export interface NotesLoad {
  /**
   * False: some saved notes could not be read. Nothing was deleted, and
   * `notes` holds what could be read without changing anything. Until the
   * next load succeeds, saves add, update and remove these notes and the
   * new ones, but never write the index.
   */
  ok: boolean;
  /** Newest first. */
  notes: TranscriptTurn[];
}

/** One note for NoteStore.apply. */
export interface NoteWrite {
  note: TranscriptTurn;
  /** Its companion value, or null to remove it; undefined leaves it as is. */
  companion?: string | null;
}

export interface NoteStore {
  /** Reads the notes, moving the v2 history to one key per note once. */
  load(): Promise<NotesLoad>;
  /** Stores this list (newest first) as the notes. */
  save(notes: readonly TranscriptTurn[]): Promise<void>;
  /**
   * Stores single notes at once, for sync: `put` writes each note and its
   * companion value in one write, `remove` deletes notes and their
   * companions. It leaves the index alone, so a change costs one write
   * whatever the number of notes: a load lists a stored note the index
   * misses and drops an indexed one that is gone, and the next save writes
   * the index. Rejects, writing nothing, while degraded.
   */
  apply(change: {
    put?: readonly NoteWrite[];
    remove?: readonly string[];
  }): Promise<void>;
  /** Removes every note, the index and the older history values. */
  clear(): Promise<void>;
  /** True until a load succeeds, and after a load that failed. */
  isDegraded(): boolean;
}

export function createNoteStore(
  kv: KeyValueStore,
  {
    now = Date.now,
    batchSize = 50,
    companionPrefix,
  }: {
    now?: () => number;
    batchSize?: number;
    /** Where companion values live (SYNC_COMPANION_PREFIX); none without. */
    companionPrefix?: string;
  } = {},
): NoteStore {
  const size = Math.max(1, Math.floor(batchSize));
  /** A note's key and, with companions, its companion's keys. */
  const keysOf = (id: string): string[] =>
    companionPrefix === undefined
      ? [noteKey(id)]
      : [noteKey(id), ...companionKeys(`${companionPrefix}${id}`)];
  // Until a load succeeds, the stored notes are unknown: saves then remove
  // only the notes this session read or wrote, and never write the index.
  let degraded = true;
  /**
   * What the store holds for each note this session knows: its JSON, and
   * the note object that JSON was written or read from, so a save skips
   * unchanged notes without serializing them.
   */
  let known = new Map<string, { json: string; note: TranscriptTurn | null }>();
  let queue: Promise<void> = Promise.resolve();

  /** Runs loads, saves and clears one at a time, in call order. */
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.catch(() => undefined).then(run);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const remember = (notes: readonly StoredNote[]) => {
    known = new Map(
      notes.map((stored) => [
        stored.turn.id,
        { json: stored.json, note: stored.current ? stored.turn : null },
      ]),
    );
  };

  /** Every key; null on a listing error. */
  const listKeys = async (): Promise<readonly string[] | null> => {
    try {
      return await kv.getAllKeys();
    } catch {
      return null;
    }
  };

  const noteIdsIn = (keys: readonly string[]): string[] =>
    keys.filter(isNoteKey).map((key) => key.slice(NOTE_PREFIX.length));

  /** The deleted ids recorded while degraded are no longer needed. */
  const forgetDeleted = async (keys: readonly string[] | null) => {
    if (!keys?.includes(DELETED_KEY)) return;
    try {
      await kv.removeItem(DELETED_KEY);
    } catch {
      // Removed by a later load.
    }
  };

  /** Reads notes in batches; null on a read error. */
  const readNotes = async (
    ids: readonly string[],
    nowMs: number,
  ): Promise<NotesRead | null> => {
    const notes = new Map<string, StoredNote>();
    const broken: [string, string][] = [];
    // One batch at a time: AsyncStorage merges the multiGet calls of one
    // tick into one native read, and one failure would fail them all.
    for (const batch of chunk(ids, size)) {
      let pairs: readonly (readonly [string, string | null])[];
      try {
        pairs = await kv.multiGet(batch.map(noteKey));
      } catch {
        return null;
      }
      for (const [key, raw] of pairs) {
        // Absent: deleted after the index was written. AsyncStorage gives
        // undefined rather than null for some missing keys.
        if (raw === null || raw === undefined) continue;
        const id = key.slice(NOTE_PREFIX.length);
        const value = parseJson(raw);
        const turn = sanitizeTurn(value, nowMs);
        if (!turn || turn.id !== id) {
          broken.push([key, raw]);
          continue;
        }
        const storedDate = (value as { createdAt?: unknown }).createdAt;
        notes.set(id, {
          turn,
          json: raw,
          current: storedDate === turn.createdAt,
        });
      }
    }
    return { notes, broken };
  };

  /** Copies each broken value to `<key>.corrupt`, then removes the key. */
  const setAside = async (broken: readonly [string, string][]) => {
    for (const [key, raw] of broken) {
      try {
        await kv.setItem(`${key}${CORRUPT_SUFFIX}`, raw);
        await kv.removeItem(key);
      } catch {
        // Kept as is: the next load tries again.
      }
    }
  };

  /**
   * A read failed. Nothing is deleted, and the notes that can be read
   * without the index are shown, without changing anything: notes saved
   * while degraded then stay visible even when the old history can never
   * be read (an Android value over the ~2 MB row limit).
   */
  const failed = async (nowMs: number): Promise<NotesLoad> => {
    degraded = true;
    const keys = await listKeys();
    const read = keys ? await readNotes(noteIdsIn(keys), nowMs) : null;
    const notes = read ? [...read.notes.values()].sort(newestFirst) : [];
    remember(notes);
    return { ok: false, notes: notes.map((stored) => stored.turn) };
  };

  const loaded = (notes: readonly StoredNote[]): NotesLoad => {
    remember(notes);
    degraded = false;
    return { ok: true, notes: notes.map((stored) => stored.turn) };
  };

  const loadIndexed = async (
    indexRaw: string,
    nowMs: number,
  ): Promise<NotesLoad> => {
    let ids = parseIndex(indexRaw);
    let rewrite = false;
    if (!ids) {
      // Keep a copy, then rebuild the index from the note keys.
      try {
        await kv.setItem(`${INDEX_KEY}${CORRUPT_SUFFIX}`, indexRaw);
      } catch {
        return failed(nowMs);
      }
      ids = [];
      rewrite = true;
    }
    const read = await readNotes(ids, nowMs);
    if (!read) return failed(nowMs);
    await setAside(read.broken);
    const indexed = ids.flatMap((id) => {
      const stored = read.notes.get(id);
      return stored ? [stored] : [];
    });

    // Orphans: notes written without an index update (a degraded session,
    // or a crash before the index write). A listing error only postpones
    // them to the next load.
    const listed = new Set(ids);
    const keys = await listKeys();
    const orphanIds = noteIdsIn(keys ?? []).filter((id) => !listed.has(id));
    let orphans: StoredNote[] = [];
    if (orphanIds.length > 0) {
      const orphanRead = await readNotes(orphanIds, nowMs);
      if (orphanRead) {
        await setAside(orphanRead.broken);
        orphans = [...orphanRead.notes.values()].sort(newestFirst);
      }
    }
    const notes = orphans.length > 0 ? mergeByDate(indexed, orphans) : indexed;
    // A listed note that is gone (deleted while degraded, or set aside as
    // broken) leaves the index.
    if (orphans.length > 0 || rewrite || indexed.length !== ids.length) {
      try {
        await kv.setItem(
          INDEX_KEY,
          serializeIndex(notes.map((stored) => stored.turn.id)),
        );
      } catch {
        // Every save writes the index again.
      }
    }
    // With an index, the v2 history is never read again.
    await forgetDeleted(keys);
    return loaded(notes);
  };

  /** No v3 index yet: move the v2 history to one key per note. */
  const migrate = async (nowMs: number): Promise<NotesLoad> => {
    let v2Raw: string | null;
    try {
      v2Raw = await kv.getItem(LEGACY_V2_KEY);
    } catch {
      // Kept: an Android value over the row limit can't be read at all.
      return failed(nowMs);
    }
    let fromV2: TranscriptTurn[] = [];
    if (v2Raw !== null) {
      const value = parseJson(v2Raw);
      if (Array.isArray(value)) {
        // Notes deleted while the migration could not finish stay deleted.
        let deleted: Set<string>;
        try {
          deleted = new Set(parseDeleted(await kv.getItem(DELETED_KEY)));
        } catch {
          return failed(nowMs);
        }
        const seen = new Set<string>();
        for (const item of value as unknown[]) {
          const turn = sanitizeTurn(item, nowMs);
          if (!turn || seen.has(turn.id) || isV01Sample(turn)) continue;
          seen.add(turn.id);
          if (!deleted.has(turn.id)) fromV2.push(turn);
        }
      } else {
        // Not a history: keep a copy, then remove it.
        try {
          await kv.setItem(`${LEGACY_V2_KEY}${CORRUPT_SUFFIX}`, v2Raw);
        } catch {
          return failed(nowMs);
        }
        try {
          await kv.removeItem(LEGACY_V2_KEY);
        } catch {
          // The index written below makes it unused.
        }
        v2Raw = null;
      }
    }

    // Note keys that exist already were written by this version (a session
    // that couldn't finish the migration, or a crash before the first index
    // write). They are at least as new as their v2 copies, so they win.
    const keys = await listKeys();
    if (!keys) return failed(nowMs);
    const read = await readNotes(noteIdsIn(keys), nowMs);
    if (!read) return failed(nowMs);
    await setAside(read.broken);
    const stored = read.notes;

    const toWrite = fromV2.filter((turn) => !stored.has(turn.id));
    try {
      for (const batch of chunk(toWrite, size)) {
        await kv.multiSet(
          batch.map((turn) => [noteKey(turn.id), JSON.stringify(turn)]),
        );
      }
    } catch {
      return failed(nowMs);
    }

    const v2Ids = new Set(fromV2.map((turn) => turn.id));
    const migrated = fromV2.map(
      (turn): StoredNote =>
        stored.get(turn.id) ?? {
          turn,
          json: JSON.stringify(turn),
          current: true,
        },
    );
    const others = [...stored.values()]
      .filter((note) => !v2Ids.has(note.turn.id))
      .sort(newestFirst);
    const notes = mergeByDate(migrated, others);
    // A fresh install: nothing to write.
    if (v2Raw === null && notes.length === 0) {
      await forgetDeleted(keys);
      return loaded(notes);
    }

    const ids = notes.map((note) => note.turn.id);
    try {
      await kv.setItem(INDEX_KEY, serializeIndex(ids));
    } catch {
      return failed(nowMs);
    }
    let readBack: string | null = null;
    try {
      readBack = await kv.getItem(INDEX_KEY);
    } catch {
      readBack = null;
    }
    if (readBack === null || !sameIds(parseIndex(readBack), ids)) {
      // Not trusted: without an index the next launch migrates again.
      try {
        await kv.removeItem(INDEX_KEY);
      } catch {
        // Orphan recovery then completes what this index misses.
      }
      return failed(nowMs);
    }
    if (v2Raw !== null) {
      try {
        await kv.removeItem(LEGACY_V2_KEY);
      } catch {
        // Unused from now on: loads read the index.
      }
    }
    await forgetDeleted(keys);
    return loaded(notes);
  };

  const load = async (): Promise<NotesLoad> => {
    const nowMs = now();
    let indexRaw: string | null;
    try {
      indexRaw = await kv.getItem(INDEX_KEY);
    } catch {
      return failed(nowMs);
    }
    return indexRaw === null ? migrate(nowMs) : loadIndexed(indexRaw, nowMs);
  };

  const save = async (notes: readonly TranscriptTurn[]) => {
    const nowMs = now();
    const next = new Map<string, { json: string; note: TranscriptTurn }>();
    const changed: [string, string][] = [];
    for (const note of notes) {
      if (next.has(note.id)) continue;
      const before = known.get(note.id);
      if (before?.note === note) {
        next.set(note.id, { json: before.json, note });
        continue;
      }
      // A note a load would reject is never stored.
      const clean = sanitizeTurn(note, nowMs);
      if (!clean) continue;
      const json = JSON.stringify(clean);
      next.set(note.id, { json, note });
      if (before?.json !== json) changed.push([noteKey(note.id), json]);
    }

    for (const batch of chunk(changed, size)) await kv.multiSet(batch);
    // Only notes this session read or wrote, which are the ones it showed:
    // a note it could not read is never removed.
    const removed = [...known.keys()].filter((id) => !next.has(id));
    if (degraded && removed.length > 0) {
      // Recorded first: the v2 history may still hold them. A read error
      // rejects the save, and nothing is removed.
      const deleted = parseDeleted(await kv.getItem(DELETED_KEY));
      await kv.setItem(
        DELETED_KEY,
        serializeIndex([...new Set([...deleted, ...removed])]),
      );
    }
    for (const batch of chunk(removed.flatMap(keysOf), size)) {
      await kv.multiRemove(batch);
    }
    if (!degraded) {
      await kv.setItem(INDEX_KEY, serializeIndex([...next.keys()]));
    }
    // A failure above keeps the previous baseline, so the next save writes
    // everything this one could not.
    known = next;
  };

  const apply = async ({
    put = [],
    remove = [],
  }: {
    put?: readonly NoteWrite[];
    remove?: readonly string[];
  }) => {
    if (degraded) throw new Error("the notes are not loaded");
    const nowMs = now();
    const pairs: [string, string][] = [];
    const removedKeys: string[] = [];
    const written = new Map<string, { json: string; note: TranscriptTurn }>();
    for (const { note, companion } of put) {
      // A note a load would reject is never stored.
      const clean = sanitizeTurn(note, nowMs);
      if (!clean) continue;
      const json = JSON.stringify(clean);
      written.set(note.id, { json, note });
      pairs.push([noteKey(note.id), json]);
      if (companionPrefix !== undefined && companion !== undefined) {
        const key = `${companionPrefix}${note.id}`;
        const stored =
          companion === null ? null : companionPairs(key, companion);
        // Over every part a note can need: noteMapping never makes one.
        if (companion !== null && !stored)
          throw new Error("a sync companion value is too large");
        if (stored) {
          pairs.push(...stored.pairs);
          removedKeys.push(...stored.stale);
        } else removedKeys.push(...companionKeys(key));
      }
    }
    const removed = remove.filter((id) => !written.has(id));
    removedKeys.push(...removed.flatMap(keysOf));
    // One write for the notes and their companions.
    if (pairs.length > 0) await kv.multiSet(pairs);
    for (const batch of chunk(removedKeys, size)) await kv.multiRemove(batch);
    for (const [id, entry] of written) known.set(id, entry);
    for (const id of removed) known.delete(id);
  };

  const clear = async () => {
    const keys = new Set<string>([
      INDEX_KEY,
      `${INDEX_KEY}${CORRUPT_SUFFIX}`,
      DELETED_KEY,
      LEGACY_V2_KEY,
      `${LEGACY_V2_KEY}${CORRUPT_SUFFIX}`,
      LEGACY_V1_KEY,
      ...[...known.keys()].map(noteKey),
    ]);
    // Every note key, with the copies of broken notes, and the companions.
    for (const key of await kv.getAllKeys()) {
      if (
        key.startsWith(NOTE_PREFIX) ||
        (companionPrefix !== undefined && key.startsWith(companionPrefix))
      ) {
        keys.add(key);
      }
    }
    for (const batch of chunk([...keys], size)) await kv.multiRemove(batch);
    known = new Map();
    degraded = false;
  };

  return {
    load: () => serialized(load),
    save: (notes) => serialized(() => save(notes)),
    apply: (change) => serialized(() => apply(change)),
    clear: () => serialized(clear),
    isDegraded: () => degraded,
  };
}

/** A value read from one key: settings, the dictionary or the snippets. */
export type JsonRead = { ok: true; value: unknown } | { ok: false };

const UNREADABLE_ERROR = "UnreadableValueError";

/** The error of a write to a key whose value could not be read. */
export function isUnreadableValueError(error: unknown): boolean {
  return error instanceof Error && error.name === UNREADABLE_ERROR;
}

export interface JsonStore {
  /**
   * Reads and parses one key. ok false: the read failed, the value is kept
   * and this store never overwrites it (data-1). JSON that doesn't parse is
   * copied to `<key>.corrupt`, then removed, and reads as absent (value
   * undefined).
   */
  read(key: string): Promise<JsonRead>;
  /** Rejects, writing nothing, for a key whose read failed. */
  write(key: string, value: unknown): Promise<void>;
  /** Every key was erased: all of them may be written again. */
  reset(): void;
}

export function createJsonStore(
  kv: Pick<KeyValueStore, "getItem" | "setItem" | "removeItem">,
): JsonStore {
  // A write would replace what could not be read, such as the dictionary
  // with the one entry added since: these keys wait for the next launch.
  const unreadable = new Set<string>();
  return {
    async read(key) {
      let raw: string | null;
      try {
        raw = await kv.getItem(key);
      } catch {
        unreadable.add(key);
        return { ok: false };
      }
      unreadable.delete(key);
      if (raw === null || raw === undefined) {
        return { ok: true, value: undefined };
      }
      const value = parseJson(raw);
      if (value === undefined) {
        try {
          await kv.setItem(`${key}${CORRUPT_SUFFIX}`, raw);
          await kv.removeItem(key);
        } catch {
          // Kept as is: the next write replaces it.
        }
      }
      return { ok: true, value };
    },
    async write(key, value) {
      if (unreadable.has(key)) {
        const error = new Error(`${key} could not be read at launch`);
        error.name = UNREADABLE_ERROR;
        throw error;
      }
      await kv.setItem(key, JSON.stringify(value));
    },
    reset() {
      unreadable.clear();
    },
  };
}

/** The value when it is a plain object, such as stored settings. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The entries with string fields, without unknown fields (security-6). */
export function sanitizeDictionary(value: unknown): DictionaryEntry[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((item) => {
    const entry = asRecord(item);
    if (!entry) return [];
    const { id, spoken, replacement } = entry;
    return typeof id === "string" &&
      typeof spoken === "string" &&
      typeof replacement === "string"
      ? [{ id, spoken, replacement }]
      : [];
  });
}

/** The snippets with string fields, without unknown fields (security-6). */
export function sanitizeSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).flatMap((item) => {
    const snippet = asRecord(item);
    if (!snippet) return [];
    const { id, trigger, body } = snippet;
    return typeof id === "string" &&
      typeof trigger === "string" &&
      typeof body === "string"
      ? [{ id, trigger, body }]
      : [];
  });
}
