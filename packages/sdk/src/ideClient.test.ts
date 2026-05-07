import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectCodeLanguage,
  buildCodeContext,
  formatForCode,
  buildCodePrompt,
  suggestInsertMode,
} from "./ideClient";
import type { IdeContext } from "./ideClient";

/* ── detectCodeLanguage ──────────────────────────────────────────── */

describe("detectCodeLanguage", () => {
  it("detects TypeScript from .ts extension", () => {
    assert.strictEqual(detectCodeLanguage("app.ts"), "typescript");
  });

  it("detects TypeScript from .tsx extension", () => {
    assert.strictEqual(detectCodeLanguage("Component.tsx"), "typescript");
  });

  it("detects JavaScript from .js extension", () => {
    assert.strictEqual(detectCodeLanguage("main.js"), "javascript");
  });

  it("detects Python from .py extension", () => {
    assert.strictEqual(detectCodeLanguage("script.py"), "python");
  });

  it("detects Rust from .rs extension", () => {
    assert.strictEqual(detectCodeLanguage("lib.rs"), "rust");
  });

  it("detects Go from .go extension", () => {
    assert.strictEqual(detectCodeLanguage("main.go"), "go");
  });

  it("handles files with multiple dots (uses last extension)", () => {
    assert.strictEqual(detectCodeLanguage("foo.test.ts"), "typescript");
  });

  it("handles full paths", () => {
    assert.strictEqual(
      detectCodeLanguage("/home/user/project/src/index.ts"),
      "typescript",
    );
  });

  it('returns "plaintext" for unknown extensions', () => {
    assert.strictEqual(detectCodeLanguage("data.xyz"), "plaintext");
  });

  it('returns "plaintext" for files without extensions', () => {
    assert.strictEqual(detectCodeLanguage("Makefile"), "plaintext");
  });

  it("is case-insensitive on extension", () => {
    assert.strictEqual(detectCodeLanguage("Main.PY"), "python");
  });

  it("detects shell scripts", () => {
    assert.strictEqual(detectCodeLanguage("deploy.sh"), "shell");
  });

  it("detects C files", () => {
    assert.strictEqual(detectCodeLanguage("main.c"), "c");
  });

  it("detects C++ from .cpp", () => {
    assert.strictEqual(detectCodeLanguage("engine.cpp"), "cpp");
  });

  it("detects Ruby from .rb", () => {
    assert.strictEqual(detectCodeLanguage("app.rb"), "ruby");
  });

  it("detects YAML from .yml", () => {
    assert.strictEqual(detectCodeLanguage("config.yml"), "yaml");
  });
});

/* ── formatForCode ───────────────────────────────────────────────── */

describe("formatForCode", () => {
  it("converts multi-word identifier to camelCase for TypeScript", () => {
    assert.strictEqual(
      formatForCode("get user name", "typescript"),
      "getUserName",
    );
  });

  it("converts multi-word identifier to camelCase for JavaScript", () => {
    assert.strictEqual(formatForCode("is valid", "javascript"), "isValid");
  });

  it("converts multi-word identifier to snake_case for Python", () => {
    assert.strictEqual(
      formatForCode("get user name", "python"),
      "get_user_name",
    );
  });

  it("converts multi-word identifier to snake_case for Rust", () => {
    assert.strictEqual(
      formatForCode("parse input data", "rust"),
      "parse_input_data",
    );
  });

  it("adds semicolon to statement-like text for TypeScript", () => {
    assert.strictEqual(
      formatForCode("console.log(x)", "typescript"),
      "console.log(x);",
    );
  });

  it("adds semicolon for Java", () => {
    assert.strictEqual(
      formatForCode("System.out.println", "java"),
      "System.out.println;",
    );
  });

  it("does not add semicolon if text already ends with one", () => {
    assert.strictEqual(
      formatForCode("console.log(x);", "typescript"),
      "console.log(x);",
    );
  });

  it("does not add semicolon for Python", () => {
    assert.strictEqual(formatForCode("print(x)", "python"), "print(x)");
  });

  it("does not add semicolon if text ends with a brace", () => {
    assert.strictEqual(formatForCode("if (x) {", "typescript"), "if (x) {");
  });

  it("returns empty string for empty input", () => {
    assert.strictEqual(formatForCode("", "typescript"), "");
  });

  it("returns trimmed text for plaintext language", () => {
    assert.strictEqual(
      formatForCode("  hello world  ", "plaintext"),
      "hello world",
    );
  });

  it("does not modify single-word text in camelCase languages", () => {
    assert.strictEqual(formatForCode("result", "typescript"), "result;");
  });
});

