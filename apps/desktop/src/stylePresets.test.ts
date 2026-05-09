import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { getStylePresets, applyStylePreset } from "./stylePresets";

describe("stylePresets", () => {
  it("returns all five built-in presets", () => {
    const presets = getStylePresets();
    assert.equal(presets.length, 5);
    const ids = presets.map((p) => p.id);
    assert.deepEqual(ids, [
      "concise",
      "professional",
      "casual",
      "technical",
      "custom",
    ]);
  });

  it("throws on unknown preset id", () => {
    assert.throws(() => applyStylePreset("hello", "nonexistent"), {
      message: "Unknown style preset: nonexistent",
    });
  });

  describe("concise preset", () => {
    it("removes filler words: very, really, just, actually, basically", () => {
      const input =
        "This is very important and really just actually basically good.";
      const result = applyStylePreset(input, "concise");
      assert.equal(result, "This is important and good.");
    });

    it("collapses redundant phrases", () => {
      assert.equal(
        applyStylePreset(
          "In order to succeed, due to the fact that we tried.",
          "concise",
        ),
        "to succeed, because we tried.",
      );
      assert.equal(
        applyStylePreset("At this point in time we should act.", "concise"),
        "now we should act.",
      );
    });

    it("is deterministic across multiple calls", () => {
      const input = "I just really basically want to say this is very good.";
      const first = applyStylePreset(input, "concise");
      const second = applyStylePreset(input, "concise");
      assert.equal(first, second);
    });
  });

  describe("professional preset", () => {
    it("expands contractions", () => {
      const input = "I can't believe it's that simple. Don't worry about it.";
      const result = applyStylePreset(input, "professional");
      assert.ok(result.includes("cannot"));
      assert.ok(result.includes("it is"));
      assert.ok(result.includes("Do not"));
    });

    it("capitalizes sentence starts", () => {
      const result = applyStylePreset(
        "hello world. this is a test.",
        "professional",
      );
      assert.ok(result.startsWith("Hello"));
      assert.ok(result.includes("This is"));
    });

    it("ensures sentences end with punctuation", () => {
      const result = applyStylePreset("Hello world", "professional");
      assert.ok(result.endsWith("."));
    });

    it("is deterministic", () => {
      const input = "We won't do that. It's not right.";
      assert.equal(
        applyStylePreset(input, "professional"),
        applyStylePreset(input, "professional"),
      );
    });
  });

  describe("casual preset", () => {
    it("adds contractions to formal text", () => {
      const input = "I do not think we will not succeed. It is fine.";
      const result = applyStylePreset(input, "casual");
      assert.ok(result.includes("don't"));
      assert.ok(result.includes("won't"));
      assert.ok(result.includes("it's"));
    });

    it("lowercases sentence starts except I", () => {
      const input = "Hello there. I am fine. Great day.";
      const result = applyStylePreset(input, "casual");
      assert.ok(result.startsWith("hello"));
      assert.ok(result.includes("I'm"));
      assert.ok(result.includes("great"));
    });

    it("is deterministic", () => {
      const input = "We are going. They will not come.";
      assert.equal(
        applyStylePreset(input, "casual"),
        applyStylePreset(input, "casual"),
      );
    });
  });

  describe("technical preset", () => {
    it("converts step sequences to numbered list", () => {
      const input = "First open the file then edit the content then save it.";
      const result = applyStylePreset(input, "technical");
      assert.ok(result.includes("1."));
      assert.ok(result.includes("2."));
      assert.ok(result.includes("3."));
    });

    it("is deterministic", () => {
      const input = "First read then write then test.";
      assert.equal(
        applyStylePreset(input, "technical"),
        applyStylePreset(input, "technical"),
      );
    });
  });

  describe("custom preset", () => {
    it("passes text through unchanged", () => {
      const input = "Hello, world! This is some text.";
      assert.equal(applyStylePreset(input, "custom"), input);
    });
  });

  it("all transforms are pure functions (no side effects)", () => {
    const input = "I just really can't believe it's basically very good.";
    const presets = getStylePresets();
    for (const preset of presets) {
      const result1 = preset.transform(input);
      const result2 = preset.transform(input);
      assert.equal(
        result1,
        result2,
        `Preset ${preset.id} is not pure/deterministic`,
      );
    }
  });
});
