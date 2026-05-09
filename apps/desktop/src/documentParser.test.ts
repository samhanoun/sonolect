import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectDocumentType,
  parsePlainText,
  parseMarkdown,
  splitIntoSentences,
  estimateReadTime,
  filterSmartContent,
} from "./documentParser";

describe("detectDocumentType", () => {
  it("detects PDF files", () => {
    assert.equal(detectDocumentType("report.pdf"), "pdf");
    assert.equal(detectDocumentType("REPORT.PDF"), "pdf");
  });

  it("detects DOCX files", () => {
    assert.equal(detectDocumentType("letter.docx"), "docx");
    assert.equal(detectDocumentType("letter.doc"), "docx");
  });

  it("detects markdown files", () => {
    assert.equal(detectDocumentType("readme.md"), "markdown");
    assert.equal(detectDocumentType("notes.markdown"), "markdown");
  });

  it("detects text files", () => {
    assert.equal(detectDocumentType("notes.txt"), "text");
    assert.equal(detectDocumentType("log.text"), "text");
  });

  it("defaults to text for unknown extensions", () => {
    assert.equal(detectDocumentType("data.csv"), "text");
    assert.equal(detectDocumentType("archive.zip"), "text");
  });

  it("defaults to text for files with no extension", () => {
    assert.equal(detectDocumentType("Makefile"), "text");
  });
});

describe("parsePlainText", () => {
  it("parses simple text into sections", () => {
    const text = "First paragraph here.\n\nSecond paragraph here.";
    const result = parsePlainText(text, "notes.txt");

    assert.equal(result.type, "text");
    assert.equal(result.title, "First paragraph here.");
    assert.equal(result.sections.length, 2);
    assert.equal(result.sections[0]!.content, "First paragraph here.");
    assert.equal(result.sections[1]!.content, "Second paragraph here.");
  });

  it("computes word count and read time", () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const result = parsePlainText(words, "long.txt");

    assert.equal(result.metadata.wordCount, 400);
    assert.equal(result.metadata.estimatedReadTimeMinutes, 2);
  });

  it("assigns section ids", () => {
    const text = "Alpha\n\nBeta\n\nGamma";
    const result = parsePlainText(text, "test.txt");

    assert.equal(result.sections[0]!.id, "section-1");
    assert.equal(result.sections[1]!.id, "section-2");
    assert.equal(result.sections[2]!.id, "section-3");
  });

  it("preserves rawText", () => {
    const text = "Hello world";
    const result = parsePlainText(text, "test.txt");
    assert.equal(result.rawText, text);
  });
});

describe("parseMarkdown", () => {
  it("extracts headings as sections", () => {
    const md = "# Title\n\nSome content.\n\n## Subtitle\n\nMore content.";
    const result = parseMarkdown(md, "doc.md");

    assert.equal(result.type, "markdown");
    assert.equal(result.title, "Title");
    assert.equal(result.sections.length, 2);
    assert.equal(result.sections[0]!.title, "Title");
    assert.equal(result.sections[0]!.level, 1);
    assert.equal(result.sections[1]!.title, "Subtitle");
    assert.equal(result.sections[1]!.level, 2);
  });

  it("strips HTML from content", () => {
    const md = "**bold** and *italic*";
    const result = parseMarkdown(md, "test.md");

    assert.ok(!result.content.includes("<"));
    assert.ok(result.content.includes("bold"));
    assert.ok(result.content.includes("italic"));
  });

  it("uses first heading as title", () => {
    const md = "## Introduction\n\nText here.";
    const result = parseMarkdown(md, "test.md");
    assert.equal(result.title, "Introduction");
  });

  it("falls back to first line when no headings", () => {
    const md = "Just plain text without headings.";
    const result = parseMarkdown(md, "test.md");
    assert.equal(result.title, "Just plain text without headings.");
  });
});

describe("splitIntoSentences", () => {
  it("splits on period followed by space", () => {
    const sentences = splitIntoSentences("Hello world. Goodbye world.");
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0], "Hello world.");
    assert.equal(sentences[1], "Goodbye world.");
  });

  it("splits on exclamation and question marks", () => {
    const sentences = splitIntoSentences("Wow! Is it true? Yes.");
    assert.equal(sentences.length, 3);
    assert.equal(sentences[0], "Wow!");
    assert.equal(sentences[1], "Is it true?");
    assert.equal(sentences[2], "Yes.");
  });

  it("handles abbreviations", () => {
    const sentences = splitIntoSentences("Dr. Smith went home. He rested.");
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0], "Dr. Smith went home.");
    assert.equal(sentences[1], "He rested.");
  });

  it("handles Mr. and Mrs. abbreviations", () => {
    const sentences = splitIntoSentences(
      "Mr. Jones and Mrs. Jones arrived. They sat down.",
    );
    assert.equal(sentences.length, 2);
  });

  it("handles text ending without punctuation", () => {
    const sentences = splitIntoSentences("No period at end");
    assert.equal(sentences.length, 1);
    assert.equal(sentences[0], "No period at end");
  });

  it("handles newlines after sentence endings", () => {
    const sentences = splitIntoSentences("First sentence.\nSecond sentence.");
    assert.equal(sentences.length, 2);
  });

  it("returns empty array for empty string", () => {
    const sentences = splitIntoSentences("");
    assert.equal(sentences.length, 0);
  });
});

describe("estimateReadTime", () => {
  it("returns 1 minute for 200 words at default WPM", () => {
    assert.equal(estimateReadTime(200), 1);
  });

  it("rounds up to next minute", () => {
    assert.equal(estimateReadTime(201), 2);
    assert.equal(estimateReadTime(400), 2);
    assert.equal(estimateReadTime(401), 3);
  });

  it("supports custom WPM", () => {
    assert.equal(estimateReadTime(300, 300), 1);
    assert.equal(estimateReadTime(100, 100), 1);
  });

  it("returns 1 for very short text", () => {
    assert.equal(estimateReadTime(1), 1);
  });

  it("returns 0 for zero words", () => {
    assert.equal(estimateReadTime(0), 0);
  });
});

describe("filterSmartContent", () => {
  it("removes standalone page numbers", () => {
    const text = "Content here.\n\n3\n\nMore content.";
    const result = filterSmartContent(text);
    assert.ok(!result.match(/^\d+$/m));
    assert.ok(result.includes("Content here."));
    assert.ok(result.includes("More content."));
  });

  it("removes Page N of M patterns", () => {
    const text = "Content here.\n\nPage 5 of 10\n\nMore content.";
    const result = filterSmartContent(text);
    assert.ok(!result.includes("Page 5 of 10"));
  });

  it("removes citation brackets", () => {
    const text = "This is a claim [1] with references [23].";
    const result = filterSmartContent(text);
    assert.ok(!result.includes("[1]"));
    assert.ok(!result.includes("[23]"));
    assert.ok(result.includes("This is a claim"));
  });

  it("collapses multiple blank lines", () => {
    const text = "First.\n\n\n\n\nSecond.";
    const result = filterSmartContent(text);
    assert.ok(!result.includes("\n\n\n"));
    assert.ok(result.includes("First."));
    assert.ok(result.includes("Second."));
  });

  it("handles text with dashes around page numbers", () => {
    const text = "Content.\n\n- 5 -\n\nMore.";
    const result = filterSmartContent(text);
    assert.ok(!result.match(/- 5 -/));
  });
});
