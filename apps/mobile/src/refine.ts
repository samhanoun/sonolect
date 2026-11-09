import type { DictionaryEntry, RefinementMode, Snippet } from "./domain";

/**
 * On-device text refinement. These transforms are deterministic and never
 * invent content: they only clean, restructure, or shorten what was said.
 * Generative modes (rewrite, reply) get real model output only when the
 * Sonolect API is configured; see `refineWithApi` in localApi.ts.
 */

const FILLERS: Record<string, string[]> = {
  en: ["um", "uh", "erm", "er", "uhm", "you know", "i mean", "like,"],
  fr: ["euh", "heu", "bah", "ben", "genre,", "du coup,"],
  es: ["eh", "este", "o sea,", "pues,"],
  de: ["äh", "ähm", "halt,"],
  ar: [],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseLanguage(language: string): string {
  return language.split("-")[0]?.toLowerCase() ?? "en";
}

export function removeFillers(text: string, language = "en-US"): string {
  const fillers = FILLERS[baseLanguage(language)] ?? FILLERS.en ?? [];
  let result = text;
  for (const filler of fillers) {
    const pattern = new RegExp(
      `(^|[\\s,])${escapeRegExp(filler)}(?=[\\s,.!?]|$)[,]?`,
      "giu",
    );
    result = result.replace(pattern, "$1");
  }
  // Collapse immediate word repetitions ("the the" → "the").
  result = result.replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1");
  return collapseWhitespace(result);
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function sentenceCase(text: string): string {
  const trimmed = collapseWhitespace(text);
  if (!trimmed) return "";
  const capitalized = trimmed.replace(
    /(^|[.!?]\s+|\n)(\p{Ll})/gu,
    (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`,
  );
  return /[.!?…:]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function splitSentences(text: string): string[] {
  return collapseWhitespace(text)
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function applyDictionary(
  text: string,
  entries: readonly DictionaryEntry[],
): string {
  let result = text;
  for (const entry of entries) {
    const spoken = entry.spoken.trim();
    if (!spoken) continue;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(spoken)}(?=$|[^\\p{L}\\p{N}])`,
      "giu",
    );
    result = result.replace(pattern, `$1${entry.replacement}`);
  }
  return result;
}

/** Replaces a whole-utterance snippet trigger ("insert my address") with its body. */
export function expandSnippets(
  text: string,
  snippets: readonly Snippet[],
): string {
  let result = text;
  for (const snippet of snippets) {
    const trigger = snippet.trigger.trim();
    if (!trigger) continue;
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(trigger)}(?=$|[^\\p{L}\\p{N}])`,
      "giu",
    );
    result = result.replace(pattern, `$1${snippet.body}`);
  }
  return result;
}

function summarize(text: string): string {
  const sentences = splitSentences(sentenceCase(text));
  if (sentences.length <= 2) return sentences.join(" ");
  // Keep the opening sentence plus the longest remaining ones (they tend to
  // carry the content), in their original order, capped at three.
  const ranked = sentences
    .slice(1)
    .map((sentence, index) => ({ sentence, index }))
    .sort((a, b) => b.sentence.length - a.sentence.length)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
  return [sentences[0], ...ranked].join(" ");
}

function toTasks(text: string): string {
  const parts = collapseWhitespace(text)
    .split(
      /(?<=[.!?;])\s+|\n+|,?\s+(?:and then|then|after that|puis|ensuite|et après|y luego|und dann)\s+/i,
    )
    .map((part) => part.replace(/[.;]+$/, "").trim())
    .filter((part) => part.length > 1);
  if (parts.length === 0) return "";
  return parts
    .map((part) => `• ${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("\n");
}

export interface RefineContext {
  language?: string;
  dictionary?: readonly DictionaryEntry[];
  snippets?: readonly Snippet[];
}

export function cleanTranscript(
  rawText: string,
  context: RefineContext = {},
): string {
  const language = context.language ?? "en-US";
  const withSnippets = expandSnippets(rawText, context.snippets ?? []);
  const withDictionary = applyDictionary(
    withSnippets,
    context.dictionary ?? [],
  );
  return sentenceCase(removeFillers(withDictionary, language));
}

/** Local refinement for each mode. Returns the cleaned text when a mode needs a model. */
export function refineLocally(
  rawText: string,
  mode: RefinementMode,
  context: RefineContext = {},
): string {
  const cleaned = cleanTranscript(rawText, context);
  switch (mode) {
    case "summarize":
      return summarize(cleaned);
    case "task_creation":
      return toTasks(cleaned);
    case "rewrite":
    case "reply":
    case "dictate":
    default:
      return cleaned;
  }
}

/** Modes whose local output is only a clean-up; a model gives the real result. */
export function modeNeedsModel(mode: RefinementMode): boolean {
  return mode === "rewrite" || mode === "reply";
}

export function stylePresetForMode(mode: RefinementMode): string {
  switch (mode) {
    case "rewrite":
      return "Rewrite so it reads clearly and professionally. Keep the meaning and the language";
    case "reply":
      return "Turn this into a short, polite reply ready to send, in the same language";
    case "summarize":
      return "Summarize as two or three short sentences with the key decisions and actions";
    case "task_creation":
      return "Extract the action items as a bulleted list, one per line";
    case "dictate":
    default:
      return "Clean up the dictation: punctuation, casing, no filler words. Do not change the meaning";
  }
}
