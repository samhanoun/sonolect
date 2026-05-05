import type { TranscriptSegment } from "./segmentEditor";

/**
 * Settings persistence helpers using localStorage.
 * Safe fallbacks when localStorage is unavailable (SSR/test env).
 */

const KEY_PREFIX = "sonolect.";

export const SETTINGS_KEYS = {
  locale: `${KEY_PREFIX}locale`,
  sttLanguage: `${KEY_PREFIX}sttLanguage`,
  privacyLevel: `${KEY_PREFIX}privacyLevel`,
  transcriptDraft: `${KEY_PREFIX}transcriptDraft`,
} as const;

export type TranscriptDraft = {
  activeSessionId: string | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  selectedSegmentIds: string[];
  savedAt: string;
};

function isLocalStorageAvailable(): boolean {
  try {
    const testKey = "__sonolect_ls_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

export function saveSettings(key: string, value: string): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or other error – silently ignore
  }
}

export function loadSettings(key: string): string | null {
  if (!isLocalStorageAvailable()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearSettings(key: string): void {
  if (!isLocalStorageAvailable()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

export function saveTranscriptDraft(draft: TranscriptDraft): void {
  saveSettings(SETTINGS_KEYS.transcriptDraft, JSON.stringify(draft));
}

export function loadTranscriptDraft(): TranscriptDraft | null {
  const raw = loadSettings(SETTINGS_KEYS.transcriptDraft);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<TranscriptDraft>;
    if (
      typeof draft.transcript !== "string" ||
      !Array.isArray(draft.transcriptSegments) ||
      !Array.isArray(draft.selectedSegmentIds) ||
      typeof draft.savedAt !== "string"
    ) {
      return null;
    }
    return {
      activeSessionId:
        typeof draft.activeSessionId === "string"
          ? draft.activeSessionId
          : null,
      transcript: draft.transcript,
      transcriptSegments: draft.transcriptSegments,
      selectedSegmentIds: draft.selectedSegmentIds.filter(
        (id): id is string => typeof id === "string",
      ),
      savedAt: draft.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearTranscriptDraft(): void {
  clearSettings(SETTINGS_KEYS.transcriptDraft);
}
