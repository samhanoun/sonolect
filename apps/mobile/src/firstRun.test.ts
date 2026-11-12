import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings } from "./domain";
import { DEFAULT_SETTINGS, normalizeSettings } from "./domain";
import type { DeviceLocale } from "./firstRun";
import { resolveInitialSettings } from "./firstRun";

/** A locale as expo-localization reports it: the code is the first subtag. */
function locale(languageTag: string): DeviceLocale {
  return {
    languageTag,
    languageCode: languageTag.split(/[-_]/)[0]?.toLowerCase() ?? null,
  };
}

describe("resolveInitialSettings", () => {
  it("maps a French region to the French UI and fr-FR dictation", () => {
    assert.deepEqual(resolveInitialSettings([locale("fr-CA")]), {
      uiLanguage: "fr",
      language: "fr-FR",
    });
  });

  it("keeps the English UI for a language without a UI", () => {
    assert.deepEqual(resolveInitialSettings([locale("ar-EG")]), {
      uiLanguage: "en",
      language: "ar-SA",
    });
    assert.deepEqual(resolveInitialSettings([locale("de-AT")]), {
      uiLanguage: "en",
      language: "de-DE",
    });
  });

  it("uses the first locale that the app supports", () => {
    assert.deepEqual(
      resolveInitialSettings([locale("pt-BR"), locale("fr-FR")]),
      { uiLanguage: "fr", language: "fr-FR" },
    );
  });

  it("prefers an exact dictation tag", () => {
    assert.deepEqual(resolveInitialSettings([locale("es-ES")]), {
      uiLanguage: "en",
      language: "es-ES",
    });
    assert.deepEqual(resolveInitialSettings([locale("EN-us")]), {
      uiLanguage: "en",
      language: "en-US",
    });
    assert.deepEqual(resolveInitialSettings([locale("en-GB")]), {
      uiLanguage: "en",
      language: "en-US",
    });
  });

  it("takes the UI and dictation languages from different locales", () => {
    assert.deepEqual(
      resolveInitialSettings([locale("de-DE"), locale("en-US")]),
      { uiLanguage: "en", language: "de-DE" },
    );
    assert.deepEqual(
      resolveInitialSettings([locale("ar-SA"), locale("fr-FR")]),
      { uiLanguage: "fr", language: "ar-SA" },
    );
  });

  it("falls back to English", () => {
    assert.deepEqual(resolveInitialSettings([]), {
      uiLanguage: "en",
      language: "en-US",
    });
    assert.deepEqual(resolveInitialSettings([locale("ja-JP")]), {
      uiLanguage: "en",
      language: "en-US",
    });
  });

  it("reads '_' as '-' and a missing code from the tag", () => {
    assert.deepEqual(
      resolveInitialSettings([{ languageTag: "fr_FR", languageCode: "fr" }]),
      { uiLanguage: "fr", language: "fr-FR" },
    );
    assert.deepEqual(
      resolveInitialSettings([{ languageTag: "fr_FR", languageCode: null }]),
      { uiLanguage: "fr", language: "fr-FR" },
    );
    assert.deepEqual(
      resolveInitialSettings([{ languageTag: "es_MX", languageCode: null }]),
      { uiLanguage: "en", language: "es-ES" },
    );
  });
});

describe("normalizeSettings with device defaults", () => {
  const base: CompanionSettings = {
    ...DEFAULT_SETTINGS,
    ...resolveInitialSettings([locale("fr-BE")]),
  };

  it("uses the device defaults when nothing is stored", () => {
    const settings = normalizeSettings(undefined, base);
    assert.equal(settings.uiLanguage, "fr");
    assert.equal(settings.language, "fr-FR");
    assert.equal(settings.onboarded, false);
    assert.equal(settings.privacyLevel, DEFAULT_SETTINGS.privacyLevel);
  });

  it("keeps stored choices over the device defaults", () => {
    const settings = normalizeSettings(
      { uiLanguage: "en", language: "de-DE" },
      base,
    );
    assert.equal(settings.uiLanguage, "en");
    assert.equal(settings.language, "de-DE");
  });

  it("replaces invalid stored values with the base", () => {
    const settings = normalizeSettings(
      { uiLanguage: "pt" as never, language: "pt-BR" as never },
      base,
    );
    assert.equal(settings.uiLanguage, "fr");
    assert.equal(settings.language, "fr-FR");
  });

  it("defaults to DEFAULT_SETTINGS without a base", () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  });

  it("repairs a privacy level or switch that is not valid", () => {
    const settings = normalizeSettings({
      privacyLevel: "paranoid" as never,
      saveHistory: "false" as never,
      hapticsEnabled: 0 as never,
      onboarded: "yes" as never,
      cloudSyncEnabled: null as never,
    });
    assert.equal(settings.privacyLevel, DEFAULT_SETTINGS.privacyLevel);
    assert.equal(settings.saveHistory, DEFAULT_SETTINGS.saveHistory);
    assert.equal(settings.hapticsEnabled, DEFAULT_SETTINGS.hapticsEnabled);
    assert.equal(settings.onboarded, DEFAULT_SETTINGS.onboarded);
    assert.equal(settings.cloudSyncEnabled, DEFAULT_SETTINGS.cloudSyncEnabled);
    assert.equal(
      normalizeSettings({ privacyLevel: "ephemeral", saveHistory: false })
        .privacyLevel,
      "ephemeral",
    );
  });
});
