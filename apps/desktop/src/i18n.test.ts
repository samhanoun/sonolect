import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { detectLocale, setLocale, getLocale, useI18nStore } from "./i18n";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import type { LocaleKeys } from "./locales/en";

describe("i18n", () => {
  describe("detectLocale", () => {
    it("returns 'en' when navigator is undefined", () => {
      const result = detectLocale();
      assert.equal(result, "en");
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
