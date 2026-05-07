/**
 * Extension integration tests — tests the SDK functions that the
 * VS Code extension relies on. These run with node:test and do NOT
 * require the VS Code test runner.
 *
 * The actual VS Code extension (activate/deactivate, commands) requires
 * the @vscode/test-electron runner and is tested separately.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectCodeLanguage,
  formatForCode,
  suggestInsertMode,
  buildCodeContext,
  buildCodePrompt,
} from "@sonolect/sdk/src/ideClient";
import type { IdeContext } from "@sonolect/sdk/src/ideClient";

/* ── Language detection from file extension ──────────────────────── */

describe("Extension: language detection", () => {
  it("detects TypeScript for .ts files", () => {
    assert.strictEqual(detectCodeLanguage("src/app.ts"), "typescript");
  });

  it("detects Python for .py files", () => {
    assert.strictEqual(detectCodeLanguage("main.py"), "python");
  });

  it("detects Rust for .rs files", () => {
    assert.strictEqual(detectCodeLanguage("lib.rs"), "rust");
  });

  it("detects Go for .go files", () => {
    assert.strictEqual(detectCodeLanguage("server.go"), "go");
  });

  it('returns "plaintext" for unknown extensions', () => {
    assert.strictEqual(detectCodeLanguage("notes.txt"), "plaintext");
  });
});

/* ── Code formatting ─────────────────────────────────────────────── */

describe("Extension: code formatting", () => {
  it("applies camelCase for JavaScript identifiers", () => {
    assert.strictEqual(
      formatForCode("get user data", "javascript"),
      "getUserData",
    );
  });

  it("applies camelCase for TypeScript identifiers", () => {
    assert.strictEqual(formatForCode("is loading", "typescript"), "isLoading");
  });

  it("applies snake_case for Python identifiers", () => {
    assert.strictEqual(
      formatForCode("get user data", "python"),
      "get_user_data",
    );
  });

  it("applies snake_case for Rust identifiers", () => {
    assert.strictEqual(formatForCode("parse input", "rust"), "parse_input");
  });

  it("adds semicolons for C-family statements", () => {
    assert.strictEqual(
      formatForCode("console.log(x)", "typescript"),
      "console.log(x);",
    );
  });

  it("does not double-add semicolons", () => {
    assert.strictEqual(formatForCode("return x;", "typescript"), "return x;");
  });

  it("does not add semicolons for Python", () => {
    assert.strictEqual(formatForCode("print(x)", "python"), "print(x)");
  });
});

/* ── Insert mode suggestion ──────────────────────────────────────── */

describe("Extension: insert mode suggestion", () => {
  const ctx: IdeContext = {
    fileName: "index.ts",
    language: "typescript",
    cursorLine: 10,
    cursorColumn: 0,
  };

  it("suggests selection when text is selected", () => {
    const withSelection = { ...ctx, selectedText: "old" };
    assert.strictEqual(suggestInsertMode(withSelection, "new"), "selection");
  });

  it("suggests newline for multi-line dictation", () => {
    assert.strictEqual(suggestInsertMode(ctx, "line one\nline two"), "newline");
  });

  it("suggests cursor for single-line text", () => {
    assert.strictEqual(suggestInsertMode(ctx, "hello world"), "cursor");
  });

  it("suggests cursor for comments", () => {
    assert.strictEqual(suggestInsertMode(ctx, "// a comment"), "cursor");
  });
});

/* ── Context building ────────────────────────────────────────────── */

describe("Extension: context building", () => {
  it("builds context from editor state", () => {
    const ctx = buildCodeContext(
      "src/utils.ts",
      "typescript",
      "selectedCode",
      "const x = 1;",
    );
    assert.strictEqual(ctx.fileName, "src/utils.ts");
    assert.strictEqual(ctx.language, "typescript");
    assert.strictEqual(ctx.selectedText, "selectedCode");
    assert.strictEqual(ctx.surroundingText, "const x = 1;");
  });

  it("builds a code prompt with language and identifiers", () => {
    const ctx: IdeContext = {
      fileName: "utils.ts",
      language: "typescript",
      cursorLine: 5,
      cursorColumn: 0,
      surroundingText: "function calculateTotal(items: Item[]) { return sum; }",
    };
    const prompt = buildCodePrompt(ctx);
    assert.ok(prompt.includes("typescript"));
    assert.ok(prompt.includes("calculateTotal"));
  });
});
