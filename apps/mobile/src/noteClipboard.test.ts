import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HTML_PREFIX,
  escapeHtml,
  noteClipboard,
  noteToHtml,
} from "./noteClipboard";

describe("noteToHtml", () => {
  it("keeps paragraphs and line breaks", () => {
    assert.equal(
      noteToHtml("First line\nsecond line\n\nNew paragraph"),
      `${HTML_PREFIX}<p>First line<br>\nsecond line</p>\n<p>New paragraph</p>`,
    );
  });

  it("turns bullet and numbered lines into lists", () => {
    assert.equal(
      noteToHtml("Tasks\n- buy milk\n* call Sam\n1. first\n2) second"),
      `${HTML_PREFIX}<p>Tasks</p>\n<ul>\n<li>buy milk</li>\n<li>call Sam</li>\n</ul>\n` +
        `<ol>\n<li>first</li>\n<li>second</li>\n</ol>`,
    );
  });

  it("escapes what HTML would read as markup", () => {
    assert.equal(
      escapeHtml(`<a href="x">&</a>`),
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
    assert.equal(
      noteToHtml("a < b & c"),
      `${HTML_PREFIX}<p>a &lt; b &amp; c</p>`,
    );
  });

  it("declares UTF-8 so iOS reads accents right", () => {
    assert.ok(noteToHtml("été").startsWith('<meta charset="utf-8">'));
  });

  it("gives nothing for an empty note", () => {
    assert.equal(noteToHtml(" \n\n "), "");
  });
});

describe("noteClipboard", () => {
  it("keeps the note's own text as the plain text", () => {
    const text = "Tasks\r\n- one\r\n- two";
    const clip = noteClipboard(text);
    assert.equal(clip.text, text);
    assert.ok(clip.html.includes("<li>one</li>"));
  });
});
