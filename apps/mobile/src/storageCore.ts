import type { SonolectMode } from "@sonolect/types";

import type { DictionaryEntry, Snippet, TranscriptTurn } from "./domain";

/**
 * Notes on the phone, one key per note plus an index of ids (data-1,
 * data-2). Pure: the key-value store is passed in, so tests can inject
 * faults, and storage.ts passes AsyncStorage. The rules:
 * - a read error never deletes anything;
 * - a note whose JSON is broken is copied to `<key>.corrupt`, then removed;
 * - a save writes the changed notes, then removes the deleted ones, then
 *   writes the index, so a crash never brings a deleted note back;
 * - the v2 history value is removed only after the new index was written
 *   and read back.
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

export const NOTE_PREFIX = "sonolect.mobile.note.";
/** `{"v":3,"ids":[...]}`, newest first. */
export const INDEX_KEY = "sonolect.mobile.notes.index.v3";
/** The whole history as one JSON array, before v3. */
export const LEGACY_V2_KEY = "sonolect.mobile.history.v2";
/** v0.1's history key. */
export const LEGACY_V1_KEY = "sonolect.mobile.history";
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
   * False: some saved notes could not be read. Nothing was deleted, `notes`
   * holds what could be read without changing anything, and saves only add
   * or update notes until the next load succeeds.
   */
  ok: boolean;
  /** Newest first. */
  notes: TranscriptTurn[];
}

export interface NoteStore {
  /** Reads the notes, moving the v2 history to one key per note once. */
  load(): Promise<NotesLoad>;
  /** Stores this list (newest first) as the notes. */
  save(notes: readonly TranscriptTurn[]): Promise<void>;
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
  }: { now?: () => number; batchSize?: number } = {},
): NoteStore {
  const size = Math.max(1, Math.floor(batchSize));
  // Until a load succeeds, the stored notes are unknown: saves then add or
  // update notes only, and never remove a key or write the index.
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

  const listNoteIds = async (): Promise<string[] | null> => {
    try {
      return (await kv.getAllKeys())
        .filter(isNoteKey)
        .map((key) => key.slice(NOTE_PREFIX.length));
    } catch {
      return null;
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
    const ids = await listNoteIds();
    const read = ids ? await readNotes(ids, nowMs) : null;
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
    const orphanIds = ((await listNoteIds()) ?? []).filter(
      (id) => !listed.has(id),
    );
    let orphans: StoredNote[] = [];
    if (orphanIds.length > 0) {
      const orphanRead = await readNotes(orphanIds, nowMs);
      if (orphanRead) {
        await setAside(orphanRead.broken);
        orphans = [...orphanRead.notes.values()].sort(newestFirst);
      }
    }
    const notes = orphans.length > 0 ? mergeByDate(indexed, orphans) : indexed;
    if (orphans.length > 0 || rewrite) {
      try {
        await kv.setItem(
          INDEX_KEY,
          serializeIndex(notes.map((stored) => stored.turn.id)),
        );
      } catch {
        // Every save writes the index again.
      }
    }
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
        const seen = new Set<string>();
        for (const item of value as unknown[]) {
          const turn = sanitizeTurn(item, nowMs);
          if (!turn || seen.has(turn.id) || isV01Sample(turn)) continue;
          seen.add(turn.id);
          fromV2.push(turn);
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
    const storedIds = await listNoteIds();
    if (!storedIds) return failed(nowMs);
    const read = await readNotes(storedIds, nowMs);
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
    if (v2Raw === null && notes.length === 0) return loaded(notes);

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
    if (!degraded) {
      const removed = [...known.keys()]
        .filter((id) => !next.has(id))
        .map(noteKey);
      for (const batch of chunk(removed, size)) await kv.multiRemove(batch);
      await kv.setItem(INDEX_KEY, serializeIndex([...next.keys()]));
    }
    // A failure above keeps the previous baseline, so the next save writes
    // everything this one could not.
    known = next;
  };

  const clear = async () => {
    const keys = new Set<string>([
      INDEX_KEY,
      `${INDEX_KEY}${CORRUPT_SUFFIX}`,
      LEGACY_V2_KEY,
      `${LEGACY_V2_KEY}${CORRUPT_SUFFIX}`,
      LEGACY_V1_KEY,
      ...[...known.keys()].map(noteKey),
    ]);
    // Every note key, with the copies of broken notes.
    for (const key of await kv.getAllKeys()) {
      if (key.startsWith(NOTE_PREFIX)) keys.add(key);
    }
    for (const batch of chunk([...keys], size)) await kv.multiRemove(batch);
    known = new Map();
    degraded = false;
  };

  return {
    load: () => serialized(load),
    save: (notes) => serialized(() => save(notes)),
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
