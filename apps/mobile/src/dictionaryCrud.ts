// ── Types (mirrored from desktop wisprWorkflow.ts) ──────────────────
export type DictionaryEntry = {
  id: string;
  spoken: string;
  replacement: string;
};

// ── Pure helpers (identical to desktop wisprWorkflow.ts) ─────────────
export function createId(prefix: string, seed = Date.now()): string {
  return `${prefix}-${seed.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeDictionaryEntry(
  entry: Partial<DictionaryEntry>,
): DictionaryEntry | null {
  const spoken = entry.spoken?.trim();
  const replacement = entry.replacement?.trim();
  if (!spoken || !replacement) return null;
  return {
    id: entry.id?.trim() || createId("dict"),
    spoken,
    replacement,
  };
}

// ── Storage key ─────────────────────────────────────────────────────
const DICTIONARY_KEY = "sonolect.mobile.dictionaryEntries";

// ── Storage abstraction (injectable for testing) ────────────────────
export type DictionaryStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let _storage: DictionaryStorage | undefined;

function getStorage(): DictionaryStorage {
  if (_storage) return _storage;
  // Lazy-load mobile storage to avoid importing react-native at module eval
  // Falls back to in-memory map when react-native is not available (tests)
  const memoryStorage = new Map<string, string>();
  return {
    getItem: async (key: string) => memoryStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
  };
}

/** Override storage for testing or to inject the real SecureStore adapter. */
export function setDictionaryStorage(storage: DictionaryStorage): void {
  _storage = storage;
}

// ── Async CRUD (persistence layer) ──────────────────────────────────
export async function loadDictionary(): Promise<DictionaryEntry[]> {
  const raw = await getStorage().getItem(DICTIONARY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DictionaryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof e.id === "string" &&
        typeof e.spoken === "string" &&
        typeof e.replacement === "string",
    );
  } catch {
    return [];
  }
}

export async function saveDictionary(entries: DictionaryEntry[]): Promise<void> {
  await getStorage().setItem(DICTIONARY_KEY, JSON.stringify(entries));
}

// ── Pure CRUD (no I/O, identical signatures to desktop) ─────────────
export function addEntry(
  entries: DictionaryEntry[],
  spoken: string,
  replacement: string,
): DictionaryEntry[] {
  const normalized = normalizeDictionaryEntry({
    id: createId("dict"),
    spoken,
    replacement,
  });
  if (!normalized) return entries;

  // Deduplicate by spoken word (case-insensitive)
  const duplicate = entries.find(
    (e) => e.spoken.toLowerCase() === normalized.spoken.toLowerCase(),
  );
  if (duplicate) return entries;

  return [...entries, normalized];
}

export function removeEntry(
  entries: DictionaryEntry[],
  id: string,
): DictionaryEntry[] {
  return entries.filter((e) => e.id !== id);
}

export function updateEntry(
  entries: DictionaryEntry[],
  id: string,
  updates: Partial<Omit<DictionaryEntry, "id">>,
): DictionaryEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e;
    const updated = normalizeDictionaryEntry({
      id: e.id,
      spoken: updates.spoken ?? e.spoken,
      replacement: updates.replacement ?? e.replacement,
    });
    return updated ?? e;
  });
}

export function searchDictionary(
  entries: DictionaryEntry[],
  query: string,
): DictionaryEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      e.spoken.toLowerCase().includes(q) ||
      e.replacement.toLowerCase().includes(q),
  );
}

export function importDictionary(csv: string): DictionaryEntry[] {
  const lines = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: DictionaryEntry[] = [];

  for (const line of lines) {
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) continue;
    const spoken = line.slice(0, commaIndex).trim();
    const replacement = line.slice(commaIndex + 1).trim();
    const normalized = normalizeDictionaryEntry({
      id: createId("dict"),
      spoken,
      replacement,
    });
    if (normalized) {
      // Deduplicate within the import
      const exists = entries.some(
        (e) => e.spoken.toLowerCase() === normalized.spoken.toLowerCase(),
      );
      if (!exists) entries.push(normalized);
    }
  }

  return entries;
}

export function exportDictionary(entries: DictionaryEntry[]): string {
  return entries.map((e) => `${e.spoken},${e.replacement}`).join("\n");
}
