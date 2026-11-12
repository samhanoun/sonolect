import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings, TranscriptTurn } from "./domain";
import { DEFAULT_SETTINGS, REFINEMENT_MODES } from "./domain";
import {
  apiConfigFor,
  availableRefinementModesFor,
  effectiveSettingsFor,
  phoneOnlyMigration,
} from "./features";
import { resolveMobileLocalApiConfig } from "./localApi";

const settings: CompanionSettings = {
  ...DEFAULT_SETTINGS,
  language: "fr-FR",
  uiLanguage: "fr",
  privacyLevel: "standard",
  hapticsEnabled: false,
  speechRate: 1.5,
  onboarded: true,
  localApiUrl: "https://api.example.com",
  cloudSyncEnabled: true,
};

const turn = (overrides: Partial<TranscriptTurn>): TranscriptTurn => ({
  id: "t",
  rawText: "raw",
  refinedText: "refined",
  mode: "dictate",
  language: "en-US",
  privacyMode: false,
  createdAt: "2026-11-01T10:00:00.000Z",
  durationMs: 1000,
  source: "microphone",
  syncState: "local",
  ...overrides,
});

describe("phone-only switch", () => {
  it("gives no API config while the API is off", () => {
    const config = apiConfigFor(false, settings, "token");
    assert.equal(config.apiUrl, undefined);
    assert.deepEqual(config, {});
  });

  it("ignores EXPO_PUBLIC_SONOLECT_API_URL while the API is off", () => {
    const previous = process.env.EXPO_PUBLIC_SONOLECT_API_URL;
    process.env.EXPO_PUBLIC_SONOLECT_API_URL = "https://api.example.com";
    try {
      const withoutUrl: CompanionSettings = { ...settings };
      delete withoutUrl.localApiUrl;
      assert.deepEqual(apiConfigFor(false, withoutUrl, "token"), {});
      assert.equal(
        apiConfigFor(true, withoutUrl, "token").apiUrl,
        "https://api.example.com",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.EXPO_PUBLIC_SONOLECT_API_URL;
      } else {
        process.env.EXPO_PUBLIC_SONOLECT_API_URL = previous;
      }
    }
  });

  it("keeps today's API config while the API is on", () => {
    const config = apiConfigFor(true, settings, "token");
    assert.deepEqual(
      config,
      resolveMobileLocalApiConfig({ ...settings, apiToken: "token" }),
    );
    assert.deepEqual(config, {
      apiUrl: "https://api.example.com",
      apiToken: "token",
    });
  });

  it("offers only the local refinement modes while the API is off", () => {
    assert.deepEqual(availableRefinementModesFor(false), [
      "dictate",
      "summarize",
      "task_creation",
    ]);
    assert.deepEqual(availableRefinementModesFor(true), REFINEMENT_MODES);
  });

  it("turns sync off and clears the API URL, and nothing else", () => {
    assert.deepEqual(effectiveSettingsFor(false, settings), {
      ...settings,
      cloudSyncEnabled: false,
      localApiUrl: undefined,
    });
    assert.equal(effectiveSettingsFor(true, settings), settings);
  });

  it("migrates stored data once and then reports no change", () => {
    const history = [
      turn({ id: "queued", syncState: "queued", pinned: true }),
      turn({ id: "synced", syncState: "synced", source: "remote" }),
      turn({ id: "local", syncState: "local", pinned: true }),
      turn({ id: "queued-2", syncState: "queued" }),
    ];
    const snapshot = structuredClone({ settings, history });

    const first = phoneOnlyMigration(settings, history);
    assert.equal(first.changed, true);

    const expectedSettings: CompanionSettings = {
      ...settings,
      cloudSyncEnabled: false,
    };
    delete expectedSettings.localApiUrl;
    assert.deepEqual(first.settings, expectedSettings);
    assert.equal("localApiUrl" in first.settings, false);

    assert.deepEqual(first.history, [
      { ...history[0], syncState: "local" },
      history[1],
      history[2],
      { ...history[3], syncState: "local" },
    ]);
    assert.deepEqual(
      first.history.map((item) => [item.id, item.syncState, item.pinned]),
      [
        ["queued", "local", true],
        ["synced", "synced", undefined],
        ["local", "local", true],
        ["queued-2", "local", undefined],
      ],
    );
    // The inputs are not mutated.
    assert.deepEqual({ settings, history }, snapshot);

    const second = phoneOnlyMigration(first.settings, first.history);
    assert.equal(second.changed, false);
    assert.equal(second.settings, first.settings);
    assert.equal(second.history, first.history);
  });
});
