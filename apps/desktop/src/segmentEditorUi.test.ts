import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

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
});
