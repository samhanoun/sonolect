export type DiffChange = {
  type: "added" | "removed" | "unchanged";
  text: string;
};

export type PolishDiff = {
  original: string;
  polished: string;
  changes: DiffChange[];
};

/**
 * Simple word-level diff: split both strings into words, find longest common
 * subsequence, then mark words as added/removed/unchanged.
 */
export function computePolishDiff(original: string, polished: string): PolishDiff {
  const origWords = original.split(/\s+/).filter(Boolean);
  const polWords = polished.split(/\s+/).filter(Boolean);

  const lcs = longestCommonSubsequence(origWords, polWords);

  const changes: DiffChange[] = [];
  let oi = 0;
  let pi = 0;
  let li = 0;

  while (oi < origWords.length || pi < polWords.length) {
    if (
      li < lcs.length &&
      oi < origWords.length &&
      pi < polWords.length &&
      origWords[oi] === lcs[li] &&
      polWords[pi] === lcs[li]
    ) {
      // Unchanged word
      pushChange(changes, "unchanged", lcs[li]!);
      oi++;
      pi++;
      li++;
    } else if (li >= lcs.length || oi >= origWords.length || origWords[oi] !== lcs[li]) {
      // Check if current polished word is in LCS
      if (
        li < lcs.length &&
        pi < polWords.length &&
        polWords[pi] !== lcs[li]
      ) {
        // Both sides differ from LCS — remove from original, add from polished
        pushChange(changes, "removed", origWords[oi]!);
        oi++;
      } else if (pi < polWords.length && (li >= lcs.length || polWords[pi] !== lcs[li])) {
        pushChange(changes, "added", polWords[pi]!);
        pi++;
      } else if (oi < origWords.length) {
        pushChange(changes, "removed", origWords[oi]!);
        oi++;
      } else {
        pushChange(changes, "added", polWords[pi]!);
        pi++;
      }
    } else {
      // polished side has extra words before next LCS match
      pushChange(changes, "added", polWords[pi]!);
      pi++;
    }
  }

  return { original, polished, changes };
}

function pushChange(changes: DiffChange[], type: DiffChange["type"], word: string): void {
  const last = changes[changes.length - 1];
  if (last && last.type === type) {
    last.text += ` ${word}`;
  } else {
    changes.push({ type, text: word });
  }
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find the actual subsequence
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

export function countChanges(diff: PolishDiff): {
  added: number;
  removed: number;
  unchanged: number;
} {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const change of diff.changes) {
    const wordCount = change.text.split(/\s+/).filter(Boolean).length;
    switch (change.type) {
      case "added":
        added += wordCount;
        break;
      case "removed":
        removed += wordCount;
        break;
      case "unchanged":
        unchanged += wordCount;
        break;
    }
  }

  return { added, removed, unchanged };
}

export function formatDiffSummary(diff: PolishDiff): string {
  const counts = countChanges(diff);
  const parts: string[] = [];

  if (counts.removed > 0) {
    parts.push(
      `Removed ${counts.removed} ${counts.removed === 1 ? "word" : "words"}`,
    );
  }
  if (counts.added > 0) {
    parts.push(
      `Added ${counts.added} ${counts.added === 1 ? "word" : "words"}`,
    );
  }
  if (parts.length === 0) {
    return "No changes";
  }
  return parts.join(", ");
}
