import type { Hlc } from "@sonolect/sync-core";
import type { SonolectMode } from "@sonolect/types";

import type { OnlineEditing } from "./onlineRefine";
import { normalizeOnlineEditing } from "./onlineRefine";

export type CaptureStatus =
  "idle" | "listening" | "processing" | "ready" | "error";
export type PrivacyLevel = "standard" | "local_first" | "ephemeral";

/** BCP-47 tags the capture screen offers for dictation. */
export const DICTATION_LANGUAGES = [
  "en-US",
  "fr-FR",
  "es-ES",
  "de-DE",
  "ar-SA",
] as const;
export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number];

export type UiLanguage = "en" | "fr";

/**
 * One stretch of a dictation: what the recognizer heard and when. Times are
 * milliseconds from the start of the dictation's first recognizer session.
 */
export interface NoteSegment {
  startMs: number;
  endMs: number;
  /** As heard, before clean-up, like rawText. */
  text: string;
  /**
   * The app timed it when the words arrived; the recognizer gave no usable
   * times.
   */
  approx?: true;
}

export interface TranscriptTurn {
  id: string;
  rawText: string;
  refinedText: string;
  mode: SonolectMode;
  /** BCP-47 tag, or "auto" for transcripts whose language is unknown. */
  language: string;
  privacyMode: boolean;
  createdAt: string;
  durationMs: number;
  source: "microphone" | "typed" | "remote";
  /** The dormant Sonolect API sync (features.ts); never set by sync. */
  syncState: "local" | "queued" | "synced";
  pinned?: boolean;
  /**
   * When sync last saw this note change (sync-core's clock), stored with the
   * note so the two are always written together. Only builds with a sync
   * server set it (src/sync/edits.ts).
   */
  hlc?: Hlc;
  /** A conflict copy made by sync: the id of the note it was copied from. */
  conflictOf?: string;
  /**
   * When each part was said, for subtitles. Dictations from this version on,
   * and a synced note's segments when they all fit (sync/noteMapping.ts);
   * typed notes and older notes have none. Never changed after the capture:
   * a refine leaves them as they are.
   */
  segments?: NoteSegment[];
}

export interface CaptureSession {
  id: string;
  status: CaptureStatus;
  startedAt?: string;
  elapsedMs: number;
  partialTranscript: string;
  error?: string;
}

export interface DictionaryEntry {
  id: string;
  spoken: string;
  replacement: string;
}

export interface Snippet {
  id: string;
  trigger: string;
  body: string;
}

/**
 * How many days a saved note is kept before it is deleted automatically.
 * 0 keeps notes until they are deleted by hand. The same choices as the
 * desktop app's recording retention.
 */
export const RETENTION_DAY_CHOICES = [0, 1, 7, 30, 90] as const;
export type RetentionDays = (typeof RETENTION_DAY_CHOICES)[number];

export function isRetentionDays(value: unknown): value is RetentionDays {
  return (
    typeof value === "number" &&
    (RETENTION_DAY_CHOICES as readonly number[]).includes(value)
  );
}

export interface CompanionSettings {
  language: DictationLanguage;
  uiLanguage: UiLanguage;
  privacyLevel: PrivacyLevel;
  /**
   * Local first and Ephemeral: use the system speech service, which may send
   * audio to Google or Apple, when on-device dictation isn't available. Off by
   * default: the app then asks before each such dictation.
   */
  allowSystemService: boolean;
  saveHistory: boolean;
  /** Notes older than this many days are deleted; 0 keeps them. */
  retentionDays: RetentionDays;
  cloudSyncEnabled: boolean;
  localApiUrl?: string | undefined;
  hapticsEnabled: boolean;
  speechRate: number;
  onboarded: boolean;
  /**
   * Rewrite and Reply with the user's own provider key. Undefined (the
   * default) keeps every refinement on the phone.
   */
  onlineEditing?: OnlineEditing | undefined;
}

