/**
 * Input sanitization utilities for Sonolect.
 *
 * Protects against XSS, path traversal, and injection when accepting
 * user-provided text for storage, display, or file operations.
 */

import { z, type ZodSchema, type ZodError } from "zod";

/* ── HTML sanitization ─────────────────────────────────────────────── */

/**
 * Dangerous HTML tags that can execute scripts or load external resources.
 * Covers standard XSS vectors including event-handler-based attacks.
 */
const DANGEROUS_TAG_PATTERN =
  /<\s*\/?\s*(script|iframe|object|embed|applet|form|base|link|meta|svg|math|template|slot|portal|xmp|noscript|noembed|noframes|plaintext|frameset|frame|isindex|listing)\b[^>]*>/gi;

/**
 * Event handler attributes (onclick, onerror, onload, etc.) on any tag.
 */
const EVENT_HANDLER_PATTERN = /\s+on[a-z]+\s*=\s*["'][^"']*["']/gi;

/**
 * javascript: / vbscript: / data: protocol in href/src attributes.
 */
const DANGEROUS_PROTOCOL_PATTERN =
  /(?:href|src|action|formaction|data|background|poster)\s*=\s*["']?\s*(?:javascript|vbscript|data)\s*:/gi;

/**
 * Strip dangerous HTML elements, event handlers, and protocol schemes.
 * Leaves safe inline formatting (b, i, em, strong, p, br, ul, ol, li, a).
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string") return "";

  let result = input;

  // Remove dangerous tags (including their content for script/style)
  result = result.replace(
    /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi,
    "",
  );
  result = result.replace(
    /<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi,
    "",
  );

  // Remove remaining dangerous tags (self-closing or unclosed)
  result = result.replace(DANGEROUS_TAG_PATTERN, "");

  // Remove event handler attributes
  result = result.replace(EVENT_HANDLER_PATTERN, "");

  // Remove dangerous protocol references
  result = result.replace(DANGEROUS_PROTOCOL_PATTERN, "");

  return result.trim();
}

/* ── File path sanitization ────────────────────────────────────────── */

/**
 * Sanitise a file path to prevent directory traversal attacks.
 *
 * - Rejects absolute paths (/, C:\)
 * - Strips `..` segments
 * - Normalises separators to `/`
 * - Strips null bytes and control characters
 * - Allows only safe path characters (alphanumeric, dash, underscore, dot, slash)
 *
 * Returns null if the result would be empty or still unsafe.
 */
export function sanitizeFilePath(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null;

  // Strip null bytes and control characters
  let result = input.replace(/[\x00-\x1f\x7f]/g, "");

  // Normalise backslash to forward slash
  result = result.replace(/\\/g, "/");

  // Reject absolute paths
  if (/^\//.test(result) || /^[A-Za-z]:/.test(result)) return null;

  // Remove any `..` path segments
  const segments = result.split("/").filter((seg) => seg !== ".." && seg !== ".");

  if (segments.length === 0) return null;

  result = segments.join("/");

  // Allow only safe characters: alphanumeric, dash, underscore, dot, slash, space
  if (!/^[a-zA-Z0-9\-_./\s]+$/.test(result)) return null;

  // Ensure no double dots remain (hidden traversal)
  if (result.includes("..")) return null;

  // Ensure result is not empty after filtering
  if (result.length === 0 || result === "/") return null;

  return result;
}

/* ── Transcript text sanitization ──────────────────────────────────── */

/**
 * Sanitise transcript text for safe display and database storage.
 *
 * - HTML-encodes dangerous characters (< > & " ')
 * - Strips null bytes and most control chars (keeps \n \r \t)
 * - Trims excessive whitespace runs
 * - Does NOT strip the text of legitimate content
 */
export function sanitizeTranscriptText(input: string): string {
  if (typeof input !== "string") return "";

  let result = input;

  // Strip null bytes and control chars except newline, carriage return, tab
  result = result.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  // HTML-entity-encode dangerous chars
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  // Collapse runs of whitespace (except newlines) to single space
  result = result.replace(/[^\S\n]+/g, " ");

  // Collapse 3+ consecutive newlines to 2
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/* ── Generic Zod validation wrapper ────────────────────────────────── */

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  errors: Array<{
    path: (string | number)[];
    message: string;
  }>;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validate arbitrary input against a Zod schema with a safe,
 * structured result (no thrown exceptions).
 *
 * ```ts
 * const result = validateApiInput(createTranscriptSchema, req.body);
 * if (!result.success) return reply.code(400).send({ errors: result.errors });
 * const data = result.data; // fully typed
 * ```
 */
export function validateApiInput<T>(
  schema: ZodSchema<T>,
  input: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(input);

  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  return {
    success: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    })),
  };
}
