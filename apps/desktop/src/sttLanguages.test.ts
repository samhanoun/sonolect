import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STT_LANGUAGES,
  getLanguageByCode,
  getLanguageDisplayName,
} from "./sttLanguages";

describe("STT_LANGUAGES", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(STT_LANGUAGES));
    assert.ok(STT_LANGUAGES.length > 0);
  });

  it("each entry has code, name, and nativeName", () => {
    for (const lang of STT_LANGUAGES) {
      assert.equal(typeof lang.code, "string");
      assert.equal(typeof lang.name, "string");
      assert.equal(typeof lang.nativeName, "string");
      assert.ok(lang.code.length > 0);
      assert.ok(lang.name.length > 0);
      assert.ok(lang.nativeName.length > 0);
    }
  });

  it("contains common languages", () => {
    const codes = STT_LANGUAGES.map((l) => l.code);
    for (const expected of ["en", "fr", "ar", "es", "de", "zh", "ja"]) {
      assert.ok(codes.includes(expected), `Missing language code: ${expected}`);
    }
  });

  it("has no duplicate language codes", () => {
    const codes = STT_LANGUAGES.map((l) => l.code);
    assert.equal(new Set(codes).size, codes.length);
  });

  it("has auto as the first entry", () => {
    assert.equal(STT_LANGUAGES[0]!.code, "auto");
    assert.equal(STT_LANGUAGES[0]!.name, "Auto");
  });
});

describe("getLanguageByCode", () => {
  it("returns the matching language entry", () => {
    const en = getLanguageByCode("en");
    assert.ok(en);
    assert.equal(en!.code, "en");
    assert.equal(en!.name, "English");
  });

  it("returns undefined for unknown code", () => {
    assert.equal(getLanguageByCode("xx"), undefined);
  });
});

describe("getLanguageDisplayName", () => {
  it("returns nativeName for a known language", () => {
    assert.equal(getLanguageDisplayName("fr"), "Français");
  });

  it("returns Auto-détection for auto", () => {
    assert.equal(getLanguageDisplayName("auto"), "Auto-détection");
  });

  it("returns the code itself for unknown language", () => {
    assert.equal(getLanguageDisplayName("xx"), "xx");
  });
});