/** Refinement modes offered after a capture, in display order. */
export const REFINEMENT_MODES = [
  "dictate",
  "rewrite",
  "summarize",
  "reply",
  "task_creation",
] as const satisfies readonly SonolectMode[];
export type RefinementMode = (typeof REFINEMENT_MODES)[number];

/**
 * The page size of the dormant Sonolect API history (localApi.ts; the
 * server's maximum is 100). The phone keeps every note (data-2); the cap in
 * mergeTranscriptHistory is on the README checklist for the API.
 */
export const HISTORY_LIMIT = 100;

export const DEFAULT_SETTINGS: CompanionSettings = {
  language: "en-US",
  uiLanguage: "en",
  privacyLevel: "local_first",
  allowSystemService: false,
  saveHistory: true,
  retentionDays: 0,
  cloudSyncEnabled: false,
  hapticsEnabled: true,
  speechRate: 1,
  onboarded: false,
};

export function isDictationLanguage(
  value: unknown,
): value is DictationLanguage {
  return (
    typeof value === "string" &&
    (DICTATION_LANGUAGES as readonly string[]).includes(value)
  );
}

/** The privacy levels, in the order Settings shows them. */
export const PRIVACY_LEVELS = [
  "standard",
  "local_first",
  "ephemeral",
] as const satisfies readonly PrivacyLevel[];

function isPrivacyLevel(value: unknown): value is PrivacyLevel {
  return (
    typeof value === "string" &&
    (PRIVACY_LEVELS as readonly string[]).includes(value)
  );
}

/** Whether captures are saved to the phone's library. */
export function keepsHistory(
  settings: Pick<CompanionSettings, "saveHistory" | "privacyLevel">,
): boolean {
  return settings.saveHistory && settings.privacyLevel !== "ephemeral";
}

const BOOLEAN_SETTINGS = [
  "allowSystemService",
  "saveHistory",
  "cloudSyncEnabled",
  "hapticsEnabled",
  "onboarded",
] as const satisfies readonly (keyof CompanionSettings)[];

/**
 * Coerces persisted settings from older app versions into the current shape.
 * `base` fills what is missing or invalid: DEFAULT_SETTINGS, or on a first
 * run the defaults derived from the device language (firstRun.ts).
 */
export function normalizeSettings(
  saved: Partial<CompanionSettings> | undefined,
  base: CompanionSettings = DEFAULT_SETTINGS,
): CompanionSettings {
  const merged = { ...base, ...(saved ?? {}) };
  if (!isDictationLanguage(merged.language)) {
    merged.language = isDictationLanguage(base.language)
      ? base.language
      : DEFAULT_SETTINGS.language;
  }
  if (merged.uiLanguage !== "en" && merged.uiLanguage !== "fr") {
    merged.uiLanguage =
      base.uiLanguage === "en" || base.uiLanguage === "fr"
        ? base.uiLanguage
        : DEFAULT_SETTINGS.uiLanguage;
  }
  if (!isPrivacyLevel(merged.privacyLevel)) {
    merged.privacyLevel = DEFAULT_SETTINGS.privacyLevel;
  }
  // A value that isn't a boolean (a string such as "false" is truthy) falls
  // back to the default instead of deciding whether notes are kept.
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof merged[key] !== "boolean") merged[key] = DEFAULT_SETTINGS[key];
  }
  // Anything but a known choice keeps the notes: a bad value never deletes.
  if (!isRetentionDays(merged.retentionDays)) merged.retentionDays = 0;
  if (
    typeof merged.speechRate !== "number" ||
    !Number.isFinite(merged.speechRate)
  ) {
    merged.speechRate = 1;
  }
  merged.speechRate = Math.min(2, Math.max(0.5, merged.speechRate));
  // Anything but a valid provider and model turns online editing off.
  const onlineEditing = normalizeOnlineEditing(merged.onlineEditing);
  if (onlineEditing) merged.onlineEditing = onlineEditing;
  else delete merged.onlineEditing;
  return merged;
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
