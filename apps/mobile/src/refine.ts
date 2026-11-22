import type { DictionaryEntry, RefinementMode, Snippet } from "./domain";

/**
 * On-device text refinement. These transforms are deterministic and never
 * invent content: they only clean, restructure, or shorten what was said.
 * Generative modes (rewrite, reply) get real model output only from online
 * editing with the user's own key (onlineEdit.ts, after consent), or from
 * the dormant Sonolect API (`refineWithApi` in localApi.ts).
 */

// Only sounds that are never content words. "you know", "i mean", "like,",
// fr "ben" (also a name) and es "este" ("this") carry meaning too often.
// Each filler is a whole word, with its comma when it has one ("genre,"),
// and a comma after it goes with it. The patterns are written out, not
// built from strings.
const FILLER_PATTERNS: Record<string, readonly RegExp[]> = {
  en: [
    /(^|[\s,])um(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])uh(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])erm(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])er(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])uhm(?=[\s,.!?]|$)[,]?/giu,
  ],
  fr: [
    /(^|[\s,])euh(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])heu(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])bah(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])genre,(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])du coup,(?=[\s,.!?]|$)[,]?/giu,
  ],
  es: [
    /(^|[\s,])eh(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])o sea,(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])pues,(?=[\s,.!?]|$)[,]?/giu,
  ],
  de: [
    /(^|[\s,])äh(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])ähm(?=[\s,.!?]|$)[,]?/giu,
    /(^|[\s,])halt,(?=[\s,.!?]|$)[,]?/giu,
  ],
  ar: [],
};

// Words that are legitimately said twice in a row ("nous nous sommes vus",
// "he had had enough", "dass die die Zeitung liest", "oh là là", "así así");
// never collapsed.
const DOUBLED_WORDS: Record<string, readonly string[]> = {
  en: ["that", "had", "is"],
  fr: ["nous", "vous", "là"],
  es: ["que", "así"],
  de: ["die", "der", "das", "sie"],
};

// Arabic doubles any noun to mean "one by one" (خطوة خطوة, "step by step"),
// so its repetitions are never collapsed.
const KEEPS_ALL_REPETITIONS: readonly string[] = ["ar"];

