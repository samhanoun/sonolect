import type { TranscriptHistoryRow } from "./searchAndFilter";

export type RetentionPolicy = {
  maxAgeDays: number;
  maxItems: number;
  autoDeleteEnabled: boolean;
};

export type PurgeResult = {
  removedCount: number;
  remainingCount: number;
  freedItems: string[];
};

const RETENTION_POLICY_KEY = "sonolect.mobile.retentionPolicy";

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxAgeDays: 90,
  maxItems: 1000,
  autoDeleteEnabled: false,
};

// ── Storage abstraction (injectable for testing) ────────────────────
export type RetentionStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let _storage: RetentionStorage | undefined;

function getStorage(): RetentionStorage {
  if (_storage) return _storage;
  // Lazy-load: falls back to in-memory map when react-native is not available
  const memoryStorage = new Map<string, string>();
  return {
    getItem: async (key: string) => memoryStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
  };
}

/** Override storage for testing or to inject the real SecureStore adapter. */
export function setRetentionStorage(storage: RetentionStorage): void {
  _storage = storage;
}

// ── Pure functions (identical to desktop) ───────────────────────────
export function applyRetentionPolicy(
  history: TranscriptHistoryRow[],
  policy: RetentionPolicy,
): PurgeResult {
  const now = Date.now();
  const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const freedItems: string[] = [];

  // Sort by date descending (newest first) for maxItems enforcement
  const sorted = [...history].sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    const age = now - new Date(row.updatedAt).getTime();
    const expired = age > maxAgeMs;
    const overLimit = i >= policy.maxItems;

    if (expired || overLimit) {
      freedItems.push(row.id);
    }
  }

  return {
    removedCount: freedItems.length,
    remainingCount: history.length - freedItems.length,
    freedItems,
  };
}

export function getRetentionStats(
  history: TranscriptHistoryRow[],
  policy: RetentionPolicy,
): { total: number; withinPolicy: number; expiring: number; expired: number } {
  const now = Date.now();
  const maxAgeMs = policy.maxAgeDays * 24 * 60 * 60 * 1000;
  const warningThreshold = maxAgeMs * 0.9; // 90% of max age

  let expired = 0;
  let expiring = 0;
  let withinPolicy = 0;

  for (const row of history) {
    const age = now - new Date(row.updatedAt).getTime();
    if (age > maxAgeMs) {
      expired++;
    } else if (age > warningThreshold) {
      expiring++;
    } else {
      withinPolicy++;
    }
  }

  return {
    total: history.length,
    withinPolicy,
    expiring,
    expired,
  };
}

export function validateRetentionPolicy(
  policy: Partial<RetentionPolicy>,
): RetentionPolicy {
  const maxAgeDays = clamp(
    typeof policy.maxAgeDays === "number" ? policy.maxAgeDays : DEFAULT_RETENTION_POLICY.maxAgeDays,
    1,
    3650,
  );
  const maxItems = clamp(
    typeof policy.maxItems === "number" ? policy.maxItems : DEFAULT_RETENTION_POLICY.maxItems,
    1,
    100_000,
  );
  const autoDeleteEnabled =
    typeof policy.autoDeleteEnabled === "boolean"
      ? policy.autoDeleteEnabled
      : DEFAULT_RETENTION_POLICY.autoDeleteEnabled;

  return { maxAgeDays, maxItems, autoDeleteEnabled };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ── Async persistence (mobile storage) ──────────────────────────────
export async function loadRetentionPolicy(): Promise<RetentionPolicy> {
  const raw = await getStorage().getItem(RETENTION_POLICY_KEY);
  if (!raw) return { ...DEFAULT_RETENTION_POLICY };
  try {
    const parsed = JSON.parse(raw) as Partial<RetentionPolicy>;
    return validateRetentionPolicy(parsed);
  } catch {
    return { ...DEFAULT_RETENTION_POLICY };
  }
}

export async function saveRetentionPolicy(policy: RetentionPolicy): Promise<void> {
  await getStorage().setItem(RETENTION_POLICY_KEY, JSON.stringify(policy));
}
