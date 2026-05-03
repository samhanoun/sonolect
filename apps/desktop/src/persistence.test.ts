import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

// Minimal localStorage polyfill for Node test environment
let store: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};

// Inject before importing module
(globalThis as any).localStorage = fakeLocalStorage;

// Dynamic import so the module sees our polyfill
const { saveSettings, loadSettings, SETTINGS_KEYS } =
  await import("./persistence");

describe("persistence", () => {
  beforeEach(() => {
    store = {};
  });

  it("roundtrips a value through save/load", () => {
    saveSettings(SETTINGS_KEYS.locale, "fr");
    assert.equal(loadSettings(SETTINGS_KEYS.locale), "fr");
  });

  it("returns null for missing key", () => {
    assert.equal(loadSettings("nonexistent.key"), null);
  });

  it("persists sttLanguage and privacyLevel", () => {
    saveSettings(SETTINGS_KEYS.sttLanguage, "en");
    saveSettings(SETTINGS_KEYS.privacyLevel, "cloud");
    assert.equal(loadSettings(SETTINGS_KEYS.sttLanguage), "en");
    assert.equal(loadSettings(SETTINGS_KEYS.privacyLevel), "cloud");
  });

  it("safe fallback when localStorage is unavailable", () => {
    const original = (globalThis as any).localStorage;
    // Simulate unavailable localStorage
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("localStorage is not available");
      },
      configurable: true,
    });

    // Should not throw
    assert.doesNotThrow(() => saveSettings(SETTINGS_KEYS.locale, "en"));
    assert.equal(loadSettings(SETTINGS_KEYS.locale), null);

    // Restore
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      configurable: true,
      writable: true,
    });
  });
});
