// ── Types (mirrored from desktop wisprWorkflow.ts) ──────────────────
export type Snippet = {
  id: string;
  trigger: string;
  body: string;
};

// ── Pure helpers (identical to desktop wisprWorkflow.ts) ─────────────
export function createId(prefix: string, seed = Date.now()): string {
  return `${prefix}-${seed.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeSnippet(snippet: Partial<Snippet>): Snippet | null {
  const trigger = snippet.trigger?.trim();
  const body = snippet.body?.trim();
  if (!trigger || !body) return null;
  return {
    id: snippet.id?.trim() || createId("snippet"),
    trigger: trigger.startsWith("/") ? trigger : `/${trigger}`,
    body,
  };
}

// ── Storage key ─────────────────────────────────────────────────────
const SNIPPETS_KEY = "sonolect.mobile.snippets";

// ── Storage abstraction (injectable for testing) ────────────────────
export type SnippetStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let _storage: SnippetStorage | undefined;

function getStorage(): SnippetStorage {
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
export function setSnippetStorage(storage: SnippetStorage): void {
  _storage = storage;
}

// ── Async CRUD (persistence layer) ──────────────────────────────────
export async function loadSnippets(): Promise<Snippet[]> {
  const raw = await getStorage().getItem(SNIPPETS_KEY);
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

export async function saveSnippets(snippets: Snippet[]): Promise<void> {
  await getStorage().setItem(SNIPPETS_KEY, JSON.stringify(snippets));
}

// ── Pure CRUD (no I/O, identical signatures to desktop) ─────────────
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

export function removeSnippet(
  snippets: Snippet[],
  id: string,
): Snippet[] {
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

export function searchSnippets(
  snippets: Snippet[],
  query: string,
): Snippet[] {
  const q = query.toLowerCase().trim();
  if (!q) return snippets;
  return snippets.filter(
    (s) =>
      s.trigger.toLowerCase().includes(q) ||
      s.body.toLowerCase().includes(q),
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
