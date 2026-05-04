import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

const mainSource = await readFile(
  new URL("./main.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("./styles.css", import.meta.url),
  "utf8",
);

describe("desktop segment editor UI wiring", () => {
  it("imports and uses the segment editor utilities in the transcript detail flow", () => {
    for (const requiredSource of [
      "textToSegments",
      "segmentsToText",
      "mergeTranscriptSegments",
      "splitTranscriptSegment",
      "assignSpeakerLabel",
      "syncTranscriptText",
      "syncSegments",
    ]) {
      assert.match(mainSource, new RegExp(requiredSource));
    }
  });

  it("renders speaker labels plus merge and split controls", () => {
    for (const requiredKey of [
      "segments.ariaLabel",
      "segments.speaker",
      "segments.merge",
      "segments.split",
      "segments.textLabel",
    ]) {
      assert.match(mainSource, new RegExp(requiredKey));
    }

    assert.match(mainSource, /toggleSegmentSelection/);
    assert.match(mainSource, /updateSegmentSpeaker/);
    assert.match(mainSource, /mergeSelectedSegments/);
    assert.match(mainSource, /splitSelectedSegment/);
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

  it("styles the segment editor, selectable segment cards and speaker input", () => {
    for (const requiredSelector of [
      ".segment-editor",
      ".segment-toolbar",
      ".segment-card",
      ".segment-card.selected",
      ".segment-speaker",
      ".segment-textarea",
    ]) {
      assert.match(
        stylesSource,
        new RegExp(requiredSelector.replaceAll(".", "\\.")),
      );
    }
  });
});