// A word repeated right after itself ("the the"). JS \b is ASCII-only even
// with the u flag, so the boundaries are Unicode letters, marks and digits;
// marks keep a word with combining accents or Arabic vowel signs whole.
// A word joined to the letter before it by a hyphen or an apostrophe
// ("peut-être", "jusqu'à") is part of that word and never starts a
// repetition ("peut-être être", "jusqu'à à peu près"). A repetition followed
// by a hyphen and a letter is part of a compound ("peut peut-être") and is
// kept. An apostrophe after it is not, so "I I'm" still becomes "I'm".
const REPEATED_WORD =
  /(?<![\p{L}\p{M}\p{N}]|[\p{L}\p{M}\p{N}][-\u2010\u2011'\u2019])(\p{L}[\p{L}\p{M}]*)(?:\s+\1)+(?![\p{L}\p{M}\p{N}]|[-\u2010\u2011]\p{L})/giu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function baseLanguage(language: string): string {
  return language.split("-")[0]?.toLowerCase() ?? "en";
}

/** The filler patterns of a language; English for a language without any. */
function fillerPatterns(language: string): readonly RegExp[] {
  return FILLER_PATTERNS[baseLanguage(language)] ?? FILLER_PATTERNS.en ?? [];
}

function removeFillersWith(
  text: string,
  patterns: readonly RegExp[],
  language: string,
): string {
  const base = baseLanguage(language);
  let result = text;
  for (const pattern of patterns) result = result.replace(pattern, "$1");
  // Collapse immediate word repetitions ("the the" → "the"), except words
  // that the language legitimately doubles.
  if (!KEEPS_ALL_REPETITIONS.includes(base)) {
    const doubled = DOUBLED_WORDS[base] ?? DOUBLED_WORDS.en ?? [];
    result = result.replace(REPEATED_WORD, (match: string, word: string) =>
      doubled.includes(word.toLowerCase()) ? match : word,
    );
  }
  return collapseWhitespace(result);
}

export function removeFillers(text: string, language = "en-US"): string {
  return removeFillersWith(text, fillerPatterns(language), language);
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * Capitalizes the first letter of each sentence and ends the text with a
 * period when it has no closing mark. Sentences end with . ! ? (Latin), ؟
 * (Arabic) or 。！？ (full width, which need no space after them); Spanish
 * ¿ and ¡ may open a sentence before its first letter. Scripts without
 * letter case, such as Arabic, are left as they are.
 */
export function sentenceCase(text: string): string {
  const trimmed = collapseWhitespace(text);
  if (!trimmed) return "";
  return closeText(capitalizeSentences(trimmed, true));
}

/**
 * The first letter of each sentence in upper case. `startsSentence` says
 * whether the text's own start is a sentence start: false for a part of a
 * transcript that goes on from a sentence before it.
 */
function capitalizeSentences(text: string, startsSentence: boolean): string {
  return text.replace(
    /(^|[.!?؟]\s+|[。！？]\s*|\n)([¿¡]*)(\p{Ll})/gu,
    (match: string, lead: string, opener: string, letter: string) =>
      lead === "" && !startsSentence
        ? match
        : `${lead}${opener}${letter.toUpperCase()}`,
  );
}

/** A period at the end when the text has no closing mark. */
function closeText(text: string): string {
  return /[.!?…:؟。！？]$/.test(text) ? text : `${text}.`;
}

/** Whether the next text starts a sentence (see capitalizeSentences). */
function endsSentence(text: string): boolean {
  return /[.!?؟。！？]$/.test(text);
}

export function splitSentences(text: string): string[] {
  return collapseWhitespace(text)
    .split(/(?<=[.!?…؟])\s+|(?<=[。！？])(?![。！？])\s*|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

interface Replacement {
  pattern: RegExp;
  replacement: string;
}

/** A spoken phrase replaced on word boundaries only. */
function phraseReplacements(
  pairs: readonly (readonly [phrase: string, replacement: string])[],
): Replacement[] {
  const replacements: Replacement[] = [];
  for (const [phrase, replacement] of pairs) {
    const spoken = phrase.trim();
    if (!spoken) continue;
    replacements.push({
      pattern: new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(spoken)}(?=$|[^\\p{L}\\p{N}])`,
        "giu",
      ),
      replacement,
    });
  }
  return replacements;
}

/**
 * The user's text goes in as it is: a function, not a replacement string,
 * so "$100" or "$&" in a replacement is not read as a pattern.
 */
function replaceAll(text: string, replacements: readonly Replacement[]) {
  let result = text;
  for (const { pattern, replacement } of replacements) {
    result = result.replace(
      pattern,
      (_match: string, lead: string) => `${lead}${replacement}`,
    );
  }
  return result;
}

function dictionaryReplacements(entries: readonly DictionaryEntry[]) {
  return phraseReplacements(
    entries.map((entry) => [entry.spoken, entry.replacement] as const),
  );
}

function snippetReplacements(snippets: readonly Snippet[]) {
  return phraseReplacements(
    snippets.map((snippet) => [snippet.trigger, snippet.body] as const),
  );
}

export function applyDictionary(
  text: string,
  entries: readonly DictionaryEntry[],
): string {
  return replaceAll(text, dictionaryReplacements(entries));
}

/** Replaces a whole-utterance snippet trigger ("insert my address") with its body. */
export function expandSnippets(
  text: string,
  snippets: readonly Snippet[],
): string {
  return replaceAll(text, snippetReplacements(snippets));
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
  return sentenceCase(cleaner(context).clean(rawText));
}

/**
 * cleanTranscript without the sentence case: snippets, then the dictionary,
 * then fillers and repeated words. Its patterns are built once, for many
 * texts. `reach` is how many words a pattern can span, at least two
 * (a repeated word, a two-word filler).
 */
function cleaner(context: RefineContext): {
  clean: (text: string) => string;
  reach: number;
} {
  const language = context.language ?? "en-US";
  const snippets = context.snippets ?? [];
  const dictionary = context.dictionary ?? [];
  const fromSnippets = snippetReplacements(snippets);
  const fromDictionary = dictionaryReplacements(dictionary);
  const fillers = fillerPatterns(language);
  const phrases = [
    ...snippets.map((snippet) => snippet.trigger),
    ...dictionary.map((entry) => entry.spoken),
  ];
  return {
    clean: (text) =>
      removeFillersWith(
        replaceAll(replaceAll(text, fromSnippets), fromDictionary),
        fillers,
        language,
      ),
    reach: Math.max(2, ...phrases.map((phrase) => wordsOf(phrase).length)),
  };
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Consecutive parts `first` to `last` of a transcript, cleaned as one. */
export interface CleanedRun {
  first: number;
  last: number;
  text: string;
}

/**
 * cleanTranscript for a transcript said in parts, such as the timed
 * segments of a dictation, part by part. Joined with spaces, the runs are
 * cleanTranscript of the whole transcript: a sentence that goes on into
 * the next part gets no period at the end of the part and no capital at
 * the start of the next. Parts that a snippet trigger, a dictionary
 * phrase, a filler or a repeated word spans are cleaned together, as one
 * run, so a phrase split across two parts is still replaced. A run starting
 * with a comma or a period joins the run before it. Parts left empty are
 * dropped; the runs keep the order of the parts.
 */
export function cleanParts(
  parts: readonly string[],
  context: RefineContext = {},
): CleanedRun[] {
  const { clean, reach } = cleaner(context);
  const words: string[] = [];
  const starts: number[] = [];
  for (const part of parts) {
    starts.push(words.length);
    words.push(...wordsOf(part));
  }
  // A quick first pass: a pattern spans the boundary before word `at` when
  // the words around it clean differently together than apart. `reach`
  // words on each side hold most patterns that cross it; matchWhole
  // catches the rest.
  const window = reach + 1;
  const spanned = (at: number): boolean => {
    if (at <= 0 || at >= words.length) return false;
    const before = words.slice(Math.max(0, at - window), at).join(" ");
    const after = words.slice(at, at + window).join(" ");
    const apart = collapseWhitespace(
      [clean(before), clean(after)].filter(Boolean).join(" "),
    );
    return clean(`${before} ${after}`) !== apart;
  };
  const groups: { first: number; last: number }[] = [];
  parts.forEach((_part, index) => {
    const previous = groups.at(-1);
    if (previous && spanned(starts[index] ?? 0)) previous.last = index;
    else groups.push({ first: index, last: index });
  });
  const runs: CleanedRun[] = [];
  for (const group of groups) {
    addRun(runs, runs.length, {
      ...group,
      text: clean(parts.slice(group.first, group.last + 1).join(" ")),
    });
  }
  return matchWhole(parts, runs, clean, sentenceCase(clean(parts.join(" "))));
}

/**
 * Puts a cleaned run at `index`. An empty run is left out, and a run that
 * starts with a comma or a period joins the run before it: the whole
 * transcript has no space before that mark. Returns where the run went.
 */
function addRun(runs: CleanedRun[], index: number, run: CleanedRun): number {
  if (!run.text) return index;
  const previous = runs[index - 1];
  if (previous && /^[,.!?;:]/.test(run.text)) {
    previous.text = `${previous.text}${run.text}`;
    previous.last = run.last;
    return index - 1;
  }
  runs.splice(index, 0, run);
  return index;
}

/**
 * Checks the runs, sentence-cased, against `whole` (cleanTranscript of
 * all the parts) from the start. Where a run does not match, a pattern the
 * quick pass missed crosses its edge, such as a repeated word with fillers
 * between its copies: the run and its neighbours are cleaned again as one,
 * over twice as many neighbours each time the same place fails. All the
 * runs as one are `whole`, so this ends.
 */
function matchWhole(
  parts: readonly string[],
  runs: CleanedRun[],
  clean: (text: string) => string,
  whole: string,
): CleanedRun[] {
  const cased = (index: number): string => {
    const run = runs[index];
    if (!run) return "";
    const previous = runs[index - 1];
    const text = capitalizeSentences(
      run.text,
      !previous || endsSentence(previous.text),
    );
    return index === runs.length - 1 ? closeText(text) : text;
  };
  const at: number[] = [];
  let index = 0;
  let cursor = 0;
  let failed: { index: number; radius: number } | null = null;
  for (let steps = 0; index < runs.length; steps += 1) {
    if (steps > 8 * parts.length + 64) {
      // Not reached: there so that no input can loop.
      return whole ? [{ first: 0, last: parts.length - 1, text: whole }] : [];
    }
    const text = cased(index);
    const end = cursor + text.length;
    const fits =
      whole.startsWith(text, cursor) &&
      (index === runs.length - 1
        ? end === whole.length
        : /\s/.test(whole[end] ?? ""));
    if (fits) {
      at[index] = cursor;
      cursor = end + 1;
      index += 1;
      continue;
    }
    const radius: number =
      failed && index <= failed.index + 1 ? failed.radius * 2 : 1;
    const from = Math.max(0, index - radius);
    const to = Math.min(runs.length - 1, index + radius);
    const first = from === 0 ? 0 : (runs[from]?.first ?? 0);
    const last =
      to === runs.length - 1 ? parts.length - 1 : (runs[to]?.last ?? 0);
    runs.splice(from, to - from + 1);
    const placed = addRun(runs, from, {
      first,
      last,
      text: clean(parts.slice(first, last + 1).join(" ")),
    });
    failed = { index: placed, radius };
    // The run before may now be the last one, so it is checked again.
    index = Math.max(0, Math.min(placed, from) - 1);
    cursor = at[index] ?? 0;
  }
  if (runs.length === 0 && whole) {
    return [{ first: 0, last: parts.length - 1, text: whole }];
  }
  return runs.map((run, position) => ({ ...run, text: cased(position) }));
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
