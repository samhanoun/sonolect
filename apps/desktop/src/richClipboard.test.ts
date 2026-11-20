import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  copyTranscript,
  textToHtml,
  transcriptClipboard,
} from "./richClipboard";

describe("copy with formatting", () => {
  it("keeps paragraphs and line breaks", () => {
    assert.equal(
      textToHtml("First point.\nSame paragraph.\n\nSecond point.\r\n\r\n"),
      "<p>First point.<br>Same paragraph.</p><p>Second point.</p>",
    );
    assert.equal(textToHtml(""), "");
  });

  it("turns light Markdown into headings, lists and emphasis", () => {
    assert.equal(
      textToHtml(
        [
          "# Meeting notes",
          "## Decisions",
          "- Ship **Friday**",
          "- Ask *Ana* about `v2`",
          "",
          "1. First",
          "2) Second",
          "Then _done_.",
        ].join("\n"),
      ),
      "<h1>Meeting notes</h1><h2>Decisions</h2>" +
        "<ul><li>Ship <strong>Friday</strong></li><li>Ask <em>Ana</em> about <code>v2</code></li></ul>" +
        "<ol><li>First</li><li>Second</li></ol>" +
        "<p>Then <em>done</em>.</p>",
    );
  });

  it("leaves ordinary asterisks, underscores and numbers alone", () => {
    assert.equal(
      textToHtml("2 * 3 * 4 and snake_case_name, 5 stars: *****"),
      "<p>2 * 3 * 4 and snake_case_name, 5 stars: *****</p>",
    );
    assert.equal(textToHtml("2026 was a year."), "<p>2026 was a year.</p>");
  });

  it("never lets the text become markup", () => {
    assert.equal(
      textToHtml('<img src=x onerror="alert(1)"> & **<b>bold</b>**'),
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; <strong>&lt;b&gt;bold&lt;/b&gt;</strong></p>",
    );
    assert.equal(
      transcriptClipboard("x", [{ text: "Hi", speaker: "<script>" }]).html,
      "<p><strong>&lt;script&gt;:</strong> Hi</p>",
    );
  });

  it("starts a paragraph with the name at each change of speaker", () => {
    const content = transcriptClipboard("ignored when speakers exist", [
      { text: "Good morning.", speaker: "Ana" },
      { text: " Shall we start? ", speaker: "Ana" },
      { text: "Yes.", speaker: "Ben" },
      { text: "" },
      { text: "Someone coughs." },
      { text: "Right.", speaker: "Ana" },
    ]);
    assert.equal(
      content.text,
      "Ana: Good morning. Shall we start?\n\nBen: Yes.\n\nSomeone coughs.\n\nAna: Right.",
    );
    assert.equal(
      content.html,
      "<p><strong>Ana:</strong> Good morning. Shall we start?</p>" +
        "<p><strong>Ben:</strong> Yes.</p><p>Someone coughs.</p>" +
        "<p><strong>Ana:</strong> Right.</p>",
    );
  });

  it("uses the text as written when nobody is named", () => {
    const content = transcriptClipboard("One.\n\nTwo.", [
      { text: "One." },
      { text: "Two." },
    ]);
    assert.deepEqual(content, {
      text: "One.\n\nTwo.",
      html: "<p>One.</p><p>Two.</p>",
    });
  });

  it("falls back to plain text when rich copy is unavailable or refused", async () => {
    const written: string[] = [];
    const plainOnly = {
      writeText: async (text: string) => void written.push(text),
    } as unknown as Clipboard;
    assert.equal(await copyTranscript("Hello.", [], plainOnly), "plain");
    assert.deepEqual(written, ["Hello."]);

    const scope = globalThis as { ClipboardItem?: unknown };
    const original = scope.ClipboardItem;
    scope.ClipboardItem = class {
      constructor(readonly items: Record<string, Blob>) {}
    };
    try {
      const rich: Record<string, Blob>[] = [];
      const working = {
        write: async (items: { items: Record<string, Blob> }[]) =>
          void rich.push(items[0]!.items),
        writeText: async (text: string) => void written.push(text),
      } as unknown as Clipboard;
      assert.equal(await copyTranscript("**Hi**", [], working), "rich");
      assert.equal(
        await rich[0]!["text/html"]!.text(),
        "<p><strong>Hi</strong></p>",
      );
      assert.equal(await rich[0]!["text/plain"]!.text(), "**Hi**");

      const refusing = {
        write: async () => {
          throw new Error("NotAllowedError");
        },
        writeText: async (text: string) => void written.push(text),
      } as unknown as Clipboard;
      assert.equal(await copyTranscript("Later.", [], refusing), "plain");
      assert.equal(written.at(-1), "Later.");
    } finally {
      scope.ClipboardItem = original;
    }
  });
});
