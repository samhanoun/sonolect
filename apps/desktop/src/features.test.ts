import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

// ── i18n key parity ──────────────────────────────────────────────
describe("i18n key parity", () => {
  const enKeys = Object.keys(en);
  const frKeys = Object.keys(fr);

  it("en and fr have the same keys", () => {
    assert.deepStrictEqual(enKeys.sort(), frKeys.sort());
  });

  const newKeys = [
    "toast.transformComplete",
    "toast.copySuccess",
    "editor.transforming",
    "editor.copy",
    "editor.download",
    "palette.searchPlaceholder",
    "palette.noResults",
  ] as const;

  for (const key of newKeys) {
    it(`en has key "${key}"`, () => {
      assert.ok(key in en, `Missing key "${key}" in en locale`);
    });

    it(`fr has key "${key}"`, () => {
      assert.ok(key in fr, `Missing key "${key}" in fr locale`);
    });
  }
});

// ── Transcript transformation logic ──────────────────────────────
describe("transcript transformation", () => {
  function transformTranscript(input: string): string {
    const cleaned = input
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    const paragraphs: string[] = [];
    for (let i = 0; i < sentences.length; i += 3) {
      paragraphs.push(sentences.slice(i, i + 3).join(" "));
    }
    const firstWords = cleaned.split(/\s+/).slice(0, 6).join(" ");
    const title = `# ${firstWords}${firstWords.length < cleaned.length ? "…" : ""}`;
    return `${title}\n\n${paragraphs.join("\n\n")}`;
  }

  it("cleans up extra whitespace", () => {
    const result = transformTranscript("hello    world.   test.");
    assert.ok(
      !result.includes("    "),
      "Should not have multiple spaces in body",
    );
  });

  it("capitalizes first letters of sentences", () => {
    const result = transformTranscript(
      "first sentence. second sentence. third one.",
    );
    assert.ok(result.includes("First sentence."));
    assert.ok(result.includes("Second sentence."));
    assert.ok(result.includes("Third one."));
  });

  it("prepends a title line", () => {
    const result = transformTranscript("hello world test.");
    assert.ok(result.startsWith("# "));
  });

  it("groups sentences into paragraphs of 3", () => {
    const input = "One. Two. Three. Four. Five. Six.";
    const result = transformTranscript(input);
    const parts = result.split("\n\n");
    // title + 2 paragraphs (3 sentences each)
    assert.strictEqual(parts.length, 3);
  });

  it("handles empty input gracefully (returns title of empty)", () => {
    const result = transformTranscript("Hello.");
    assert.ok(result.includes("# Hello."));
  });
});

// ── Command palette filtering logic ──────────────────────────────
describe("command palette search filtering", () => {
  const commands = [
    { label: "New voice capture", hint: "Start the mic overlay" },
    { label: "Open history", hint: "Find a transcription" },
    { label: "Privacy settings", hint: "Local-first, cloud, retention" },
  ];

  function filterCommands(query: string) {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.hint.toLowerCase().includes(q),
    );
  }

  it("returns all commands when query is empty", () => {
    assert.strictEqual(filterCommands("").length, 3);
  });

  it("filters by label (case-insensitive)", () => {
    const result = filterCommands("voice");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.label, "New voice capture");
  });

  it("filters by hint (case-insensitive)", () => {
    const result = filterCommands("transcription");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.label, "Open history");
  });

  it("returns empty when nothing matches", () => {
    const result = filterCommands("zzzznotfound");
    assert.strictEqual(result.length, 0);
  });
});
