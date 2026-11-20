import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  LAUNCH_LOCALES,
  detectLocale,
  getLocale,
  getT,
  isSupportedLocale,
  languageName,
  setLocale,
  useI18nStore,
} from "./i18n";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import type { LocaleKeys } from "./locales/en";

describe("i18n", () => {
  describe("detectLocale", () => {
    it("returns 'en' when navigator is undefined", () => {
      const result = detectLocale();
      assert.equal(result, "en");
    });

    it("detects the launch languages from a browser language tag", () => {
      assert.equal(detectLocale("fr"), "fr");
      assert.equal(detectLocale("fr-CA"), "fr");
      assert.equal(detectLocale("FR-fr"), "fr");
      assert.equal(detectLocale("en-GB"), "en");
    });

    it("falls back to English for languages that are not complete yet", () => {
      for (const language of ["es-ES", "de", "ar-MA", "ja", "fro", ""]) {
        assert.equal(detectLocale(language), "en");
      }
      assert.deepEqual([...LAUNCH_LOCALES], ["en", "fr"]);
    });

    it("recognises supported locale codes only", () => {
      assert.equal(isSupportedLocale("fr"), true);
      assert.equal(isSupportedLocale("xx"), false);
      assert.equal(isSupportedLocale("toString"), false);
      assert.equal(isSupportedLocale(undefined), false);
    });
  });

  describe("locale store: setLocale / getLocale", () => {
    it("defaults to en in a non-browser environment", () => {
      const locale = getLocale();
      assert.equal(locale, "en");
    });

    it("switches locale to fr and back to en", () => {
      setLocale("fr");
      assert.equal(getLocale(), "fr");
      setLocale("en");
      assert.equal(getLocale(), "en");
    });

    it("updates the zustand store state", () => {
      setLocale("fr");
      assert.equal(useI18nStore.getState().locale, "fr");
      setLocale("en");
      assert.equal(useI18nStore.getState().locale, "en");
    });
  });

  describe("locale parity", () => {
    it("every English key exists in French", () => {
      const enKeys = Object.keys(en) as LocaleKeys[];
      for (const key of enKeys) {
        assert.ok(key in fr, `French locale missing key: ${key}`);
      }
    });

    it("every French key exists in English", () => {
      const frKeys = Object.keys(fr) as LocaleKeys[];
      for (const key of frKeys) {
        assert.ok(key in en, `English locale missing key: ${key}`);
      }
    });

    it("no locale values are empty strings", () => {
      for (const [key, value] of Object.entries(en)) {
        assert.ok(value.length > 0, `English key "${key}" is empty`);
      }
      for (const [key, value] of Object.entries(fr)) {
        assert.ok(value.length > 0, `French key "${key}" is empty`);
      }
    });
  });

  describe("placeholder interpolation", () => {
    it("English fallback.localCapture contains expected placeholders", () => {
      const template = en["fallback.localCapture"];
      assert.ok(template.includes("{duration}"));
      assert.ok(template.includes("{mimeType}"));
      assert.ok(template.includes("{size}"));
    });

    it("French fallback.localCapture contains the same placeholders", () => {
      const template = fr["fallback.localCapture"];
      assert.ok(template.includes("{duration}"));
      assert.ok(template.includes("{mimeType}"));
      assert.ok(template.includes("{size}"));
    });

    it("English fallback.sentCapture contains expected placeholders", () => {
      const template = en["fallback.sentCapture"];
      assert.ok(template.includes("{jobId}"));
      assert.ok(template.includes("{duration}"));
    });

    it("French fallback.sentCapture contains the same placeholders", () => {
      const template = fr["fallback.sentCapture"];
      assert.ok(template.includes("{jobId}"));
      assert.ok(template.includes("{duration}"));
    });
  });

  describe("translator", () => {
    const withLocale = <T>(locale: "en" | "fr", run: () => T): T => {
      setLocale(locale);
      try {
        return run();
      } finally {
        setLocale("en");
      }
    };

    it("follows the active locale outside React", () => {
      assert.equal(getT()("studio.nav.library"), "Library");
      assert.equal(
        withLocale("fr", () => getT()("studio.nav.library")),
        "Bibliothèque",
      );
    });

    it("fills placeholders and leaves unknown ones alone", () => {
      assert.equal(
        getT()("studio.speech.download", { format: "MP3" }),
        "Download MP3",
      );
      assert.equal(getT()("studio.speech.download"), "Download {format}");
      // A value that looks like a replacement pattern is inserted literally.
      assert.equal(
        getT()("studio.vocab.deleteLabel", { name: "$& {count}" }),
        "Delete $& {count}",
      );
    });

    it("uses each language's own plural rule", () => {
      const en = getT();
      assert.equal(en.count("studio.transcribe.words", 0), "0 words");
      assert.equal(en.count("studio.transcribe.words", 1), "1 word");
      assert.equal(en.count("studio.transcribe.words", 4), "4 words");
      withLocale("fr", () => {
        const fr = getT();
        // French treats zero as singular.
        assert.equal(fr.count("studio.transcribe.words", 0), "0 mot");
        assert.equal(fr.count("studio.transcribe.words", 1), "1 mot");
        assert.equal(fr.count("studio.transcribe.words", 2), "2 mots");
      });
    });

    it("formats the count for the locale", () => {
      assert.equal(
        getT().count("studio.transcribe.words", 12345),
        "12,345 words",
      );
      const french = withLocale("fr", () =>
        getT().count("studio.transcribe.words", 12345),
      );
      assert.match(french, /^12\s345 mots$/u);
    });

    it("translates error keys reported by the store and keeps other text", () => {
      assert.equal(
        getT().message("error.recordingError"),
        en["error.recordingError"],
      );
      assert.equal(
        withLocale("fr", () => getT().message("error.recordingError")),
        fr["error.recordingError"],
      );
      assert.equal(getT().message("Disk is full"), "Disk is full");
      assert.equal(getT().message("constructor"), "constructor");
      assert.equal(getT().message(""), "");
    });

    it("names dictation languages in the interface language", () => {
      assert.equal(languageName("de", "en", "German"), "German");
      assert.equal(languageName("de", "fr", "German"), "allemand");
      assert.equal(languageName("not a code", "fr", "Fallback"), "Fallback");
    });
  });

  describe("French typography", () => {
    it("keeps punctuation attached to the word before it", () => {
      for (const [key, value] of Object.entries(fr)) {
        if (!key.startsWith("studio.") && !key.startsWith("native.")) continue;
        assert.doesNotMatch(
          value,
          / [?!;:»]|« /u,
          `French key "${key}" needs a no-break space before its punctuation`,
        );
      }
    });

    it("every plural stem has both forms in both languages", () => {
      for (const key of Object.keys(en)) {
        if (key.endsWith(".one"))
          assert.ok(`${key.slice(0, -4)}.other` in en, `${key} lacks .other`);
        if (key.endsWith(".other") && key.startsWith("studio."))
          assert.ok(`${key.slice(0, -6)}.one` in en, `${key} lacks .one`);
      }
    });

    it("French keeps every placeholder of the English text", () => {
      const placeholders = (text: string) =>
        (text.match(/\{\w+\}/g) ?? []).sort().join(",");
      for (const key of Object.keys(en) as LocaleKeys[]) {
        assert.equal(
          placeholders(fr[key]),
          placeholders(en[key]),
          `Placeholders differ for "${key}"`,
        );
      }
    });
  });

  describe("locale key count", () => {
    it("has a non-trivial number of keys", () => {
      const count = Object.keys(en).length;
      assert.ok(count >= 80, `Expected at least 80 keys, got ${count}`);
    });

    it("en and fr have the same number of keys", () => {
      assert.equal(Object.keys(en).length, Object.keys(fr).length);
    });
  });
});
