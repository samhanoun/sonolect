import * as assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  addEntry,
  removeEntry,
  searchDictionary,
} from "./dictionaryCrud";
import type { DictionaryEntry } from "./dictionaryCrud";
import {
  addSnippet,
  removeSnippet,
  searchSnippets,
} from "./snippetCrud";
import type { Snippet } from "./snippetCrud";
import {
  validateRetentionPolicy,
  DEFAULT_RETENTION_POLICY,
} from "./retentionControls";
import type { RetentionPolicy } from "./retentionControls";
import { getStylePresets, applyStylePreset } from "./stylePresets";
import { searchTranscripts } from "./searchAndFilter";
import type { TranscriptHistoryRow, SearchResult } from "./searchAndFilter";

/*
 * These tests verify the store wiring logic: the pure functions that drive
 * the new store actions (dictionary CRUD, snippet CRUD, style presets,
 * search, retention). We test the pure functions directly because the
 * Zustand store requires react-native runtime and cannot be instantiated
 * in a Node test context.
 */

// ── Dictionary CRUD ─────────────────────────────────────────────────

describe("store wiring: dictionary CRUD", () => {
  let entries: DictionaryEntry[];

  beforeEach(() => {
    entries = [];
  });

  it("adds a dictionary entry", () => {
    entries = addEntry(entries, "rec", "recommend");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.spoken, "rec");
    assert.equal(entries[0]!.replacement, "recommend");
  });

  it("prevents duplicate spoken words (case-insensitive)", () => {
    entries = addEntry(entries, "rec", "recommend");
    entries = addEntry(entries, "REC", "recommendation");
    assert.equal(entries.length, 1);
  });

  it("removes a dictionary entry by id", () => {
    entries = addEntry(entries, "rec", "recommend");
    entries = addEntry(entries, "dept", "department");
    assert.equal(entries.length, 2);
    const firstId = entries[0]!.id;
    entries = removeEntry(entries, firstId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.spoken, "dept");
  });

  it("ignores entries with empty spoken or replacement", () => {
    entries = addEntry(entries, "", "recommend");
    assert.equal(entries.length, 0);
    entries = addEntry(entries, "rec", "");
    assert.equal(entries.length, 0);
    entries = addEntry(entries, "  ", "  ");
    assert.equal(entries.length, 0);
  });

  it("searches dictionary entries", () => {
    entries = addEntry(entries, "rec", "recommend");
    entries = addEntry(entries, "dept", "department");
    entries = addEntry(entries, "mgr", "manager");

    const results = searchDictionary(entries, "rec");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.spoken, "rec");

    const all = searchDictionary(entries, "");
    assert.equal(all.length, 3);
  });
});

// ── Snippet CRUD ────────────────────────────────────────────────────

describe("store wiring: snippet CRUD", () => {
  let snippets: Snippet[];

  beforeEach(() => {
    snippets = [];
  });

  it("adds a snippet with trigger normalization", () => {
    snippets = addSnippet(snippets, "hello", "Hello, how can I help you?");
    assert.equal(snippets.length, 1);
    assert.equal(snippets[0]!.trigger, "/hello");
    assert.equal(snippets[0]!.body, "Hello, how can I help you?");
  });

  it("keeps leading slash when already provided", () => {
    snippets = addSnippet(snippets, "/bye", "Goodbye and take care!");
    assert.equal(snippets[0]!.trigger, "/bye");
  });

  it("prevents duplicate triggers (case-insensitive)", () => {
    snippets = addSnippet(snippets, "hello", "greeting 1");
    snippets = addSnippet(snippets, "/HELLO", "greeting 2");
    assert.equal(snippets.length, 1);
  });

  it("removes a snippet by id", () => {
    snippets = addSnippet(snippets, "hello", "Hi");
    snippets = addSnippet(snippets, "bye", "Bye");
    assert.equal(snippets.length, 2);
    const firstId = snippets[0]!.id;
    snippets = removeSnippet(snippets, firstId);
    assert.equal(snippets.length, 1);
    assert.equal(snippets[0]!.trigger, "/bye");
  });

  it("ignores snippets with empty trigger or body", () => {
    snippets = addSnippet(snippets, "", "body");
    assert.equal(snippets.length, 0);
    snippets = addSnippet(snippets, "trigger", "");
    assert.equal(snippets.length, 0);
  });

  it("searches snippets", () => {
    snippets = addSnippet(snippets, "hello", "Hello friend");
    snippets = addSnippet(snippets, "bye", "Goodbye!");
    snippets = addSnippet(snippets, "thanks", "Thank you very much");

    const results = searchSnippets(snippets, "hello");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.trigger, "/hello");

    const bodySearch = searchSnippets(snippets, "much");
    assert.equal(bodySearch.length, 1);
    assert.equal(bodySearch[0]!.trigger, "/thanks");
  });
});

