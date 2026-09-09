export type DictionaryEntry = {
  id: string;
  spoken: string;
  replacement: string;
};

export type Snippet = {
  id: string;
  trigger: string;
  body: string;
};

export type OnboardingChecklist = {
  micPermission: boolean;
  shortcutPrimer: boolean;
  whisperSetup: boolean;
  privacyChoice: boolean;
};

export type InsertionPlan = {
  method: "native-insert" | "clipboard-fallback" | "manual-copy";
  text: string;
  status: string;
};

const FILLER_PATTERN =
  /\b(um+|uh+|erm+)\b[,.!?\t ]*/gi;

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyDictionary(
  text: string,
  entries: DictionaryEntry[],
): string {
  return entries.reduce((current, entry) => {
    const pattern = new RegExp(`\\b${escapeRegex(entry.spoken)}\\b`, "gi");
    return current.replace(pattern, () => entry.replacement);
  }, text);
}

export function expandSnippets(text: string, snippets: Snippet[]): string {
  return snippets.reduce((current, snippet) => {
    const pattern = new RegExp(
      `(^|\\s)${escapeRegex(snippet.trigger)}(?=\\s|$)`,
      "g",
    );
    return current.replace(
      pattern,
      (_match, prefix: string) => `${prefix}${snippet.body}`,
    );
  }, text);
}

export function polishDictation(
  raw: string,
  options: { dictionary?: DictionaryEntry[]; snippets?: Snippet[] } = {},
): string {
  const cleaned = raw
    .replace(FILLER_PATTERN, "")
    .replace(/[\t ]+/g, " ")
    .replace(/[\t ]+([,.!?;:])/g, "$1")
    .trim();
  if (!cleaned) return "";

  const withDictionary = applyDictionary(cleaned, options.dictionary ?? []);
  const withSnippets = expandSnippets(withDictionary, options.snippets ?? []);
  return withSnippets.split(/(\n+)/).map((paragraph) => {
    if (/^\n+$/.test(paragraph)) return paragraph;
    const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => {
      const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
      return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
    });
    return sentences.join(" ");
  }).join("");
}

export function buildInsertionPlan(
  text: string,
  clipboardAvailable: boolean,
  nativeInsertionAvailable = false,
): InsertionPlan {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      method: "manual-copy",
      text: "",
      status: "Nothing to insert yet.",
    };
  }
  if (nativeInsertionAvailable) {
    return {
      method: "native-insert",
      text: trimmed,
      status: "Inserted polished dictation into the active app.",
    };
  }
  if (clipboardAvailable) {
    return {
      method: "clipboard-fallback",
      text: trimmed,
      status:
        "Copied polished dictation to clipboard. Paste into the app you were using.",
    };
  }
  return {
    method: "manual-copy",
    text: trimmed,
    status:
      "Clipboard unavailable. Select and copy the polished text manually.",
  };
}

export function onboardingProgress(checklist: OnboardingChecklist): number {
  const values = Object.values(checklist);
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

export function isOnboardingComplete(checklist: OnboardingChecklist): boolean {
  return onboardingProgress(checklist) === 100;
}
