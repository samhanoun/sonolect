import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  levenshteinDistance,
  extractProperNouns,
  extractTechnicalTerms,
  buildWhisperPrompt,
  fuzzyMatch,
  normalizeForComparison,
} from "./contextSpelling";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(levenshteinDistance("hello", "hello"), 0);
  });

  it("returns correct distance for known pairs", () => {
    assert.equal(levenshteinDistance("kitten", "sitting"), 3);
    assert.equal(levenshteinDistance("saturday", "sunday"), 3);
    assert.equal(levenshteinDistance("", "abc"), 3);
    assert.equal(levenshteinDistance("abc", ""), 3);
  });

  it("returns length of other string when one is empty", () => {
    assert.equal(levenshteinDistance("", ""), 0);
    assert.equal(levenshteinDistance("test", ""), 4);
  });
});

describe("extractProperNouns", () => {
  it("extracts multi-word capitalized names", () => {
    const result = extractProperNouns(
      "I met John Smith in New York last week.",
    );
    assert.ok(result.includes("John Smith"));
    assert.ok(result.includes("New York"));
  });

  it("returns empty array for text with no proper nouns", () => {
    const result = extractProperNouns("this is all lowercase text");
    assert.deepEqual(result, []);
  });

  it("deduplicates repeated names", () => {
    const result = extractProperNouns("John Smith met John Smith at the park.");
    assert.equal(result.filter((n) => n === "John Smith").length, 1);
  });
});

describe("extractTechnicalTerms", () => {
  it("finds camelCase terms", () => {
    const result = extractTechnicalTerms("use camelCase for variables");
    assert.ok(result.includes("camelCase"));
  });

  it("finds SCREAMING_SNAKE_CASE terms", () => {
    const result = extractTechnicalTerms("set the API_KEY variable");
    assert.ok(result.includes("API_KEY"));
  });

  it("finds dot.notation terms", () => {
    const result = extractTechnicalTerms("call react.useState for state");
    assert.ok(result.includes("react.useState"));
  });

  it("finds PascalCase terms", () => {
    const result = extractTechnicalTerms("the MyComponent renders");
    assert.ok(result.includes("MyComponent"));
  });

  it("returns empty array for plain text", () => {
    const result = extractTechnicalTerms("no special terms here");
    assert.deepEqual(result, []);
  });
});

describe("buildWhisperPrompt", () => {
  it("builds comma-separated prompt from terms", () => {
    const result = buildWhisperPrompt({
      properNouns: ["John Smith"],
      technicalTerms: ["useState"],
      customTerms: ["Sonolect"],
    });
    assert.ok(result.includes("John Smith"));
    assert.ok(result.includes("useState"));
    assert.ok(result.includes("Sonolect"));
  });

  it("stays under 800 characters", () => {
    const longTerms = Array.from(
      { length: 500 },
      (_, i) => `LongTermNumber${i}`,
    );
    const result = buildWhisperPrompt({ customTerms: longTerms });
    assert.ok(result.length <= 800);
  });

  it("returns empty string for empty input", () => {
    const result = buildWhisperPrompt({});
    assert.equal(result, "");
  });

  it("deduplicates terms across categories", () => {
    const result = buildWhisperPrompt({
      properNouns: ["React"],
      customTerms: ["React"],
    });
    const count = result.split("React").length - 1;
    assert.equal(count, 1);
  });
});

describe("fuzzyMatch", () => {
  it("returns exact match", () => {
    const result = fuzzyMatch("hello", ["hello", "world", "help"]);
    assert.equal(result, "hello");
  });

  it("returns best match within threshold", () => {
    const result = fuzzyMatch("helo", ["hello", "world", "help"]);
    assert.equal(result, "hello");
  });

  it("returns null when no match within threshold", () => {
    const result = fuzzyMatch("xyz", ["hello", "world"], 0.1);
    assert.equal(result, null);
  });

  it("returns null for empty candidates", () => {
    const result = fuzzyMatch("hello", []);
    assert.equal(result, null);
  });

  it("is case-insensitive", () => {
    const result = fuzzyMatch("HELLO", ["hello", "world"]);
    assert.equal(result, "hello");
  });

  it("is accent-insensitive", () => {
    const result = fuzzyMatch("cafe", ["café", "world"]);
    assert.equal(result, "café");
  });
});

describe("normalizeForComparison", () => {
  it("lowercases text", () => {
    assert.equal(normalizeForComparison("HELLO"), "hello");
  });

  it("strips accents", () => {
    assert.equal(normalizeForComparison("café"), "cafe");
    assert.equal(normalizeForComparison("élève"), "eleve");
  });

  it("handles combined case and accents", () => {
    assert.equal(normalizeForComparison("Résumé"), "resume");
  });
});
