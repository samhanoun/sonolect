/**
 * The sync engine's NoteStore over the desktop capture files.
 *
 * A capture (`local_history.rs`) maps to a note/1 as sync-core's README
 * describes: `transcript` is `rawText`, `createdAtMs` and `updatedAtMs` are
 * ISO dates, the fields a recording made here does not have (title, refined
 * text, mode, pinned, origin, source, conflictOf) are kept as received, and
 * every field note/1 does not define travels in `extra` and comes back
 * unchanged. The error text and the audio stay on this device. A synced
 * note has no audio: recordings do not sync.
 *
 * Every write goes through the native compare-and-set commands, which hold
 * the capture lock, so a note that arrives through sync never overwrites a
 * change made here meanwhile.
 */
import {
  InvalidPayloadError,
  type Hlc,
  type LocalExpectation,
  type LocalNote,
  type LocalNoteSummary,
  type NoteStore,
  type SyncNote,
  type SyncSegment,
  extraFields,
  syncNote,
} from "@sonolect/sync-core";

import { type Invoke, nativeError } from "./platform";

/** A timed segment as the capture file keeps it. */
export interface CaptureSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  /** Fields of a synced segment this version does not know. */
  [extra: string]: unknown;
}

/** A capture as `read_sync_note` returns it and `upsert_synced_capture` takes it. */
export interface StoredCapture {
  id: string;
  createdAtMs: number;
  durationMs: number;
  transcript: string | null;
  error: string | null;
  language: string | null;
  segments: CaptureSegment[];
  title?: string;
  refinedText?: string;
  mode?: string;
  pinned?: boolean;
  origin?: string;
  source?: string;
  conflictOf?: string;
  updatedAtMs?: number;
  hlc?: Hlc;
  /** The note/1 fields this version does not know, kept as they came. */
  extra?: Record<string, unknown>;
}

/** What `list_sync_notes` returns for each note. */
interface NativeSummary {
  id: string;
  hlc?: Hlc;
  createdAtMs: number;
  updatedAtMs?: number;
}

/** What became of a remote change (see `Applied` in local_history.rs). */
type Applied = "written" | "changed" | "skipped";

/** The app that made a note when the capture does not say. */
export const DESKTOP_ORIGIN = "desktop";

/** The capture files store whole milliseconds. */
const wholeMs = (value: number) =>
  Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));

const isoDate = (ms: number) => {
  const date = new Date(ms);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
};

const msOf = (date: string | undefined): number | undefined => {
  if (date === undefined) return undefined;
  const ms = Date.parse(date);
  return Number.isFinite(ms) ? wholeMs(ms) : undefined;
};

/**
 * The note/1 for a capture. It never throws: a capture that does not make a
 * valid note (say, a language tag too long) is returned as it is, and the
 * engine reports it in `report.invalid` instead of failing the whole run.
 */
export function captureToNote(capture: StoredCapture): SyncNote {
  const input = {
    ...capture.extra,
    createdAt: isoDate(capture.createdAtMs),
    updatedAt:
      capture.updatedAtMs === undefined
        ? undefined
        : isoDate(capture.updatedAtMs),
    rawText: capture.transcript ?? "",
    refinedText: capture.refinedText,
    title: capture.title,
    // "auto" is a request, not a language: a note without one says so.
    language:
      capture.language && capture.language !== "auto"
        ? capture.language
        : undefined,
    mode: capture.mode,
    durationMs: capture.durationMs,
    origin: capture.origin ?? DESKTOP_ORIGIN,
    source: capture.source,
    pinned: capture.pinned,
    segments:
      capture.segments.length > 0
        ? capture.segments.map((segment) => ({ ...segment }) as SyncSegment)
        : undefined,
    conflictOf: capture.conflictOf,
  };
  try {
    return syncNote(input);
  } catch (error) {
    if (!(error instanceof InvalidPayloadError)) throw error;
    const note: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) note[key] = value;
    return note as SyncNote;
  }
}

/**
 * The capture for a note that came through sync: no audio, no error (the
 * native side keeps a local one), and every unknown field in `extra`.
 */
export function noteToCapture(
  id: string,
  note: SyncNote,
  hlc: Hlc,
): StoredCapture {
  const capture: StoredCapture = {
    id,
    createdAtMs: msOf(note.createdAt) ?? 0,
    durationMs: wholeMs(note.durationMs),
    transcript: note.rawText,
    error: null,
    language: note.language ?? null,
    segments: (note.segments ?? []).map((segment) => ({
      ...segment,
      startMs: wholeMs(segment.startMs),
      endMs: wholeMs(segment.endMs),
    })),
    hlc: { t: hlc.t, c: hlc.c, d: hlc.d },
  };
  const updatedAtMs = msOf(note.updatedAt);
  if (updatedAtMs !== undefined) capture.updatedAtMs = updatedAtMs;
  if (note.title !== undefined) capture.title = note.title;
  if (note.refinedText !== undefined) capture.refinedText = note.refinedText;
  if (note.mode !== undefined) capture.mode = note.mode;
  if (note.pinned !== undefined) capture.pinned = note.pinned;
  if (note.origin !== undefined) capture.origin = note.origin;
  if (note.source !== undefined) capture.source = note.source;
  if (note.conflictOf !== undefined) capture.conflictOf = note.conflictOf;
  const extra = extraFields(note);
  if (Object.keys(extra).length > 0) capture.extra = extra;
  return capture;
}

const expectation = (expected: LocalExpectation) =>
  expected.exists
    ? { exists: true, ...(expected.hlc ? { hlc: expected.hlc } : {}) }
    : { exists: false };

/** The NoteStore of the desktop app, over the native capture commands. */
export function createDesktopNoteStore(invoke: Invoke): NoteStore {
  const call = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw nativeError(error);
    }
  };
  // "skipped": this device cannot keep the note (its id names a device on
  // Windows, or another note's file where names ignore case). The engine
  // counts it as applied, so it does not ask again on every run.
  const applied = (outcome: Applied) => outcome !== "changed";

  return {
    async list(): Promise<LocalNoteSummary[]> {
      const notes = await call<NativeSummary[]>("list_sync_notes");
      return notes.map(({ id, hlc, createdAtMs, updatedAtMs }) => ({
        id,
        ...(hlc ? { hlc } : {}),
        createdAtMs,
        ...(updatedAtMs !== undefined ? { updatedAtMs } : {}),
      }));
    },
    async read(id): Promise<LocalNote | undefined> {
      const capture = await call<StoredCapture | null>("read_sync_note", {
        id,
      });
      if (!capture) return undefined;
      return {
        note: captureToNote(capture),
        ...(capture.hlc ? { hlc: capture.hlc } : {}),
      };
    },
    async applyRemote({ id, note, hlc, expected }) {
      const outcome =
        note === null
          ? await call<Applied>("apply_remote_delete", {
              id,
              expected: expectation(expected),
            })
          : await call<Applied>("upsert_synced_capture", {
              capture: noteToCapture(id, note, hlc),
              expected: expectation(expected),
            });
      return applied(outcome);
    },
    async saveConflictCopy(id, note, hlc) {
      await call<Applied>("upsert_synced_capture", {
        capture: noteToCapture(id, note, hlc),
        expected: null,
      });
    },
  };
}
