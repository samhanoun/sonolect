import { describe, it } from "node:test";
import assert from "node:assert/strict";

/*
 * UI Integration tests — verify that all new view components export
 * the expected symbols, and that the supporting modules compose correctly
 * for the store-level integrations wired in main.tsx.
 */

// ── View component exports ─────────────────────────────────────
describe("View component exports", () => {
  it("DictionaryView exports the named component", async () => {
    const mod = await import("./DictionaryView");
    assert.equal(typeof mod.DictionaryView, "function");
  });

  it("SnippetView exports the named component", async () => {
    const mod = await import("./SnippetView");
    assert.equal(typeof mod.SnippetView, "function");
  });

  it("OnboardingView exports the named component", async () => {
    const mod = await import("./OnboardingView");
    assert.equal(typeof mod.OnboardingView, "function");
  });

  it("SearchPanel exports the named component", async () => {
    const mod = await import("./SearchPanel");
    assert.equal(typeof mod.SearchPanel, "function");
  });

  it("StylePresetSelector exports the named component", async () => {
    const mod = await import("./StylePresetSelector");
    assert.equal(typeof mod.StylePresetSelector, "function");
  });

  it("RetentionSettings exports the named component", async () => {
    const mod = await import("./RetentionSettings");
    assert.equal(typeof mod.RetentionSettings, "function");
  });
});

// ── Style preset application updates polished preview ──────────
describe("Style preset integration", () => {
  it("applyStylePreset transforms text with a known preset", async () => {
    const { applyStylePreset, getStylePresets } =
      await import("./stylePresets");
    const presets = getStylePresets();
    assert.ok(presets.length > 0, "Should have at least one preset");

    const original = "I basically just really want to test this feature.";
    const concise = applyStylePreset(original, "concise");
    assert.ok(
      concise.length <= original.length,
      "Concise preset should not add length",
    );
    assert.ok(
      !concise.includes("basically"),
      "Concise preset should remove filler",
    );
  });

  it("polish diff detects changes after preset application", async () => {
    const { applyStylePreset } = await import("./stylePresets");
    const { computePolishDiff, formatDiffSummary, countChanges } =
      await import("./polishPreview");

    const original = "I basically just want to do this in order to test it.";
    const styled = applyStylePreset(original, "concise");
    const diff = computePolishDiff(original, styled);
    const summary = formatDiffSummary(diff);
    const counts = countChanges(diff);

    assert.ok(counts.removed > 0, "Should have removed words");
    assert.ok(summary.includes("Removed"), "Summary should mention removals");
  });
});

// ── Search returns results for matching queries ────────────────
describe("Search integration", () => {
  it("searchTranscripts returns results for known content", async () => {
    const { searchTranscripts, filterHistory, sortResults } =
      await import("./searchAndFilter");
    const history = [
      {
        id: "1",
        title: "Meeting notes",
        preview: "Discussed the roadmap",
        transcript: "We discussed the quarterly roadmap and priorities.",
        timestamp: "2026-05-01",
        duration: "5m 30s",
        mode: "dictate" as const,
        status: "synced" as const,
        metadata: "test",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "2",
        title: "Quick memo",
        preview: "Buy groceries",
        transcript: "Remember to buy groceries and pick up the dry cleaning.",
        timestamp: "2026-05-02",
        duration: "0m 15s",
        mode: "dictate" as const,
        status: "synced" as const,
        metadata: "test",
        updatedAt: "2026-05-02T14:00:00.000Z",
      },
    ];

    const results = searchTranscripts(history, "roadmap");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "1");

    const filtered = filterHistory(history, { query: "groceries" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.id, "2");

    const sorted = sortResults(results, "relevance");
    assert.equal(sorted.length, 1);
  });

  it("returns empty array for non-matching queries", async () => {
    const { searchTranscripts } = await import("./searchAndFilter");
    const results = searchTranscripts([], "anything");
    assert.equal(results.length, 0);
  });
});

