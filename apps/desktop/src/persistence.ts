/**
 * Settings persistence helpers using localStorage.
 * Safe fallbacks when localStorage is unavailable (SSR/test env).
 */

const KEY_PREFIX = "sonolect.";

export const SETTINGS_KEYS = {
  locale: `${KEY_PREFIX}locale`,
  sttLanguage: `${KEY_PREFIX}sttLanguage`,
  privacyLevel: `${KEY_PREFIX}privacyLevel`,
} as const;

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
