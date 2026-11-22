import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The Android voice keyboard (modules/sonolect-voice-keyboard) is Kotlin,
 * which these tests can't build: they read its sources. Its text lives in
 * res/values (English) and res/values-fr, like the app's own strings.
 */
const ANDROID = path.join(
  __dirname,
  "..",
  "modules",
  "sonolect-voice-keyboard",
  "android",
  "src",
  "main",
);
const read = (...parts: string[]) =>
  readFileSync(path.join(ANDROID, ...parts), "utf8");

/** name → text of each <string>, and the names marked translatable="false". */
function strings(xml: string) {
  const texts = new Map<string, string>();
  const fixed = new Set<string>();
  for (const match of xml.matchAll(
    /<string name="([a-z0-9_]+)"([^>]*)>([^<]*)<\/string>/g,
  )) {
    const [, name, attributes, text] = match;
    if (!name) continue;
    texts.set(name, text ?? "");
    if (attributes?.includes('translatable="false"')) fixed.add(name);
  }
  return { texts, fixed };
}

const english = strings(read("res", "values", "sonolect_voice_strings.xml"));
const french = strings(read("res", "values-fr", "sonolect_voice_strings.xml"));
const kotlin = ["SonolectVoiceIme.kt", "VoiceViews.kt"].map((file) =>
  read("java", "expo", "modules", "sonolectvoicekeyboard", file),
);

describe("the voice keyboard's text", () => {
  it("has every English string in French too", () => {
    const translatable = [...english.texts.keys()].filter(
      (name) => !english.fixed.has(name),
    );
    assert.ok(translatable.length > 10);
    assert.deepEqual([...french.texts.keys()].sort(), translatable.sort());
    for (const name of translatable) {
      assert.notEqual(french.texts.get(name), "", name);
      // The same placeholders in both languages.
      assert.deepEqual(
        french.texts.get(name)?.match(/%\d\$[ds]/g) ?? [],
        english.texts.get(name)?.match(/%\d\$[ds]/g) ?? [],
        name,
      );
    }
  });

  it("reads every string it shows from the resources", () => {
    const used = new Set(
      kotlin.flatMap((source) =>
        [...source.matchAll(/R\.string\.([a-z0-9_]+)/g)].map((m) => m[1]),
      ),
    );
    for (const name of used) assert.ok(english.texts.has(name ?? ""), name);
    // Status lines and TalkBack labels, never English literals in Kotlin.
    for (const source of kotlin) {
      assert.doesNotMatch(source, /\.text = "[^"]/);
      assert.doesNotMatch(source, /contentDescription = "/);
      assert.doesNotMatch(source, /showMessage\(\s*"/);
    }
  });

  it("tells TalkBack users that the orb stops a dictation while listening", () => {
    assert.ok(used("sonolect_voice_stop"));
    assert.ok(used("sonolect_voice_dictate"));
  });
});

function used(name: string): boolean {
  return kotlin.some((source) => source.includes(`R.string.${name}`));
}
