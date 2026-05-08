import type { DictionaryEntry } from "./wisprWorkflow";
import { createId, normalizeDictionaryEntry } from "./wisprWorkflow";
import { saveSettings, loadSettings, SETTINGS_KEYS } from "./persistence";

export function loadDictionary(): DictionaryEntry[] {
  const raw = loadSettings(SETTINGS_KEYS.dictionaryEntries);
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

export function saveDictionary(entries: DictionaryEntry[]): void {
  saveSettings(SETTINGS_KEYS.dictionaryEntries, JSON.stringify(entries));
}

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