/* ── buildCodeContext ────────────────────────────────────────────── */

describe("buildCodeContext", () => {
  it("builds a context object with all fields", () => {
    const ctx = buildCodeContext(
      "index.ts",
      "typescript",
      "const x = 1",
      "const y = 2;\nconst z = 3;",
    );

    assert.strictEqual(ctx.fileName, "index.ts");
    assert.strictEqual(ctx.language, "typescript");
    assert.strictEqual(ctx.cursorLine, 0);
    assert.strictEqual(ctx.cursorColumn, 0);
    assert.strictEqual(ctx.selectedText, "const x = 1");
    assert.strictEqual(ctx.surroundingText, "const y = 2;\nconst z = 3;");
  });

  it("leaves selectedText as undefined when empty string", () => {
    const ctx = buildCodeContext("main.py", "python", "", undefined);
    assert.strictEqual(ctx.selectedText, undefined);
  });

  it("leaves surroundingText as undefined when not provided", () => {
    const ctx = buildCodeContext("main.py", "python", undefined, undefined);
    assert.strictEqual(ctx.surroundingText, undefined);
  });
});

/* ── buildCodePrompt ─────────────────────────────────────────────── */

describe("buildCodePrompt", () => {
  it("includes the language name", () => {
    const ctx: IdeContext = {
      fileName: "app.ts",
      language: "typescript",
      cursorLine: 10,
      cursorColumn: 5,
    };
    const prompt = buildCodePrompt(ctx);
    assert.ok(prompt.includes("typescript"));
  });

  it("includes identifiers from surrounding text", () => {
    const ctx: IdeContext = {
      fileName: "app.ts",
      language: "typescript",
      cursorLine: 10,
      cursorColumn: 5,
      surroundingText: "const getUserName = () => fetchProfile();",
    };
    const prompt = buildCodePrompt(ctx);
    assert.ok(prompt.includes("getUserName"));
    assert.ok(prompt.includes("fetchProfile"));
  });

  it("includes selected text", () => {
    const ctx: IdeContext = {
      fileName: "app.ts",
      language: "typescript",
      cursorLine: 10,
      cursorColumn: 5,
      selectedText: "console.log(x)",
    };
    const prompt = buildCodePrompt(ctx);
    assert.ok(prompt.includes("console.log(x)"));
  });

  it("excludes common keywords from identifiers", () => {
    const ctx: IdeContext = {
      fileName: "app.ts",
      language: "typescript",
      cursorLine: 10,
      cursorColumn: 5,
      surroundingText: "const myVar = true;",
    };
    const prompt = buildCodePrompt(ctx);
    assert.ok(prompt.includes("myVar"));
    // "const" and "true" should not appear as code terms
    assert.ok(!prompt.includes("Code terms: const"));
  });
});

/* ── suggestInsertMode ───────────────────────────────────────────── */

describe("suggestInsertMode", () => {
  const baseContext: IdeContext = {
    fileName: "app.ts",
    language: "typescript",
    cursorLine: 10,
    cursorColumn: 5,
  };

  it('returns "selection" when editor has selected text', () => {
    const ctx = { ...baseContext, selectedText: "old code" };
    assert.strictEqual(suggestInsertMode(ctx, "new code"), "selection");
  });

  it('returns "newline" for multi-line text', () => {
    assert.strictEqual(
      suggestInsertMode(baseContext, "line one\nline two"),
      "newline",
    );
  });

  it('returns "cursor" for comment-like text', () => {
    assert.strictEqual(
      suggestInsertMode(baseContext, "// this is a comment"),
      "cursor",
    );
  });

  it('returns "cursor" for hash comments', () => {
    assert.strictEqual(
      suggestInsertMode(baseContext, "# Python comment"),
      "cursor",
    );
  });

  it('returns "cursor" for regular single-line text', () => {
    assert.strictEqual(
      suggestInsertMode(baseContext, "const x = 42"),
      "cursor",
    );
  });

  it('"selection" takes priority over multi-line', () => {
    const ctx = { ...baseContext, selectedText: "selected" };
    assert.strictEqual(
      suggestInsertMode(ctx, "line one\nline two"),
      "selection",
    );
  });
});
