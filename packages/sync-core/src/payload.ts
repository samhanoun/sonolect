import { sha256 } from "@noble/hashes/sha2.js";

import { base64urlEncode, utf8Encode } from "./encoding";
import { type Hlc, isHlc, toHlc } from "./hlc";
import { NOTE_ID_PATTERN, isSyncableNoteId } from "./keys";

/**
 * The content schema of a synced note. A change to the meaning of a field
 * bumps it to "note/2"; a change to the cryptography bumps the envelope byte.
 */
export const NOTE_SCHEMA = "note/1";

/** A timed piece of a transcript (desktop segments). */
export interface SyncSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Speaker label, when one was set. */
  speaker?: string;
  /** Fields another app version wrote: kept, never dropped. */
  [extra: string]: unknown;
}

/**
 * A note as both apps exchange it ("note/1"). Required: createdAt, rawText,
 * durationMs and origin. A reader keeps every field it does not know and
 * writes it back unchanged, so neither app drops the other's data. The
 * README maps each field to the desktop capture and the mobile turn.
 */
export interface SyncNote {
  /** ISO 8601 date the note was recorded or typed. */
  createdAt: string;
  /** ISO 8601 date of the last change to the note's content. */
  updatedAt?: string;
  /** The transcript as dictated (desktop `transcript`, mobile `rawText`). */
  rawText: string;
  /** The refined text, when it differs from the transcript. */
  refinedText?: string;
  title?: string;
  /** BCP 47 tag; absent when unknown (mobile "auto"). */
  language?: string;
  /** Refinement mode (`SonolectMode`); absent means "dictate". */
  mode?: string;
  /** Length of the recording; 0 for typed notes. */
  durationMs: number;
  /** The app that created the note: "desktop" or "mobile". */
  origin: string;
  /** How it was captured: "microphone", "typed", "system", "file". */
  source?: string;
  pinned?: boolean;
  segments?: SyncSegment[];
  /** Set on a conflict copy: the id of the note it was copied from. */
  conflictOf?: string;
  /** Fields another app version wrote: kept, never dropped. */
  [extra: string]: unknown;
}

/** The canonical field names of "note/1"; anything else is passthrough. */
export const NOTE_FIELDS = [
  "createdAt",
  "updatedAt",
  "rawText",
  "refinedText",
  "title",
  "language",
  "mode",
  "durationMs",
  "origin",
  "source",
  "pinned",
  "segments",
  "conflictOf",
] as const;

/** What travels inside one sealed record. */
export interface NotePayload {
  schema: typeof NOTE_SCHEMA;
  id: string;
  hlc: Hlc;
  /** A tombstone: the note was deleted. Carries no `note`. */
  deleted: boolean;
  note?: SyncNote;
}

/** Thrown for a payload that is not a valid "note/1". */
export class InvalidPayloadError extends Error {
  /** True when the payload names a newer schema this version cannot read. */
  readonly newerSchema: boolean;
  constructor(message: string, newerSchema = false) {
    super(message);
    this.name = "InvalidPayloadError";
    this.newerSchema = newerSchema;
  }
}

const MAX_SHORT_TEXT = 200;
const MAX_TITLE = 2_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDateText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 10 &&
  value.length <= 40 &&
  !Number.isNaN(Date.parse(value));

const isShortText = (value: unknown, max = MAX_SHORT_TEXT): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= max;

const isMs = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function fail(message: string): never {
  throw new InvalidPayloadError(message);
}

function parseSegment(value: unknown): SyncSegment {
  if (!isRecord(value)) fail("segment is not an object");
  const { startMs, endMs, text, speaker } = value;
  if (!isMs(startMs) || !isMs(endMs) || typeof text !== "string")
    fail("segment needs startMs, endMs and text");
  if (speaker !== undefined && typeof speaker !== "string")
    fail("segment speaker is not text");
  return { ...value, startMs, endMs, text } as SyncSegment;
}

/**
 * Checks a note's canonical fields and returns a copy without `undefined`
 * values. Unknown fields are kept as they are.
 */