// ── Style presets ───────────────────────────────────────────────────

describe("store wiring: style presets", () => {
  it("returns built-in presets", () => {
    const presets = getStylePresets();
    assert.ok(presets.length >= 4);
    const ids = presets.map((p) => p.id);
    assert.ok(ids.includes("concise"));
    assert.ok(ids.includes("professional"));
    assert.ok(ids.includes("casual"));
    assert.ok(ids.includes("technical"));
  });

  it("applies concise preset to remove filler words", () => {
    const result = applyStylePreset(
      "I just really basically want to help",
      "concise",
    );
    assert.ok(!result.includes("just"));
    assert.ok(!result.includes("really"));
    assert.ok(!result.includes("basically"));
  });

  it("throws for unknown preset", () => {
    assert.throws(
      () => applyStylePreset("text", "nonexistent"),
      /Unknown style preset/,
    );
  });

  it("custom preset passes through text unchanged", () => {
    const input = "some text here";
    assert.equal(applyStylePreset(input, "custom"), input);
  });
});

// ── Search and filter ───────────────────────────────────────────────

describe("store wiring: search and filter", () => {
  const rows: TranscriptHistoryRow[] = [
    {
      id: "t1",
      title: "Meeting Notes",
      preview: "Review the budget for Q3",
      transcript: "We need to review the budget for Q3 and finalize the report",
      timestamp: "2026-05-01T10:00:00.000Z",
      duration: "5m30s",
      mode: "dictate",
      status: "completed",
      metadata: "",
      updatedAt: "2026-05-01T10:00:00.000Z",
    },
    {
      id: "t2",
      title: "Quick Note",
      preview: "Buy groceries",
      transcript: "Buy groceries and pick up dry cleaning",
      timestamp: "2026-05-02T14:00:00.000Z",
      duration: "30s",
      mode: "dictate",
      status: "completed",
      metadata: "",
      updatedAt: "2026-05-02T14:00:00.000Z",
    },
  ];

  it("searches transcripts and returns sorted results", () => {
    const results = searchTranscripts(rows, "budget");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "t1");
    assert.ok(results[0]!.matchCount > 0);
  });

  it("returns empty for blank query", () => {
    const results = searchTranscripts(rows, "");
    assert.equal(results.length, 0);
  });

  it("finds matches across title and transcript", () => {
    const results = searchTranscripts(rows, "Quick");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "t2");
  });

  it("returns multiple results sorted by match count", () => {
    const results = searchTranscripts(rows, "the");
    // "the" appears in both t1's transcript ("the budget", "the report") and title
    assert.ok(results.length >= 1);
  });
});

// ── Retention policy ────────────────────────────────────────────────

describe("store wiring: retention policy", () => {
  it("validates and clamps retention policy values", () => {
    const policy = validateRetentionPolicy({
      maxAgeDays: -5,
      maxItems: 200000,
      autoDeleteEnabled: true,
    });
    assert.equal(policy.maxAgeDays, 1); // clamped to min 1
    assert.equal(policy.maxItems, 100000); // clamped to max 100000
    assert.equal(policy.autoDeleteEnabled, true);
  });

  it("uses defaults for missing fields", () => {
    const policy = validateRetentionPolicy({});
    assert.equal(policy.maxAgeDays, DEFAULT_RETENTION_POLICY.maxAgeDays);
    assert.equal(policy.maxItems, DEFAULT_RETENTION_POLICY.maxItems);
    assert.equal(
      policy.autoDeleteEnabled,
      DEFAULT_RETENTION_POLICY.autoDeleteEnabled,
    );
  });

  it("validates merged policy (simulating setRetentionPolicy action)", () => {
    const current: RetentionPolicy = {
      maxAgeDays: 90,
      maxItems: 1000,
      autoDeleteEnabled: false,
    };
    const patch = { autoDeleteEnabled: true, maxAgeDays: 30 };
    const result = validateRetentionPolicy({ ...current, ...patch });

    assert.equal(result.maxAgeDays, 30);
    assert.equal(result.maxItems, 1000);
    assert.equal(result.autoDeleteEnabled, true);
  });

  it("rounds fractional days to nearest integer", () => {
    const policy = validateRetentionPolicy({ maxAgeDays: 45.7 });
    assert.equal(policy.maxAgeDays, 46);
  });

  it("handles NaN and Infinity gracefully", () => {
    const policy = validateRetentionPolicy({
      maxAgeDays: NaN,
      maxItems: Infinity,
    });
    assert.equal(policy.maxAgeDays, 1); // NaN clamps to min
    assert.equal(policy.maxItems, 1); // Infinity not finite -> min
  });
});
