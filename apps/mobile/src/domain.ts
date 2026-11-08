import type { SonolectMode } from "@sonolect/types";

export type CaptureStatus =
  | "idle"
  | "listening"
  | "processing"
  | "ready"
  | "error";
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

export const HISTORY_LIMIT = 100;

export const DEFAULT_SETTINGS: CompanionSettings = {
  language: "en-US",
  uiLanguage: "en",
  privacyLevel: "local_first",
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

/** Coerces persisted settings from older app versions into the current shape. */
export function normalizeSettings(
  saved: Partial<CompanionSettings> | undefined,
): CompanionSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  if (!isDictationLanguage(merged.language)) {
    merged.language = DEFAULT_SETTINGS.language;
  }
  if (merged.uiLanguage !== "en" && merged.uiLanguage !== "fr") {
    merged.uiLanguage = DEFAULT_SETTINGS.uiLanguage;
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
