import type { Snippet } from "./wisprWorkflow";
import { createId, normalizeSnippet } from "./wisprWorkflow";
import { saveSettings, loadSettings, SETTINGS_KEYS } from "./persistence";

export function loadSnippets(): Snippet[] {
  const raw = loadSettings(SETTINGS_KEYS.snippets);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Snippet =>
        typeof s === "object" &&
        s !== null &&
        typeof s.id === "string" &&
        typeof s.trigger === "string" &&
        typeof s.body === "string",
    );
  } catch {
    return [];
  }
}

export function saveSnippets(snippets: Snippet[]): void {
  saveSettings(SETTINGS_KEYS.snippets, JSON.stringify(snippets));
}

export function addSnippet(
  snippets: Snippet[],
  trigger: string,
  body: string,
): Snippet[] {
  const normalized = normalizeSnippet({
    id: createId("snippet"),
    trigger,
    body,
  });
  if (!normalized) return snippets;

  // Deduplicate by trigger (case-insensitive)
  const duplicate = snippets.find(
    (s) => s.trigger.toLowerCase() === normalized.trigger.toLowerCase(),
  );
  if (duplicate) return snippets;

  return [...snippets, normalized];
}

export function removeSnippet(snippets: Snippet[], id: string): Snippet[] {
  return snippets.filter((s) => s.id !== id);
}

export function updateSnippet(
  snippets: Snippet[],
  id: string,
  updates: Partial<Omit<Snippet, "id">>,
): Snippet[] {
  return snippets.map((s) => {
    if (s.id !== id) return s;
    const updated = normalizeSnippet({
      id: s.id,
      trigger: updates.trigger ?? s.trigger,
      body: updates.body ?? s.body,
    });
    return updated ?? s;
  });
}

export function searchSnippets(snippets: Snippet[], query: string): Snippet[] {
  const q = query.toLowerCase().trim();
  if (!q) return snippets;
  return snippets.filter(
    (s) =>
      s.trigger.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
  );
}

export function importSnippets(csv: string): Snippet[] {
  const lines = csv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const snippets: Snippet[] = [];

  for (const line of lines) {
    const commaIndex = line.indexOf(",");
    if (commaIndex === -1) continue;
    const trigger = line.slice(0, commaIndex).trim();
    const body = line.slice(commaIndex + 1).trim();
    const normalized = normalizeSnippet({
      id: createId("snippet"),
      trigger,
      body,
    });
    if (normalized) {
      // Deduplicate within the import
      const exists = snippets.some(
        (s) => s.trigger.toLowerCase() === normalized.trigger.toLowerCase(),
      );
      if (!exists) snippets.push(normalized);
    }
  }

  return snippets;
}

export function exportSnippets(snippets: Snippet[]): string {
  return snippets.map((s) => `${s.trigger},${s.body}`).join("\n");
}
