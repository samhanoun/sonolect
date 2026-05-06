import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { z } from "zod";
import {
  sanitizeHtml,
  sanitizeFilePath,
  sanitizeTranscriptText,
  validateApiInput,
} from "./sanitize";

/* ── sanitizeHtml ──────────────────────────────────────────────────── */

describe("sanitizeHtml", () => {
  it("removes <script> tags and their content", () => {
    const input = '<p>Hello</p><script>alert("xss")</script><p>World</p>';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("script"));
    assert.ok(!result.includes("alert"));
    assert.ok(result.includes("Hello"));
    assert.ok(result.includes("World"));
  });

  it("removes <iframe> tags", () => {
    const input = '<iframe src="https://evil.com"></iframe>';
    assert.ok(!sanitizeHtml(input).includes("iframe"));
  });

  it("removes <object> and <embed> tags", () => {
    const input =
      '<object data="x"></object><embed src="y">';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("object"));
    assert.ok(!result.includes("embed"));
  });

  it("removes event handler attributes", () => {
    const input = '<img src="x.png" onerror="alert(1)">';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("onerror"));
    assert.ok(!result.includes("alert"));
  });

  it("removes javascript: protocol in href", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("javascript:"));
  });

  it("removes data: protocol in src", () => {
    const input = '<img src="data:text/html,<script>alert(1)</script>">';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("data:text/html"));
  });

  it("removes <svg> tags (XSS vector)", () => {
    const input = '<svg onload="alert(1)"><circle r="10"/></svg>';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("svg"));
  });

  it("removes <style> tags and their content", () => {
    const input = "<style>body { background: url('javascript:alert(1)') }</style><p>safe</p>";
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("style"));
    assert.ok(result.includes("safe"));
  });

  it("preserves safe inline HTML", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    const result = sanitizeHtml(input);
    assert.ok(result.includes("<p>"));
    assert.ok(result.includes("<strong>"));
  });

  it("handles empty and non-string input", () => {
    assert.strictEqual(sanitizeHtml(""), "");
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeHtml(null), "");
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeHtml(undefined), "");
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeHtml(42), "");
  });

  it("handles mixed-case tags", () => {
    const input = '<ScRiPt>alert(1)</ScRiPt>';
    const result = sanitizeHtml(input);
    assert.ok(!result.toLowerCase().includes("script"));
  });

  it("removes <base> tag (can redirect relative URLs)", () => {
    const input = '<base href="https://evil.com">';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("base"));
  });

  it("removes <meta> tag", () => {
    const input = '<meta http-equiv="refresh" content="0;url=evil">';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("meta"));
  });

  it("removes <form> tag", () => {
    const input = '<form action="https://evil.com"><input></form>';
    const result = sanitizeHtml(input);
    assert.ok(!result.includes("form"));
  });
});

/* ── sanitizeFilePath ──────────────────────────────────────────────── */

describe("sanitizeFilePath", () => {
  it("allows simple relative paths", () => {
    assert.strictEqual(sanitizeFilePath("uploads/file.wav"), "uploads/file.wav");
  });

  it("allows nested paths", () => {
    assert.strictEqual(
      sanitizeFilePath("a/b/c/d.txt"),
      "a/b/c/d.txt",
    );
  });

  it("rejects absolute paths (Unix)", () => {
    assert.strictEqual(sanitizeFilePath("/etc/passwd"), null);
  });

  it("rejects absolute paths (Windows)", () => {
    assert.strictEqual(sanitizeFilePath("C:\\Windows\\system32"), null);
  });

  it("strips .. path traversal segments", () => {
    const result = sanitizeFilePath("uploads/../../../etc/passwd");
    assert.ok(result === null || !result.includes(".."));
    // After stripping .., we get "uploads/etc/passwd" which is safe
  });

  it("strips . segments", () => {
    const result = sanitizeFilePath("./uploads/./file.wav");
    assert.ok(result !== null);
    assert.ok(!result.includes("./"));
  });

  it("rejects null bytes", () => {
    const result = sanitizeFilePath("file.wav\x00.exe");
    // Null byte stripped; result depends on remaining content
    assert.ok(result === null || !result.includes("\x00"));
  });

  it("rejects control characters", () => {
    const result = sanitizeFilePath("file\x01name.wav");
    assert.ok(result === null || !result.includes("\x01"));
  });

  it("rejects empty input", () => {
    assert.strictEqual(sanitizeFilePath(""), null);
  });

  it("rejects non-string input", () => {
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeFilePath(null), null);
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeFilePath(undefined), null);
  });

  it("normalises backslashes to forward slashes", () => {
    const result = sanitizeFilePath("uploads\\audio\\file.wav");
    assert.ok(result !== null);
    assert.ok(!result.includes("\\"));
    assert.strictEqual(result, "uploads/audio/file.wav");
  });

  it("rejects paths with shell metacharacters", () => {
    assert.strictEqual(sanitizeFilePath("file;rm -rf /"), null);
    assert.strictEqual(sanitizeFilePath("file$(whoami).wav"), null);
    assert.strictEqual(sanitizeFilePath("file`id`.wav"), null);
  });

  it("rejects paths with encoded traversal", () => {
    // %2e%2e = ..
    assert.strictEqual(sanitizeFilePath("uploads/%2e%2e/secret"), null);
  });
});

