import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSyncServerUrl } from "@sonolect/sync-core";

import type { CompanionSettings, TranscriptTurn } from "./domain";
import { DEFAULT_SETTINGS, REFINEMENT_MODES } from "./domain";
import {
  apiConfigFor,
  availableRefinementModesFor,
  effectiveSettingsFor,
  phoneOnlyMigration,
  syncServerUrlFor,
} from "./features";
import { resolveMobileLocalApiConfig } from "./localApi";

// The build-time check (plain JS, run by app.config.js).
const releaseConfig = require("../config/release.cjs") as {
  syncServerUrlFrom: (env: Record<string, string>) => string | null;
};

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

  it("offers Rewrite and Reply once online editing is set up", () => {
    assert.deepEqual(
      availableRefinementModesFor(false, true),
      REFINEMENT_MODES,
    );
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

describe("sync server URL", () => {
  const dev = { dev: true, platform: "ios" };
  const release = { dev: false, platform: "android" };

  it("hides sync without a URL", () => {
    for (const raw of [undefined, "", "   "]) {
      assert.equal(syncServerUrlFor(raw, dev), null);
      assert.equal(syncServerUrlFor(raw, release), null);
    }
  });

  it("takes an https URL in every build, without its trailing slash", () => {
    for (const build of [dev, release, { dev: false, platform: undefined }]) {
      assert.equal(
        syncServerUrlFor(" https://Sync.Example.org/ ", build),
        "https://sync.example.org",
      );
    }
  });

  it("allows plain http to this machine or the emulator host in development only", () => {
    for (const url of [
      "http://127.0.0.1:8713",
      "http://localhost:8713",
      "http://10.0.2.2:8713",
    ]) {
      assert.equal(syncServerUrlFor(url, dev), url);
      assert.equal(syncServerUrlFor(url, release), null);
    }
    assert.equal(syncServerUrlFor("http://192.168.1.2:8713", dev), null);
    assert.equal(syncServerUrlFor("http://sync.example.org", dev), null);
  });

  it("is never offered on web", () => {
    for (const build of [
      { dev: true, platform: "web" },
      { dev: false, platform: "web" },
    ]) {
      assert.equal(syncServerUrlFor("https://sync.example.org", build), null);
    }
  });

  it("does not depend on the API switch", () => {
    // No Sonolect API URL and the API off: sync still has its own server.
    assert.deepEqual(apiConfigFor(false, settings), {});
    assert.equal(
      syncServerUrlFor("https://sync.example.org", release),
      "https://sync.example.org",
    );
  });

  it("agrees with the build-time check in config/release.cjs", () => {
    for (const raw of [
      "https://sync.example.org",
      "https://Sync.Example.org/",
      "https://example.org:8443/sync/",
      "https://[::1]:8443",
      "http://127.0.0.1:8713",
      "http://localhost",
      "http://10.0.2.2:8713/",
      "http://sync.example.org",
      "ftp://sync.example.org",
      "https://user@sync.example.org",
      "https://sync.example.org/?a=1",
      "https://sync.example.org/#k",
      "https://sync.example.org:0",
      "https://sync..example.org",
      "not a url",
    ]) {
      let built: string | null | "refused";
      try {
        built = releaseConfig.syncServerUrlFrom({
          EXPO_PUBLIC_SONOLECT_SYNC_URL: raw,
        });
      } catch {
        built = "refused";
      }
      const checked = checkSyncServerUrl(raw, { allowLocalHttp: true });
      assert.equal(built, checked.ok ? checked.url : "refused", raw);
    }
  });
});
