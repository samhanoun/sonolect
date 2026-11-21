import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpeakerTools } from "./components/StudioSpeakers";
import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en, type LocaleKeys } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import {
  segmentsFromCapture,
  textToSegments,
  type TranscriptSegment,
} from "./segmentEditor";

const storeSource = await readFile(
  new URL("./store/appStore.ts", import.meta.url),
  "utf8",
);

describe("desktop segment editor UI wiring", () => {
  it("imports and uses the segment editor utilities in the transcript detail flow", () => {
    // These utilities live in the extracted store module (store/appStore.ts).
    for (const requiredSource of [
      "textToSegments",
      "segmentsToText",
      "mergeSegmentRun",
      "splitTranscriptSegment",
      "assignSpeakerLabel",
      "syncTranscriptText",
      "syncSegments",
    ]) {
      assert.match(storeSource, new RegExp(requiredSource));
    }
  });

  it("has English and French locale parity for segment editor copy", () => {
    const segmentKeys = Object.keys(en).filter((key) =>
      key.startsWith("segments."),
    );

    assert.ok(segmentKeys.length >= 8);
    for (const key of segmentKeys) {
      assert.ok(key in fr, `Missing ${key} in French locale`);
    }
  });

  it("offers speaker detection only in the desktop app, for one saved recording", () => {
    const recorded = segmentsFromCapture({
      id: "50-1",
      durationMs: 2000,
      transcript: "Hello. Goodbye.",
    });
    const other = segmentsFromCapture({
      id: "51-1",
      durationMs: 1000,
      transcript: "Later.",
    });
    const render = (segments: TranscriptSegment[]) =>
      renderToStaticMarkup(createElement(SpeakerTools, { segments }));
    // The browser preview cannot run the model.
    assert.equal(render(recorded), "");
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = globalThis;
    globals.__TAURI_INTERNALS__ = {};
    try {
      const tools = render(recorded);
      assert.match(tools, /Detect speakers/);
      assert.match(tools, /<option value=""[^>]*>Auto<\/option>/);
      assert.match(tools, /<option value="8">8<\/option>/);
      // Typed text has no recording, and two recordings have no single one.
      assert.equal(render(textToSegments("Typed. Text.")), "");
      assert.equal(render([...recorded, ...other]), "");
    } finally {
      delete globals.__TAURI_INTERNALS__;
      delete globals.window;
    }
  });

  it("has the speaker detection copy in all five languages", () => {
    const prefixes = [
      "studio.speakers.",
      "studio.settings.speakerModel",
      "native.speakers",
      "native.speakerModel",
      "native.speakerCount",
    ];
    const keys = (Object.keys(en) as LocaleKeys[]).filter((key) =>
      prefixes.some((prefix) => key.startsWith(prefix)),
    );
    assert.ok(keys.length >= 30, `only ${keys.length} keys`);
    const placeholders = (text: string) =>
      new Set(text.match(/\{\w+\}/g) ?? []);
    for (const [language, strings] of Object.entries({ fr, de, es, ar })) {
      for (const key of keys) {
        const text =
          (strings as Partial<Record<LocaleKeys, string>>)[key] ?? "";
        assert.ok(text.trim(), `${language} has no ${key}`);
        const english = placeholders(en[key]);
        // A count may be spelt out ("one segment"); every other value is used.
        for (const name of english)
          if (name !== "{count}")
            assert.ok(text.includes(name), `${language} ${key} lacks ${name}`);
        for (const name of placeholders(text))
          assert.ok(english.has(name), `${language} ${key} has ${name}`);
      }
    }
  });
});