/* ── sanitizeTranscriptText ────────────────────────────────────────── */

describe("sanitizeTranscriptText", () => {
  it("HTML-encodes < > & characters", () => {
    const result = sanitizeTranscriptText("1 < 2 & 3 > 0");
    assert.ok(result.includes("&lt;"));
    assert.ok(result.includes("&gt;"));
    assert.ok(result.includes("&amp;"));
    assert.ok(!result.includes("<"));
    assert.ok(!result.includes(">"));
  });

  it("HTML-encodes quotes", () => {
    const result = sanitizeTranscriptText('He said "hello" & \'goodbye\'');
    assert.ok(result.includes("&quot;"));
    assert.ok(result.includes("&#x27;"));
  });

  it("strips null bytes", () => {
    const result = sanitizeTranscriptText("hello\x00world");
    assert.ok(!result.includes("\x00"));
    assert.strictEqual(result, "helloworld");
  });

  it("strips control characters but keeps newlines", () => {
    const result = sanitizeTranscriptText("line1\nline2\ttab\x01bad");
    assert.ok(result.includes("\n"));
    // Tab is collapsed to a space by whitespace normalisation, which is expected
    assert.ok(result.includes("line2 tab"));
    assert.ok(!result.includes("\x01"));
  });

  it("collapses excessive whitespace", () => {
    const result = sanitizeTranscriptText("hello     world");
    assert.strictEqual(result, "hello world");
  });

  it("collapses excessive newlines", () => {
    const result = sanitizeTranscriptText("hello\n\n\n\n\nworld");
    assert.strictEqual(result, "hello\n\nworld");
  });

  it("neutralises script injection in transcript text", () => {
    const result = sanitizeTranscriptText('<script>alert("xss")</script>');
    assert.ok(!result.includes("<script>"));
    assert.ok(result.includes("&lt;script&gt;"));
  });

  it("handles SQL injection attempts safely", () => {
    const input = "Robert'; DROP TABLE transcripts; --";
    const result = sanitizeTranscriptText(input);
    // The text is preserved (SQL injection is a DB-layer concern, but
    // the HTML encoding prevents XSS if this text is rendered)
    assert.ok(result.includes("Robert&#x27;; DROP TABLE transcripts; --"));
  });

  it("handles empty and non-string input", () => {
    assert.strictEqual(sanitizeTranscriptText(""), "");
    // @ts-expect-error deliberate bad input
    assert.strictEqual(sanitizeTranscriptText(null), "");
  });
});

/* ── validateApiInput ──────────────────────────────────────────────── */

describe("validateApiInput", () => {
  const testSchema = z.object({
    name: z.string().min(1).max(100),
    age: z.number().int().positive(),
    email: z.string().email(),
  });

  it("returns success for valid input", () => {
    const result = validateApiInput(testSchema, {
      name: "Alice",
      age: 30,
      email: "alice@example.com",
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.name, "Alice");
      assert.strictEqual(result.data.age, 30);
    }
  });

  it("returns failure with structured errors for invalid input", () => {
    const result = validateApiInput(testSchema, {
      name: "",
      age: -5,
      email: "not-an-email",
    });
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.length >= 1);
      for (const err of result.errors) {
        assert.ok(Array.isArray(err.path));
        assert.ok(typeof err.message === "string");
      }
    }
  });

  it("returns failure for completely wrong types", () => {
    const result = validateApiInput(testSchema, "not an object");
    assert.strictEqual(result.success, false);
  });

  it("returns failure for null/undefined", () => {
    const r1 = validateApiInput(testSchema, null);
    assert.strictEqual(r1.success, false);
    const r2 = validateApiInput(testSchema, undefined);
    assert.strictEqual(r2.success, false);
  });

  it("never throws an exception", () => {
    // Even with bizarre input, it should return a result, not throw
    assert.doesNotThrow(() => {
      validateApiInput(testSchema, Symbol("bad"));
    });
    assert.doesNotThrow(() => {
      validateApiInput(testSchema, () => {});
    });
  });

  it("works with nested schemas", () => {
    const nestedSchema = z.object({
      user: z.object({
        id: z.string().uuid(),
      }),
      items: z.array(z.number()),
    });

    const good = validateApiInput(nestedSchema, {
      user: { id: "550e8400-e29b-41d4-a716-446655440000" },
      items: [1, 2, 3],
    });
    assert.strictEqual(good.success, true);

    const bad = validateApiInput(nestedSchema, {
      user: { id: "not-a-uuid" },
      items: ["not", "numbers"],
    });
    assert.strictEqual(bad.success, false);
    if (!bad.success) {
      assert.ok(bad.errors.length >= 1);
    }
  });
});
