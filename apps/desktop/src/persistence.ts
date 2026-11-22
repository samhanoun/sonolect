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
  whisperConfig: `${KEY_PREFIX}whisperConfig`,
  dictionaryEntries: `${KEY_PREFIX}dictionaryEntries`,
  snippets: `${KEY_PREFIX}snippets`,
  onboardingChecklist: `${KEY_PREFIX}onboardingChecklist`,
  transcriptDraft: `${KEY_PREFIX}transcriptDraft`,
} as const;

/** The saved recording a draft was opened from, at the version it had then. */
export type DraftOpenedVersion = {
  id: string;
  hlc: { t: number; c: number; d: string } | null;
};

export type TranscriptDraft = {
  activeSessionId: string | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  selectedSegmentIds: string[];
  savedAt: string;
  /**
   * Kept so that a save after a restart still keeps a version that sync
   * wrote meanwhile, as a conflict copy.
   */
  openedVersion?: DraftOpenedVersion | null;
};

function parseOpenedVersion(value: unknown): DraftOpenedVersion | null {
  if (!value || typeof value !== "object") return null;
  const { id, hlc } = value as { id?: unknown; hlc?: unknown };
  if (typeof id !== "string" || !id) return null;
  if (hlc === null) return { id, hlc: null };
  if (!hlc || typeof hlc !== "object") return null;
  const { t, c, d } = hlc as { t?: unknown; c?: unknown; d?: unknown };
  return typeof t === "number" && typeof c === "number" && typeof d === "string"
    ? { id, hlc: { t, c, d } }
    : null;
}

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
    const openedVersion = parseOpenedVersion(draft.openedVersion);
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
      ...(openedVersion ? { openedVersion } : {}),
    };
  } catch {
    return null;
  }
}

export function clearTranscriptDraft(): void {
  clearSettings(SETTINGS_KEYS.transcriptDraft);
}
