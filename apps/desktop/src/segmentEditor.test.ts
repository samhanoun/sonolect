import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  assignSpeakerLabel,
  mergeTranscriptSegments,
  splitTranscriptSegment,
  textToSegments,
} from "./segmentEditor";

describe("transcript segment editing", () => {
  it("creates timestamped segments from plain transcript text", () => {
    const segments = textToSegments("First thought.\n\nSecond thought.");

    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.text, "First thought.");
    assert.equal(segments[1]?.startMs, 1000);
  });

  it("merges adjacent selected segments and preserves speaker label", () => {
    const [a, b, c] = textToSegments("Hello.\n\nWorld.\n\nLater.");
    const merged = mergeTranscriptSegments(
      [assignSpeakerLabel(a!, "Ismail"), b!, c!],
      a!.id,
      b!.id,
    );

    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.text, "Hello. World.");
    assert.equal(merged[0]?.speaker, "Ismail");
    assert.equal(merged[0]?.endMs, b!.endMs);
  });

  it("splits a segment at a word boundary", () => {
    const [segment] = textToSegments("Hello world from Sonolect.");
    const result = splitTranscriptSegment([segment!], segment!.id, 11);

    assert.equal(result.length, 2);
    assert.equal(result[0]?.text, "Hello world");
    assert.equal(result[1]?.text, "from Sonolect.");
    assert.ok(result[1]!.startMs > result[0]!.startMs);
  });

  it("assigns and clears speaker labels", () => {
    const [segment] = textToSegments("Bonjour.");
    const assigned = assignSpeakerLabel(segment!, "Speaker 1");
    const cleared = assignSpeakerLabel(assigned, "");

    assert.equal(assigned.speaker, "Speaker 1");
    assert.equal(cleared.speaker, undefined);
  });
});