// ── Retention policy loads/saves roundtrip ─────────────────────
describe("Retention policy roundtrip", () => {
  it("default policy has sensible values", async () => {
    const { DEFAULT_RETENTION_POLICY, loadRetentionPolicy } =
      await import("./retentionControls");
    assert.equal(DEFAULT_RETENTION_POLICY.maxAgeDays, 90);
    assert.equal(DEFAULT_RETENTION_POLICY.maxItems, 1000);
    assert.equal(DEFAULT_RETENTION_POLICY.autoDeleteEnabled, false);

    // loadRetentionPolicy should return defaults when no saved policy exists
    const loaded = loadRetentionPolicy();
    assert.equal(loaded.maxAgeDays, 90);
    assert.equal(loaded.maxItems, 1000);
    assert.equal(loaded.autoDeleteEnabled, false);
  });

  it("applyRetentionPolicy identifies expired items", async () => {
    const { applyRetentionPolicy } = await import("./retentionControls");
    const history = [
      {
        id: "old",
        title: "Old",
        preview: "",
        transcript: "old transcript",
        timestamp: "2020-01-01",
        duration: "1m 00s",
        mode: "dictate" as const,
        status: "synced" as const,
        metadata: "",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "new",
        title: "New",
        preview: "",
        transcript: "new transcript",
        timestamp: "2026-05-01",
        duration: "1m 00s",
        mode: "dictate" as const,
        status: "synced" as const,
        metadata: "",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];

    const result = applyRetentionPolicy(history, {
      maxAgeDays: 90,
      maxItems: 1000,
      autoDeleteEnabled: false,
    });

    assert.ok(result.freedItems.includes("old"), "Old item should be expired");
    assert.ok(
      !result.freedItems.includes("new"),
      "New item should not be expired",
    );
    assert.equal(result.removedCount, 1);
    assert.equal(result.remainingCount, 1);
  });
});

// ── Command registry integration ───────────────────────────────
describe("Command registry integration", () => {
  it("DEFAULT_COMMANDS contains 23 commands", async () => {
    const { DEFAULT_COMMANDS } = await import("./commandRegistry");
    assert.equal(DEFAULT_COMMANDS.length, 23);
  });

  it("searchCommands filters by label", async () => {
    const { DEFAULT_COMMANDS, searchCommands } =
      await import("./commandRegistry");
    const results = searchCommands(DEFAULT_COMMANDS, "dictionary");
    assert.ok(results.length >= 1);
    assert.ok(results.some((cmd) => cmd.id.includes("dictionary")));
  });
});

// ── Dictionary CRUD integration ────────────────────────────────
describe("Dictionary CRUD integration", () => {
  it("addEntry + searchDictionary roundtrip", async () => {
    const { addEntry, searchDictionary } = await import("./dictionaryCrud");

    let entries = addEntry([], "sonolect", "Sonolect");
    entries = addEntry(entries, "kubernetes", "Kubernetes");
    assert.equal(entries.length, 2);

    const found = searchDictionary(entries, "sono");
    assert.equal(found.length, 1);
    assert.equal(found[0]!.replacement, "Sonolect");
  });
});

// ── Snippet CRUD integration ───────────────────────────────────
describe("Snippet CRUD integration", () => {
  it("addSnippet + searchSnippets roundtrip", async () => {
    const { addSnippet, searchSnippets } = await import("./snippetCrud");

    let snippets = addSnippet([], "/sig", "Best, Ismail");
    snippets = addSnippet(snippets, "/addr", "123 Main St");
    assert.equal(snippets.length, 2);

    const found = searchSnippets(snippets, "ismail");
    assert.equal(found.length, 1);
    assert.equal(found[0]!.trigger, "/sig");
  });
});

// ── Onboarding wizard integration ──────────────────────────────
describe("Onboarding wizard integration", () => {
  it("wizard starts at first incomplete step", async () => {
    const { initWizardState, wizardProgress, isWizardFinished } =
      await import("./onboardingWizard");
    const state = initWizardState({
      micPermission: true,
      shortcutPrimer: false,
      whisperSetup: false,
      privacyChoice: false,
    });
    assert.equal(state.currentStepIndex, 1);
    assert.equal(wizardProgress(state).completed, 1);
    assert.equal(isWizardFinished(state), false);
  });
});
