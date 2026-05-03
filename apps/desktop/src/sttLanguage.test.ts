import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { STT_LANGUAGES } from "./sttLanguages";

describe("STT_LANGUAGES", () => {
  it("has auto + at least 12 languages", () => {
    assert.ok(
      STT_LANGUAGES.length >= 13,
      `Expected at least 13 entries (auto + 12 languages), got ${STT_LANGUAGES.length}`,
    );
  });

  it("each language has code, name, and nativeName", () => {
    for (const lang of STT_LANGUAGES) {
      assert.ok(
        lang.code,
        `Missing code for language: ${JSON.stringify(lang)}`,
      );
      assert.ok(
        lang.name,
        `Missing name for language: ${JSON.stringify(lang)}`,
      );
      assert.ok(
        lang.nativeName,
        `Missing nativeName for language: ${JSON.stringify(lang)}`,
      );
    }
  });

  it("auto is the first option", () => {
    const first = STT_LANGUAGES[0];
    assert.ok(first, "STT_LANGUAGES must not be empty");
    assert.equal(first.code, "auto");
    assert.equal(first.name, "Auto");
  });
});
