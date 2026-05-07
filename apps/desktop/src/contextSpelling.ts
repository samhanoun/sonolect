import type { DictionaryEntry } from "./wisprWorkflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpellingContext = {
  clipboardText?: string | undefined;
  recentTranscripts: string[];
  dictionaryEntries: DictionaryEntry[];
  customTerms: string[];
};

export type SpellingCorrection = {
  original: string;
  corrected: string;
  source: "dictionary" | "context" | "frequency";
};

// ---------------------------------------------------------------------------
// Levenshtein distance (inline, no external dep)
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Single-row approach
  const row: number[] = Array.from({ length: lb + 1 }, (_, i) => i);

  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        (row[j] ?? 0) + 1, // deletion
        prev + 1, // insertion
        (row[j - 1] ?? 0) + cost, // substitution
      );
      row[j - 1] = prev;
      prev = val;
    }
    row[lb] = prev;
  }

  return row[lb] ?? 0;
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Return the best-matching candidate within the given Levenshtein threshold.
 * Comparison is case-insensitive and accent-insensitive (NFD + strip combining
 * marks) so "Francois" can match "François".
 */
export function fuzzyMatch(
  word: string,
  candidates: string[],
  threshold = 2,
): string | null {
  if (candidates.length === 0) return null;

  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const nWord = normalize(word);
  let bestDist = Infinity;
  let bestCandidate: string | null = null;

  for (const candidate of candidates) {
    const nCandidate = normalize(candidate);
    if (nWord === nCandidate) return candidate; // exact match shortcut
    const dist = levenshtein(nWord, nCandidate);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

// ---------------------------------------------------------------------------
// Proper-noun extraction
// ---------------------------------------------------------------------------

/**
 * Extract capitalized words that are NOT sentence starters.
 * Heuristic: a word is a sentence starter when preceded by nothing, a period,
 * an exclamation/question mark, or a newline.
 */
export function extractProperNouns(text: string): string[] {
  const words = text.split(/\s+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;

    // Strip trailing punctuation for the check, but keep the original casing
    const cleaned = word.replace(/[,.!?;:()[\]"']+$/g, "").trim();
    if (!cleaned || !/^[A-ZÀ-ɏ]/.test(cleaned)) continue;

    // Skip if it's the first word or follows sentence-ending punctuation
    if (i === 0) continue;
    const prev = words[i - 1];
    if (!prev) continue;
    if (/[.!?]\s*$/.test(prev)) continue;

    // Must have at least 2 chars to be interesting
    if (cleaned.length < 2) continue;

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Technical-term extraction
// ---------------------------------------------------------------------------

/**
 * Extract camelCase, ALLCAPS (3+ chars), hyphenated-terms, and dotted.notation
 * tokens from text.
 */
export function extractTechnicalTerms(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const addUnique = (term: string) => {
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(term);
    }
  };

  // Tokenise on whitespace
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(/^[()[\]"']+|[()[\]"']+$/g, ""));

  for (const token of tokens) {
    if (!token) continue;
    const cleaned = token.replace(/[,;:!?]+$/, "");

    // ALL_CAPS or ALLCAPS (at least 3 chars, may contain underscores)
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(cleaned)) {
      addUnique(cleaned);
      continue;
    }

    // camelCase or PascalCase (lowercase followed by uppercase somewhere)
    if (/[a-z][A-Z]/.test(cleaned) && /^[A-Za-z][A-Za-z0-9]*$/.test(cleaned)) {
      addUnique(cleaned);
      continue;
    }

    // dotted.notation (e.g. config.yaml, System.IO)
    if (
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.]+$/.test(cleaned) &&
      cleaned.includes(".")
    ) {
      addUnique(cleaned);
      continue;
    }

    // hyphenated-term with at least one letter on each side
    if (/^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)+$/.test(cleaned)) {
      addUnique(cleaned);
      continue;
    }

    // SCREAMING_SNAKE (already caught by ALLCAPS rule above, but be explicit)
    if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(cleaned)) {
      addUnique(cleaned);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

/** Extract useful terms from clipboard text. */
export function buildContextFromClipboard(clipboardText: string): string[] {
  if (!clipboardText.trim()) return [];
  const nouns = extractProperNouns(clipboardText);
  const tech = extractTechnicalTerms(clipboardText);
  return deduplicateTerms([...nouns, ...tech]);
}

/** Extract recurring proper nouns from the last N transcripts. */
export function buildContextFromHistory(recentTranscripts: string[]): string[] {
  const last5 = recentTranscripts.slice(-5);
  if (last5.length === 0) return [];

  // Count occurrences across transcripts (not within a single one)
  const counts = new Map<string, { term: string; count: number }>();

  for (const transcript of last5) {
    const nouns = extractProperNouns(transcript);
    const tech = extractTechnicalTerms(transcript);
    const unique = deduplicateTerms([...nouns, ...tech]);
    for (const term of unique) {
      const key = term.toLowerCase();
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, { term, count: 1 });
      }
    }
  }

  // Return terms that appear in at least 2 transcripts (recurring), or all if <= 2 transcripts
  const minCount = last5.length <= 2 ? 1 : 2;
  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .map((e) => e.term);
}

// ---------------------------------------------------------------------------
// Merge & dedup helpers
// ---------------------------------------------------------------------------

function deduplicateTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of terms) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}

/**
 * Combine context terms with dictionary replacements, deduplicate, and cap
 * the list at `limit` terms (default 50).
 */
export function mergeContextWithDictionary(
  contextTerms: string[],
  dictionary: DictionaryEntry[],
  limit = 50,
): string[] {
  const dictTerms = dictionary.map((e) => e.replacement);
  const merged = deduplicateTerms([...dictTerms, ...contextTerms]);
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Whisper initial_prompt builder
// ---------------------------------------------------------------------------

/**
 * Rough token count: Whisper tokenises mostly on whitespace / punctuation.
 * For the initial_prompt we simply count comma-separated items plus a small
 * overhead. Each term ~1-3 tokens; we cap at ~200 tokens worth.
 */
const MAX_PROMPT_TERMS = 60;
const MAX_PROMPT_CHARS = 800; // ~200 tokens at ~4 chars/token

/**
 * Build an initial_prompt string for Whisper that biases transcription toward
 * the proper nouns, technical terms, and names found in the current context.
 */
export function buildWhisperPrompt(context: SpellingContext): string {
  const clipTerms = context.clipboardText
    ? buildContextFromClipboard(context.clipboardText)
    : [];
  const histTerms = buildContextFromHistory(context.recentTranscripts);
  const allTerms = mergeContextWithDictionary(
    deduplicateTerms([...clipTerms, ...histTerms, ...context.customTerms]),
    context.dictionaryEntries,
  );

  // Limit to MAX_PROMPT_TERMS
  const capped = allTerms.slice(0, MAX_PROMPT_TERMS);

  // Build comma-separated prompt, trimming if it exceeds character budget
  let prompt = capped.join(", ");
  if (prompt.length > MAX_PROMPT_CHARS) {
    // Truncate term-by-term until within budget
    const trimmed: string[] = [];
    let length = 0;
    for (const term of capped) {
      const addition = trimmed.length > 0 ? term.length + 2 : term.length; // ", " separator
      if (length + addition > MAX_PROMPT_CHARS) break;
      trimmed.push(term);
      length += addition;
    }
    prompt = trimmed.join(", ");
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Post-hoc context corrections
// ---------------------------------------------------------------------------

/**
 * Apply context-aware spelling corrections to a transcript.
 * For each word in the transcript, check if it fuzzy-matches a known term
 * (from dictionary or context). If so, replace it.
 */
export function applyContextCorrections(
  transcript: string,
  context: SpellingContext,
): { text: string; corrections: SpellingCorrection[] } {
  const corrections: SpellingCorrection[] = [];
  if (!transcript.trim()) return { text: transcript, corrections };

  // Build candidate lists
  const dictReplacements = context.dictionaryEntries.map((e) => e.replacement);
  const clipTerms = context.clipboardText
    ? buildContextFromClipboard(context.clipboardText)
    : [];
  const histTerms = buildContextFromHistory(context.recentTranscripts);
  const allCandidates = deduplicateTerms([
    ...dictReplacements,
    ...clipTerms,
    ...histTerms,
    ...context.customTerms,
  ]);

  if (allCandidates.length === 0) return { text: transcript, corrections };

  // Build a lookup from dictionary spoken -> replacement for source tagging
  const dictMap = new Map<string, string>();
  for (const entry of context.dictionaryEntries) {
    dictMap.set(entry.replacement.toLowerCase(), "dictionary");
  }

  // Split on word boundaries, preserving whitespace and punctuation
  const parts = transcript.split(/(\s+|[,.!?;:()[\]"'])/);
  const result: string[] = [];

  for (const part of parts) {
    // Only try to correct actual words (2+ alpha chars)
    if (!/^[A-Za-zÀ-ɏ]{2,}$/.test(part)) {
      result.push(part);
      continue;
    }

    const match = fuzzyMatch(part, allCandidates, 2);
    if (match && match.toLowerCase() !== part.toLowerCase()) {
      const source: SpellingCorrection["source"] = dictMap.has(
        match.toLowerCase(),
      )
        ? "dictionary"
        : "context";
      corrections.push({ original: part, corrected: match, source });
      result.push(match);
    } else {
      result.push(part);
    }
  }

  return { text: result.join(""), corrections };
}