export function parseSyncNote(value: unknown): SyncNote {
  if (!isRecord(value)) fail("note is not an object");
  const note: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value))
    if (field !== undefined) note[key] = field;
  if (!isDateText(note.createdAt)) fail("note.createdAt is not a date");
  if (note.updatedAt !== undefined && !isDateText(note.updatedAt))
    fail("note.updatedAt is not a date");
  if (typeof note.rawText !== "string") fail("note.rawText is not text");
  if (note.refinedText !== undefined && typeof note.refinedText !== "string")
    fail("note.refinedText is not text");
  if (note.title !== undefined && !isShortText(note.title, MAX_TITLE))
    fail("note.title is not text");
  if (note.language !== undefined && !isShortText(note.language, 35))
    fail("note.language is not a language tag");
  for (const key of ["mode", "origin", "source"] as const)
    if (note[key] !== undefined && !isShortText(note[key]))
      fail(`note.${key} is not text`);
  if (!isShortText(note.origin)) fail("note.origin is missing");
  if (!isMs(note.durationMs)) fail("note.durationMs is not a duration");
  if (note.pinned !== undefined && typeof note.pinned !== "boolean")
    fail("note.pinned is not a boolean");
  if (note.conflictOf !== undefined && !isSyncableNoteId(note.conflictOf))
    fail("note.conflictOf is not a note id");
  if (note.segments !== undefined) {
    if (!Array.isArray(note.segments)) fail("note.segments is not a list");
    note.segments = (note.segments as unknown[]).map(parseSegment);
  }
  return note as SyncNote;
}

/** Input for {@link syncNote}: optional fields may be `undefined`. */
export type SyncNoteInput = {
  createdAt: string;
  rawText: string;
  durationMs: number;
  origin: string;
  updatedAt?: string | undefined;
  refinedText?: string | undefined;
  title?: string | undefined;
  language?: string | undefined;
  mode?: string | undefined;
  source?: string | undefined;
  pinned?: boolean | undefined;
  segments?: SyncSegment[] | undefined;
  conflictOf?: string | undefined;
  [extra: string]: unknown;
};

/**
 * Builds a valid SyncNote from an app's fields (undefined fields are left
 * out). Throws InvalidPayloadError when a field has the wrong type.
 */
export const syncNote = (input: SyncNoteInput): SyncNote =>
  parseSyncNote(input);

/** The fields of `note` that "note/1" does not define, for an app to keep as they are. */
export function extraFields(note: SyncNote): Record<string, unknown> {
  const known = new Set<string>(NOTE_FIELDS);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(note))
    if (!known.has(key)) extra[key] = value;
  return extra;
}

/** Checks a decrypted payload; throws InvalidPayloadError. */
export function parseNotePayload(value: unknown): NotePayload {
  if (!isRecord(value)) fail("payload is not an object");
  const { schema, id, hlc, deleted, note } = value;
  if (schema !== NOTE_SCHEMA) {
    if (typeof schema === "string" && /^note\/\d+$/.test(schema))
      throw new InvalidPayloadError(`unsupported schema ${schema}`, true);
    fail("payload is not a note");
  }
  if (typeof id !== "string" || !NOTE_ID_PATTERN.test(id))
    fail("payload.id is not a note id");
  if (!isHlc(hlc)) fail("payload.hlc is not a clock value");
  if (typeof deleted !== "boolean") fail("payload.deleted is not a boolean");
  if (deleted) return { schema: NOTE_SCHEMA, id, hlc: toHlc(hlc), deleted };
  return {
    schema: NOTE_SCHEMA,
    id,
    hlc: toHlc(hlc),
    deleted,
    note: parseSyncNote(note),
  };
}

/**
 * A short hash of what a person wrote in a note: transcript, refined text,
 * title and segments (with speakers). Metadata such as `pinned` is left out,
 * so pinning a note on one device and editing it on another is not a
 * conflict of content.
 */
export function noteFingerprint(note: SyncNote): string {
  const content = JSON.stringify([
    note.rawText,
    note.refinedText ?? null,
    note.title ?? null,
    (note.segments ?? []).map((segment) => [
      segment.startMs,
      segment.endMs,
      segment.text,
      segment.speaker ?? null,
    ]),
  ]);
  return base64urlEncode(sha256(utf8Encode(content)).subarray(0, 12));
}

/**
 * The id of a conflict copy: the original id with a suffix derived from the
 * losing version, so processing the same conflict twice yields the same copy.
 */
export function conflictCopyId(noteId: string, loser: Hlc): string {
  const suffix = `-c${loser.t.toString(36)}${loser.c > 0 ? `x${loser.c.toString(36)}` : ""}${loser.d.slice(0, 4)}`;
  return `${noteId.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`.slice(
    0,
    64,
  );
}

const DAY_MS = 24 * 60 * 60_000;

/**
 * The shared local retention rule: true when a note is older than
 * `retentionDays` (0 keeps everything). Pinned notes and notes whose date
 * cannot be read are kept, as the mobile app's retention does. Pass it as
 * the engine's `isExpired` so a device never imports what its own retention
 * would delete.
 */
export function isPastRetention(
  note: Pick<SyncNote, "createdAt" | "pinned">,
  retentionDays: number,
  nowMs: number,
): boolean {
  if (!(retentionDays > 0) || note.pinned === true) return false;
  const created = Date.parse(note.createdAt);
  if (!Number.isFinite(created) || created <= 0) return false;
  return created < nowMs - retentionDays * DAY_MS;
}
