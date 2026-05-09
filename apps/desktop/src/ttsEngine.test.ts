import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  splitTextForTts,
  createInitialPlaybackState,
  formatProgress,
  calculateEta,
} from "./ttsEngine";

describe("ttsEngine", () => {
  describe("createInitialPlaybackState", () => {
    it("returns idle state with zero progress", () => {
      const state = createInitialPlaybackState();
      assert.equal(state.status, "idle");
      assert.equal(state.currentSentenceIndex, 0);
      assert.equal(state.totalSentences, 0);
      assert.equal(state.progress, 0);
      assert.equal(state.speed, 1);
      assert.equal(state.voiceId, "");
      assert.equal(state.error, undefined);
    });
  });

  describe("splitTextForTts", () => {
    it("splits text on sentence boundaries", () => {
      const result = splitTextForTts("Hello world. How are you? I am fine!");
      assert.equal(result.length, 3);
      assert.equal(result[0]!, "Hello world.");
      assert.equal(result[1]!, "How are you?");
      assert.equal(result[2]!, "I am fine!");
    });

    it("returns empty array for empty input", () => {
      assert.deepEqual(splitTextForTts(""), []);
      assert.deepEqual(splitTextForTts("   "), []);
    });

    it("handles abbreviations without splitting", () => {
      const result = splitTextForTts(
        "Dr. Smith went to Washington. He met Mr. Jones there.",
      );
      assert.equal(result.length, 2);
      assert.ok(result[0]!.includes("Dr."));
      assert.ok(result[1]!.includes("Mr."));
    });

    it("preserves decimal numbers", () => {
      const result = splitTextForTts(
        "The price is 3.14 dollars. That is final.",
      );
      assert.equal(result.length, 2);
      assert.ok(result[0]!.includes("3.14"));
    });

    it("merges very short fragments into previous sentence", () => {
      const result = splitTextForTts(
        "This is a sentence. OK. Another sentence here.",
      );
      assert.ok(result.length <= 3);
    });

    it("breaks very long sentences at clause boundaries", () => {
      const longSentence =
        Array(50).fill("word").join(" ") +
        ", " +
        Array(50).fill("more").join(" ") +
        ", " +
        Array(50).fill("even").join(" ") +
        ". End.";
      const result = splitTextForTts(longSentence);
      assert.ok(result.length >= 2);
    });

    it("handles newlines as split points", () => {
      const result = splitTextForTts(
        "First paragraph.\nSecond paragraph.\nThird one.",
      );
      assert.equal(result.length, 3);
    });
  });

  describe("formatProgress", () => {
    it("formats progress with sentence counts", () => {
      assert.equal(formatProgress(3, 42), "3 / 42 sentences");
    });

    it("works with zero values", () => {
      assert.equal(formatProgress(0, 0), "0 / 0 sentences");
    });

    it("handles single sentence", () => {
      assert.equal(formatProgress(1, 1), "1 / 1 sentences");
    });
  });

  describe("calculateEta", () => {
    it("returns seconds for short durations", () => {
      assert.equal(calculateEta(5, 3), "~15 sec remaining");
    });

    it("returns minutes for longer durations", () => {
      const result = calculateEta(30, 4);
      assert.equal(result, "~2 min remaining");
    });

    it("returns zero seconds when nothing remains", () => {
      assert.equal(calculateEta(0, 5), "~0 sec remaining");
    });

    it("rounds up to nearest second", () => {
      assert.equal(calculateEta(1, 0.5), "~1 sec remaining");
    });

    it("rounds minutes correctly", () => {
      const result = calculateEta(20, 5);
      assert.ok(result.includes("min remaining"));
    });
  });
});
