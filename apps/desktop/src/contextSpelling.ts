export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] =
          1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }

  return dp[m]![n]!;
}

export function extractProperNouns(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

export function extractTechnicalTerms(text: string): string[] {
  const terms = new Set<string>();

  const camelOrPascal = text.match(
    /\b[a-z]+[A-Z][a-zA-Z]*\b|\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g,
  );
  if (camelOrPascal) camelOrPascal.forEach((t) => terms.add(t));

  const screamingSnake = text.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g);
  if (screamingSnake) screamingSnake.forEach((t) => terms.add(t));

  const dotNotation = text.match(/\b[a-zA-Z]+\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g);
  if (dotNotation) dotNotation.forEach((t) => terms.add(t));

  return [...terms];
}

export function buildWhisperPrompt(context: {
  properNouns?: string[];
  technicalTerms?: string[];
  customTerms?: string[];
}): string {
  const allTerms: string[] = [];

  if (context.properNouns) allTerms.push(...context.properNouns);
  if (context.technicalTerms) allTerms.push(...context.technicalTerms);
  if (context.customTerms) allTerms.push(...context.customTerms);

  const unique = [...new Set(allTerms)];
  const result: string[] = [];
  let length = 0;

  for (const term of unique) {
    const addition = result.length === 0 ? term.length : term.length + 2;
    if (length + addition > 800) break;
    result.push(term);
    length += addition;
  }

  return result.join(", ");
}

export function normalizeForComparison(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function fuzzyMatch(
  input: string,
  candidates: string[],
  threshold?: number,
): string | null {
  if (candidates.length === 0) return null;

  const normalizedInput = normalizeForComparison(input);
  let bestCandidate: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForComparison(candidate);
    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  const maxLen = Math.max(
    normalizedInput.length,
    normalizeForComparison(bestCandidate!).length,
  );
  const effectiveThreshold = threshold ?? 0.3;
  const maxAllowed = Math.floor(maxLen * effectiveThreshold);

  if (bestDistance <= maxAllowed) return bestCandidate;
  return null;
}
