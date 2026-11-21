/**
 * Privacy controls from the product spec: configurable retention for saved
 * recordings and a one-click "Delete all my data".
 *
 * Recordings live in the native capture folder, so deletion happens in Rust
 * (`purge_local_captures`). Preferences, the dictionary, snippets and drafts
 * live in localStorage under the `sonolect.` prefix. Provider API keys live in
 * the operating system's credential store.
 */

import { getT } from "./i18n";

/** 0 keeps recordings until the user deletes them. */
export const RETENTION_DAY_CHOICES = [0, 1, 7, 30, 90] as const;
export type RetentionDays = (typeof RETENTION_DAY_CHOICES)[number];

export const CAPTURE_RETENTION_KEY = "sonolect.captureRetentionDays";
const STORAGE_PREFIX = "sonolect.";
const PROVIDERS = ["openrouter", "opencode"] as const;

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type NativeCall = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function retentionLabel(days: RetentionDays) {
  const t = getT();
  return days === 0
    ? t("studio.retention.forever")
    : t.count("studio.retention.days", days);
}

export function loadCaptureRetentionDays(
  storage: StorageLike | undefined = browserStorage(),
): RetentionDays {
  try {
    const value = Number(storage?.getItem(CAPTURE_RETENTION_KEY));
    return (RETENTION_DAY_CHOICES as readonly number[]).includes(value)
      ? (value as RetentionDays)
      : 0;
  } catch {
    return 0;
  }
}

export function saveCaptureRetentionDays(
  days: RetentionDays,
  storage: StorageLike | undefined = browserStorage(),
) {
  try {
    storage?.setItem(CAPTURE_RETENTION_KEY, String(days));
  } catch {
    // Storage can be unavailable or full; the default (keep) still applies.
  }
}

/** Deletes recordings older than the retention setting. Returns the count. */
export async function applyCaptureRetention(
  call: NativeCall,
  days: RetentionDays = loadCaptureRetentionDays(),
): Promise<number> {
  if (days === 0) return 0;
  return call<number>("purge_local_captures", { olderThanDays: days });
}

export type DeleteAllResult = {
  recordingsRemoved: number;
  settingsRemoved: number;
  /** Steps that could not be completed, in plain language. */
  problems: string[];
};

/**
 * Deletes everything Sonolect keeps about the user on this device: recordings
 * and transcripts, saved API keys, the dictionary, snippets, drafts and
 * preferences. Downloaded speech models are not personal data and are kept.
 * In a build with sync, `forgetSync` forgets the sync key and the sync state
 * first, so that nothing syncs to or from this device again.
 */
export async function deleteAllLocalData(
  call: NativeCall,
  storage: StorageLike | undefined = browserStorage(),
  options: { forgetSync?: () => Promise<void> } = {},
): Promise<DeleteAllResult> {
  const problems: string[] = [];
  if (options.forgetSync) {
    try {
      await options.forgetSync();
    } catch (error) {
      problems.push(
        getT()("studio.privacy.problemSync", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  let recordingsRemoved = 0;
  try {
    recordingsRemoved = await call<number>("purge_local_captures", {
      olderThanDays: null,
    });
  } catch (error) {
    problems.push(
      getT()("studio.privacy.problemRecordings", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  for (const provider of PROVIDERS) {
    try {
      await call("delete_provider_key", { provider });
    } catch {
      // Secure key storage is unavailable on some platforms, so there is
      // nothing saved to delete there.
    }
  }
  let settingsRemoved = 0;
  try {
    if (storage) {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
      settingsRemoved = keys.length;
    }
  } catch (error) {
    problems.push(
      getT()("studio.privacy.problemSettings", {
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return { recordingsRemoved, settingsRemoved, problems };
}
