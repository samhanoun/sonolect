import type { SonolectMode } from "@sonolect/types";

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
  syncState: "local" | "queued" | "synced";
  pinned?: boolean;
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
  cloudSyncEnabled: boolean;
  localApiUrl?: string | undefined;
  hapticsEnabled: boolean;
  speechRate: number;
  onboarded: boolean;
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
  if (
    typeof merged.speechRate !== "number" ||
    !Number.isFinite(merged.speechRate)
  ) {
    merged.speechRate = 1;
  }
  merged.speechRate = Math.min(2, Math.max(0.5, merged.speechRate));
  return merged;
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
