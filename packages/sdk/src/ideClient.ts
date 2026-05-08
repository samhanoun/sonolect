/* ── Types ────────────────────────────────────────────────────────── */

export type IdeContext = {
  fileName: string;
  language: string;
  cursorLine: number;
  cursorColumn: number;
  selectedText?: string | undefined;
  surroundingText?: string | undefined;
};

export type IdeDictationResult = {
  text: string;
  insertPosition: "cursor" | "selection" | "newline";
  language?: string;
};

export type IdeConfig = {
  apiUrl: string;
  authToken?: string;
  autoInsert: boolean;
  codeAware: boolean;
};

/* ── Language detection ───────────────────────────────────────────── */

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".php": "php",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".r": "r",
  ".R": "r",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".zig": "zig",
  ".vue": "vue",
  ".svelte": "svelte",
};

/**
 * Infer the programming language from a file name / path.
 * Returns the last extension match (e.g. `foo.test.ts` -> `typescript`).
 */
export function detectCodeLanguage(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "plaintext";
  const ext = fileName.slice(dotIndex).toLowerCase();
  return EXTENSION_MAP[ext] ?? "plaintext";
}

/* ── Context building ────────────────────────────────────────────── */

/**
 * Build an IDE context object from editor state.
 */
export function buildCodeContext(
  fileName: string,
  language: string,
  selectedText: string | undefined,
  surroundingLines: string | undefined,
): IdeContext {
  return {
    fileName,
    language,
    cursorLine: 0,
    cursorColumn: 0,
    selectedText: selectedText || undefined,
    surroundingText: surroundingLines || undefined,
  };
}

/* ── Code formatting ─────────────────────────────────────────────── */

const CAMEL_CASE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "java",
  "kotlin",
  "dart",
  "swift",
]);

const SNAKE_CASE_LANGUAGES = new Set([
  "python",
  "rust",
  "ruby",
  "elixir",
  "erlang",
  "c",
  "cpp",
]);

const SEMICOLON_LANGUAGES = new Set([
  "javascript",
  "typescript",
  "java",
  "csharp",
  "cpp",
  "c",
  "php",
  "dart",
  "kotlin",
]);

function toCamelCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
}

function toSnakeCase(text: string): string {
  return text.toLowerCase().split(/\s+/).join("_");
}

/**
 * Check whether the dictated text looks like an identifier
 * (all lowercase words, no punctuation other than spaces).
 */
function looksLikeIdentifier(text: string): boolean {
  return /^[a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)+$/.test(text.trim());
}

/**
 * Adapt dictated text for a given code language.
 *
 * - If the text looks like a multi-word identifier, convert to
 *   camelCase for JS/TS/Java or snake_case for Python/Rust.
 * - If the text looks like a statement (ends without punctuation),
 *   add a trailing semicolon for C-family languages.
 */
export function formatForCode(text: string, language: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // If text looks like a multi-word identifier, apply naming convention
  if (looksLikeIdentifier(trimmed)) {
    if (CAMEL_CASE_LANGUAGES.has(language)) return toCamelCase(trimmed);
    if (SNAKE_CASE_LANGUAGES.has(language)) return toSnakeCase(trimmed);
  }

  // For statement-like text: add semicolon for C-family if missing
  if (SEMICOLON_LANGUAGES.has(language)) {
    const last = trimmed[trimmed.length - 1];
    if (last && !/[;{,.]/.test(last)) {
      return trimmed + ";";
    }
  }

  return trimmed;
}

/* ── Whisper prompt building ─────────────────────────────────────── */

/**
 * Build a Whisper prompt seeded with code terms from the surrounding
 * context so the model is more likely to transcribe technical jargon
 * correctly.
 */
export function buildCodePrompt(context: IdeContext): string {
  const parts: string[] = [];

  parts.push(`Programming language: ${context.language}.`);

  // Extract likely identifiers from surrounding text
  if (context.surroundingText) {
    const identifiers = extractIdentifiers(context.surroundingText);
    if (identifiers.length > 0) {
      parts.push(`Code terms: ${identifiers.join(", ")}.`);
    }
  }

  if (context.selectedText) {
    parts.push(`Selected: ${context.selectedText}`);
  }

  return parts.join(" ");
}

/**
 * Extract probable identifier names from source code text.
 * Finds camelCase, snake_case, PascalCase, and SCREAMING_SNAKE tokens.
 */
function extractIdentifiers(code: string): string[] {
  const tokens = code.match(
    /\b[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?\b/g,
  );
  if (!tokens) return [];

  const keywords = new Set([
    "const",
    "let",
    "var",
    "function",
    "class",
    "if",
    "else",
    "return",
    "import",
    "export",
    "from",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "this",
    "super",
    "true",
    "false",
    "null",
    "undefined",
    "void",
    "typeof",
    "instanceof",
    "async",
    "await",
    "try",
    "catch",
    "throw",
    "finally",
    "def",
    "self",
    "None",
    "True",
    "False",
    "fn",
    "pub",
    "mod",
    "use",
    "impl",
    "struct",
    "enum",
    "trait",
    "type",
    "interface",
  ]);

  const unique = new Set<string>();
  for (const t of tokens) {
    if (t.length > 2 && !keywords.has(t)) {
      unique.add(t);
    }
  }

  return [...unique].slice(0, 20);
}

/* ── Insert mode suggestion ──────────────────────────────────────── */

/**
 * Suggest the best insertion mode for the dictated text given
 * the current editor context.
 *
 * - If there is a selection, replace it.
 * - If the text looks like a comment (starts with `//`, `#`, etc.), insert at cursor.
 * - If the text is multi-line, insert as a new line.
 * - Otherwise, insert at cursor.
 */
export function suggestInsertMode(
  context: IdeContext,
  text: string,
): "cursor" | "selection" | "newline" {
  // If editor has selected text, replace the selection
  if (context.selectedText) {
    return "selection";
  }

  const trimmed = text.trim();

  // Multi-line text -> newline insertion
  if (trimmed.includes("\n")) {
    return "newline";
  }

  // Comment-like text -> insert at cursor
  if (/^(?:\/\/|#|\/\*|\*|<!--)/.test(trimmed)) {
    return "cursor";
  }

  return "cursor";
}
