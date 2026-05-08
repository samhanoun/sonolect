import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  searchTranscripts,
  filterHistory,
  highlightMatches,
  sortResults,
} from "./searchAndFilter";
import type { TranscriptHistoryRow, SearchResult } from "./searchAndFilter";

const sampleHistory: TranscriptHistoryRow[] = [
  {
    id: "s1",
    title: "Meeting notes with investors",
    preview: "Discussed traction metrics and growth plan.",
    transcript:
      "Discussed traction metrics and growth plan. Revenue doubled last quarter.",
    timestamp: "Today · 09:42",
    duration: "2m 18s",
    mode: "summarize",
    status: "actioned",
    metadata: "summarize",
    updatedAt: "2026-05-02T09:42:00.000Z",
  },
  {
    id: "s2",
    title: "Client response",
    preview: "Professional reply to urgent request.",
    transcript:
      "Professional reply to urgent request. The traction data is available.",
    timestamp: "Yesterday · 18:07",
    duration: "48s",
    mode: "reply",
    status: "synced",
    metadata: "reply",
    updatedAt: "2026-05-01T18:07:00.000Z",
  },
  {
    id: "s3",
    title: "Desktop roadmap ideas",
    preview: "Command palette, overlay, privacy mode.",
    transcript: "Command palette, overlay, privacy mode and agentic actions.",
    timestamp: "Monday · 14:16",
    duration: "3m 04s",
    mode: "task_creation",
    status: "draft",
    metadata: "task_creation",
    updatedAt: "2026-04-28T14:16:00.000Z",
  },
];

describe("searchAndFilter", () => {
  // ── searchTranscripts ──────────────────────────────────────────
  describe("searchTranscripts", () => {
    it("finds matches in transcript text", () => {
      const results = searchTranscripts(sampleHistory, "traction");
      assert.strictEqual(results.length, 2);
    });

    it("finds matches in titles", () => {
      const results = searchTranscripts(sampleHistory, "investors");
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]!.id, "s1");
    });

    it("returns empty for no matches", () => {
      const results = searchTranscripts(sampleHistory, "zzznomatch");
      assert.strictEqual(results.length, 0);
    });

    it("returns empty for empty query", () => {
      const results = searchTranscripts(sampleHistory, "");
      assert.strictEqual(results.length, 0);
    });

    it("is case-insensitive", () => {
      const results = searchTranscripts(sampleHistory, "TRACTION");
      assert.ok(results.length >= 1);
    });

    it("results include matchCount and highlightRanges", () => {
      const results = searchTranscripts(sampleHistory, "traction");
      for (const r of results) {
        assert.ok(r.matchCount >= 1);
        assert.ok(Array.isArray(r.highlightRanges));
      }
    });

    it("sorts by relevance (highest matchCount first)", () => {
      const results = searchTranscripts(sampleHistory, "traction");
      if (results.length >= 2) {
        assert.ok(results[0]!.matchCount >= results[1]!.matchCount);
      }
    });
  });

  // ── filterHistory ──────────────────────────────────────────────
  describe("filterHistory", () => {
    it("filters by query across title and transcript", () => {
      const filtered = filterHistory(sampleHistory, { query: "roadmap" });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.id, "s3");
    });

    it("filters by dateFrom", () => {
      const filtered = filterHistory(sampleHistory, {
        dateFrom: "2026-05-01T00:00:00.000Z",
      });
      assert.strictEqual(filtered.length, 2);
    });

    it("filters by dateTo", () => {
      const filtered = filterHistory(sampleHistory, {
        dateTo: "2026-04-30T00:00:00.000Z",
      });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.id, "s3");
    });

    it("filters by date range", () => {
      const filtered = filterHistory(sampleHistory, {
        dateFrom: "2026-04-29T00:00:00.000Z",
        dateTo: "2026-05-01T20:00:00.000Z",
      });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.id, "s2");
    });

    it("filters by minDuration", () => {
      const filtered = filterHistory(sampleHistory, {
        minDuration: 120_000,
      });
      assert.strictEqual(filtered.length, 2);
      assert.ok(filtered.every((r) => r.id !== "s2"));
    });

    it("returns all when filter is empty", () => {
      const filtered = filterHistory(sampleHistory, {});
      assert.strictEqual(filtered.length, sampleHistory.length);
    });

    it("combines multiple filters", () => {
      const filtered = filterHistory(sampleHistory, {
        query: "traction",
        dateFrom: "2026-05-02T00:00:00.000Z",
      });
      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0]!.id, "s1");
    });
  });

  // ── highlightMatches ───────────────────────────────────────────
  describe("highlightMatches", () => {
    it("wraps matches in ** markers", () => {
      const result = highlightMatches("Hello world", "world");
      assert.strictEqual(result, "Hello **world**");
    });

    it("is case-insensitive but preserves original case", () => {
      const result = highlightMatches("Hello World", "hello");
      assert.strictEqual(result, "**Hello** World");
    });

    it("highlights multiple occurrences", () => {
      const result = highlightMatches("test and test again", "test");
      assert.strictEqual(result, "**test** and **test** again");
    });

    it("returns original text when no match", () => {
      const result = highlightMatches("Hello world", "zzz");
      assert.strictEqual(result, "Hello world");
    });

    it("returns original text for empty query", () => {
      const result = highlightMatches("Hello world", "");
      assert.strictEqual(result, "Hello world");
    });
  });

  // ── sortResults ────────────────────────────────────────────────
  describe("sortResults", () => {
    const results: SearchResult[] = [
      {
        id: "a",
        title: "Alpha",
        snippet: "...",
        matchCount: 1,
        highlightRanges: [],
      },
      {
        id: "b",
        title: "Bravo",
        snippet: "...",
        matchCount: 5,
        highlightRanges: [],
      },
      {
        id: "c",
        title: "Charlie",
        snippet: "...",
        matchCount: 3,
        highlightRanges: [],
      },
    ];

    it("sorts by relevance (matchCount descending)", () => {
      const sorted = sortResults(results, "relevance");
      assert.strictEqual(sorted[0]!.id, "b");
      assert.strictEqual(sorted[1]!.id, "c");
      assert.strictEqual(sorted[2]!.id, "a");
    });

    it("does not mutate the original array", () => {
      const original = [...results];
      sortResults(results, "relevance");
      assert.deepStrictEqual(results, original);
    });
  });
});
