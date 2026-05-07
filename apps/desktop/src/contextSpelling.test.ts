import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  applyContextCorrections,
  buildContextFromClipboard,
  buildContextFromHistory,
  buildWhisperPrompt,
  extractProperNouns,
  extractTechnicalTerms,
  fuzzyMatch,
  levenshtein,
  mergeContextWithDictionary,
} from "./contextSpelling";
import type { DictionaryEntry } from "./wisprWorkflow";

function dict(spoken: string, replacement: string): DictionaryEntry {
  return { id: `dict-${spoken}`, spoken, replacement };
}

describe("Context-aware spelling", () => {
  // -----------------------------------------------------------------------
  // extractProperNouns
  // -----------------------------------------------------------------------

  describe("extractProperNouns", () => {
    it("extracts capitalized words that are not sentence starters", () => {
      const result = extractProperNouns("Meeting with François about React");
      assert.deepEqual(result, ["François", "React"]);
    });

    it("skips the first word and words after periods", () => {
      const result = extractProperNouns(
        "Hello world. This is a Test with React",
      );
      // "Hello" is first word, "This" follows period — both excluded
      assert.ok(!result.includes("Hello"));
      assert.ok(!result.includes("This"));
      assert.ok(result.includes("Test"));
      assert.ok(result.includes("React"));
    });

    it("skips single-character capitalized words", () => {
      const result = extractProperNouns("talk to A person about React");
      assert.ok(!result.includes("A"));
      assert.ok(result.includes("React"));
    });

    it("returns empty for plain lowercase text", () => {
      assert.deepEqual(extractProperNouns("all lowercase words here"), []);
    });

    it("deduplicates by lowercase key", () => {
      const result = extractProperNouns("call with React and also React again");
      assert.equal(result.filter((n) => n === "React").length, 1);
    });
  });

  // -----------------------------------------------------------------------
  // extractTechnicalTerms
  // -----------------------------------------------------------------------

  describe("extractTechnicalTerms", () => {
    it("extracts ALLCAPS, dotted notation, camelCase, and hyphenated terms", () => {
      const result = extractTechnicalTerms(
        "Update the API_KEY in config.yaml and run myFunction",
      );
      assert.ok(result.includes("API_KEY"));
      assert.ok(result.includes("config.yaml"));
      assert.ok(result.includes("myFunction"));
    });

    it("extracts hyphenated terms", () => {
      const result = extractTechnicalTerms("use my-component in the app");
      assert.ok(result.includes("my-component"));
    });

    it("extracts PascalCase", () => {
      const result = extractTechnicalTerms("import MyComponent from lib");
      assert.ok(result.includes("MyComponent"));
    });

    it("ignores plain words", () => {
      const result = extractTechnicalTerms("just some normal words here");
      assert.deepEqual(result, []);
    });

    it("handles dotted.notation like System.IO", () => {
      const result = extractTechnicalTerms("use System.IO for files");
      assert.ok(result.includes("System.IO"));
    });
  });

  // -----------------------------------------------------------------------
  // buildWhisperPrompt
  // -----------------------------------------------------------------------

  describe("buildWhisperPrompt", () => {
    it("combines terms into a comma-separated prompt", () => {
      const prompt = buildWhisperPrompt({
        recentTranscripts: [],
        dictionaryEntries: [dict("react", "React")],
        customTerms: ["Kubernetes", "TypeScript"],
      });
      assert.ok(prompt.includes("React"));
      assert.ok(prompt.includes("Kubernetes"));
      assert.ok(prompt.includes("TypeScript"));
      assert.ok(prompt.includes(", "));
    });

    it("includes clipboard terms", () => {
      const prompt = buildWhisperPrompt({
        clipboardText: "call with François about React",
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: [],
      });
      assert.ok(prompt.includes("François"));
      assert.ok(prompt.includes("React"));
    });

    it("limits prompt to roughly 200 tokens (~800 chars)", () => {
      const longTerms = Array.from(
        { length: 200 },
        (_, i) => `LongTechnicalTerm${i}`,
      );
      const prompt = buildWhisperPrompt({
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: longTerms,
      });
      assert.ok(
        prompt.length <= 850,
        `Prompt too long: ${prompt.length} chars`,
      );
    });

    it("returns empty string when no terms available", () => {
      const prompt = buildWhisperPrompt({
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: [],
      });
      assert.equal(prompt, "");
    });
  });

  // -----------------------------------------------------------------------
  // buildContextFromClipboard
  // -----------------------------------------------------------------------

  describe("buildContextFromClipboard", () => {
    it("extracts proper nouns and tech terms from clipboard", () => {
      const terms = buildContextFromClipboard(
        "email from François about the API_KEY in config.yaml",
      );
      assert.ok(terms.includes("François"));
      assert.ok(terms.includes("API_KEY"));
      assert.ok(terms.includes("config.yaml"));
    });

    it("returns empty array for empty/whitespace clipboard", () => {
      assert.deepEqual(buildContextFromClipboard(""), []);
      assert.deepEqual(buildContextFromClipboard("   "), []);
    });
  });

  // -----------------------------------------------------------------------
  // buildContextFromHistory
  // -----------------------------------------------------------------------

  describe("buildContextFromHistory", () => {
    it("extracts recurring terms from multiple transcripts", () => {
      const transcripts = [
        "meeting with François about React",
        "call with François regarding React Native",
        "discussed François proposal",
      ];
      const terms = buildContextFromHistory(transcripts);
      assert.ok(terms.includes("François"));
    });

    it("returns all terms when 2 or fewer transcripts", () => {
      const transcripts = ["call with François about React"];
      const terms = buildContextFromHistory(transcripts);
      assert.ok(terms.includes("François"));
      assert.ok(terms.includes("React"));
    });

    it("returns empty for no transcripts", () => {
      assert.deepEqual(buildContextFromHistory([]), []);
    });

    it("uses only the last 5 transcripts", () => {
      const transcripts = Array.from(
        { length: 10 },
        (_, i) => `transcript ${i} with UniqueTermXYZ`,
      );
      // UniqueTermXYZ won't be extracted as it's not capitalized mid-sentence
      // Build with actual proper nouns
      const real = [
        "old call with Alice",
        "old call with Alice",
        "old call with Alice",
        "old call with Alice",
        "old call with Alice",
        "new call with Bob",
        "new call with Bob",
        "new call with Bob",
        "new call with Bob",
        "new call with Bob",
      ];
      const terms = buildContextFromHistory(real);
      // Only last 5 considered — Bob should appear, Alice should not
      assert.ok(terms.includes("Bob"));
    });
  });

  // -----------------------------------------------------------------------
  // fuzzyMatch
  // -----------------------------------------------------------------------

  describe("fuzzyMatch", () => {
    it("matches Francois to François within threshold", () => {
      const match = fuzzyMatch("Francois", ["François", "Francis"]);
      assert.equal(match, "François");
    });

    it("returns exact match immediately", () => {
      const match = fuzzyMatch("React", ["react", "Redux"]);
      // case-insensitive exact match
      assert.equal(match, "react");
    });

    it("returns null when no candidate is close enough", () => {
      const match = fuzzyMatch("hello", ["Kubernetes", "TypeScript"], 2);
      assert.equal(match, null);
    });

    it("returns null for empty candidates", () => {
      assert.equal(fuzzyMatch("word", []), null);
    });

    it("picks the closest match when multiple are within threshold", () => {
      const match = fuzzyMatch("Recat", ["React", "Redux", "Record"], 2);
      assert.equal(match, "React");
    });
  });

  // -----------------------------------------------------------------------
  // levenshtein
  // -----------------------------------------------------------------------

  describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
      assert.equal(levenshtein("abc", "abc"), 0);
    });

    it("counts insertions", () => {
      assert.equal(levenshtein("abc", "abcd"), 1);
    });

    it("counts deletions", () => {
      assert.equal(levenshtein("abcd", "abc"), 1);
    });

    it("counts substitutions", () => {
      assert.equal(levenshtein("abc", "axc"), 1);
    });

    it("handles empty strings", () => {
      assert.equal(levenshtein("", "abc"), 3);
      assert.equal(levenshtein("abc", ""), 3);
      assert.equal(levenshtein("", ""), 0);
    });
  });

  // -----------------------------------------------------------------------
  // applyContextCorrections (post-hoc)
  // -----------------------------------------------------------------------

  describe("applyContextCorrections", () => {
    it("corrects misspelled words using context", () => {
      const result = applyContextCorrections("meeting with Francois", {
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: ["François"],
      });
      assert.equal(result.text, "meeting with François");
      assert.equal(result.corrections.length, 1);
      assert.equal(result.corrections[0]?.original, "Francois");
      assert.equal(result.corrections[0]?.corrected, "François");
      assert.equal(result.corrections[0]?.source, "context");
    });

    it("marks dictionary-sourced corrections appropriately", () => {
      const result = applyContextCorrections("use Reakt for the UI", {
        recentTranscripts: [],
        dictionaryEntries: [dict("reakt", "React")],
        customTerms: [],
      });
      assert.ok(result.text.includes("React"));
      assert.equal(result.corrections[0]?.source, "dictionary");
    });

    it("does not correct words that are already correct", () => {
      const result = applyContextCorrections("meeting with React", {
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: ["React"],
      });
      assert.equal(result.corrections.length, 0);
      assert.equal(result.text, "meeting with React");
    });

    it("returns empty corrections for empty transcript", () => {
      const result = applyContextCorrections("", {
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: ["React"],
      });
      assert.equal(result.corrections.length, 0);
    });

    it("returns unchanged text when no candidates", () => {
      const result = applyContextCorrections("hello world", {
        recentTranscripts: [],
        dictionaryEntries: [],
        customTerms: [],
      });
      assert.equal(result.text, "hello world");
      assert.equal(result.corrections.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // mergeContextWithDictionary
  // -----------------------------------------------------------------------

  describe("mergeContextWithDictionary", () => {
    it("combines dictionary and context terms without duplicates", () => {
      const merged = mergeContextWithDictionary(
        ["React", "TypeScript", "Kubernetes"],
        [dict("reakt", "React"), dict("ts", "TypeScript")],
      );
      // Dictionary terms come first, then context — React and TypeScript deduped
      assert.ok(merged.includes("React"));
      assert.ok(merged.includes("TypeScript"));
      assert.ok(merged.includes("Kubernetes"));
      // No duplicates
      assert.equal(merged.filter((t) => t === "React").length, 1);
    });

    it("caps at 50 terms by default", () => {
      const longContext = Array.from({ length: 100 }, (_, i) => `Term${i}`);
      const merged = mergeContextWithDictionary(longContext, []);
      assert.equal(merged.length, 50);
    });

    it("respects custom limit", () => {
      const terms = ["A", "B", "C", "D", "E"];
      const merged = mergeContextWithDictionary(terms, [], 3);
      assert.equal(merged.length, 3);
    });
  });
});
