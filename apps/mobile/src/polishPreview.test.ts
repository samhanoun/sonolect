import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  computePolishDiff,
  countChanges,
  formatDiffSummary,
} from "./polishPreview";

describe("polishPreview", () => {
  describe("computePolishDiff", () => {
    it("detects removed filler words", () => {
      const diff = computePolishDiff(
        "um please send this to sam",
        "please send this to sam",
      );
      assert.equal(diff.original, "um please send this to sam");
      assert.equal(diff.polished, "please send this to sam");

      const removedText = diff.changes
        .filter((c) => c.type === "removed")
        .map((c) => c.text)
        .join(" ");
      assert.ok(removedText.includes("um"));
    });

    it("detects added words", () => {
      const diff = computePolishDiff(
        "send this to sam",
        "please send this to sam now",
      );
      const addedText = diff.changes
        .filter((c) => c.type === "added")
        .map((c) => c.text)
        .join(" ");
      assert.ok(addedText.includes("please"));
      assert.ok(addedText.includes("now"));
    });

    it("handles identical strings", () => {
      const diff = computePolishDiff("hello world", "hello world");
      assert.equal(diff.changes.length, 1);
      assert.equal(diff.changes[0]!.type, "unchanged");
      assert.equal(diff.changes[0]!.text, "hello world");
    });

    it("handles completely different strings", () => {
      const diff = computePolishDiff("hello world", "goodbye earth");
      const removed = diff.changes.filter((c) => c.type === "removed");
      const added = diff.changes.filter((c) => c.type === "added");
      assert.ok(removed.length > 0);
      assert.ok(added.length > 0);
    });

    it("handles empty original", () => {
      const diff = computePolishDiff("", "hello world");
      const counts = countChanges(diff);
      assert.equal(counts.added, 2);
      assert.equal(counts.removed, 0);
    });

    it("handles empty polished", () => {
      const diff = computePolishDiff("hello world", "");
      const counts = countChanges(diff);
      assert.equal(counts.removed, 2);
      assert.equal(counts.added, 0);
    });

    it("handles both empty", () => {
      const diff = computePolishDiff("", "");
      assert.equal(diff.changes.length, 0);
    });

    it("groups consecutive same-type changes", () => {
      const diff = computePolishDiff(
        "um uh please continue",
        "please continue",
      );
      // "um uh" should be grouped into a single removed change
      const removed = diff.changes.filter((c) => c.type === "removed");
      assert.equal(removed.length, 1);
      assert.equal(removed[0]!.text, "um uh");
    });
  });

  describe("countChanges", () => {
    it("counts word-level additions, removals, and unchanged", () => {
      const diff = computePolishDiff(
        "um please send this",
        "please send this now",
      );
      const counts = countChanges(diff);
      assert.equal(counts.removed, 1); // "um"
      assert.equal(counts.added, 1); // "now"
      assert.equal(counts.unchanged, 3); // "please send this"
    });

    it("returns all zeros for identical text", () => {
      const diff = computePolishDiff("same text", "same text");
      const counts = countChanges(diff);
      assert.equal(counts.added, 0);
      assert.equal(counts.removed, 0);
      assert.equal(counts.unchanged, 2);
    });
  });

  describe("formatDiffSummary", () => {
    it("formats removal count", () => {
      const diff = computePolishDiff("um hello", "hello");
      const summary = formatDiffSummary(diff);
      assert.ok(summary.includes("Removed 1 word"));
    });

    it("formats addition count", () => {
      const diff = computePolishDiff("hello", "hello world");
      const summary = formatDiffSummary(diff);
      assert.ok(summary.includes("Added 1 word"));
    });

    it("formats both additions and removals", () => {
      const diff = computePolishDiff("um hello", "hello world");
      const summary = formatDiffSummary(diff);
      assert.ok(summary.includes("Removed"));
      assert.ok(summary.includes("Added"));
    });

    it("returns no-changes message for identical text", () => {
      const diff = computePolishDiff("same text", "same text");
      assert.equal(formatDiffSummary(diff), "No changes");
    });

    it("pluralizes correctly for multiple words", () => {
      const diff = computePolishDiff("um uh hello", "hello");
      const summary = formatDiffSummary(diff);
      assert.ok(summary.includes("Removed 2 words"));
    });
  });

  it("works with a real dictation polish scenario", () => {
    const original = "um so like I was saying you know the report is ready";
    const polished = "The report is ready.";
    const diff = computePolishDiff(original, polished);
    const counts = countChanges(diff);

    assert.ok(counts.removed > 0, "Should have removed filler words");
    assert.ok(counts.unchanged > 0, "Should have some unchanged words");
  });
});
