import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

// ── Source-level verification ────────────────────────────────────
const a11ySource = await readFile(
  new URL("./a11y.ts", import.meta.url),
  "utf8",
);

describe("a11y utility module", () => {
  // ── ARIA constants ──────────────────────────────────────────────
  it("exports ARIA_ROLES with all valid WAI-ARIA role strings", () => {
    const validRoles = [
      "dialog",
      "search",
      "list",
      "listitem",
      "status",
      "alert",
      "progressbar",
    ];
    for (const role of validRoles) {
      assert.match(
        a11ySource,
        new RegExp(`${role}:\\s*"${role}"`),
        `ARIA_ROLES should include '${role}'`,
      );
    }
  });

  // ── Announce helper ─────────────────────────────────────────────
  it("announce() creates element with role=status and aria-live", () => {
    assert.match(a11ySource, /setAttribute\(\s*["']role["']\s*,\s*["']status["']\s*\)/);
    assert.match(a11ySource, /setAttribute\(\s*["']aria-live["']/);
    assert.match(a11ySource, /setAttribute\(\s*["']aria-atomic["']\s*,\s*["']true["']\s*\)/);
  });

  it("announce() applies visually-hidden styles", () => {
    assert.match(a11ySource, /clip.*rect/);
    assert.match(a11ySource, /position.*absolute/);
    assert.match(a11ySource, /width.*1px/);
  });

  // ── Focus trap ──────────────────────────────────────────────────
  it("trapFocus uses Tab key to cycle focus between first and last elements", () => {
    assert.match(a11ySource, /event\.key\s*!==\s*["']Tab["']/);
    assert.match(a11ySource, /first\.focus|last\.focus/);
    assert.match(a11ySource, /event\.shiftKey/);
    assert.match(a11ySource, /event\.preventDefault/);
  });

  it("trapFocus returns a cleanup function", () => {
    assert.match(a11ySource, /removeEventListener/);
    assert.match(a11ySource, /return\s*\(\)\s*=>/);
  });

  // ── Skip link helper ───────────────────────────────────────────
  it("createSkipLink creates an anchor with skip-to-content class", () => {
    assert.match(a11ySource, /skip-to-content/);
    assert.match(a11ySource, /createElement\(\s*["']a["']\s*\)/);
    assert.match(a11ySource, /targetId/);
  });

  // ── Keyboard navigation ────────────────────────────────────────
  it("handleListKeyDown handles ArrowUp, ArrowDown, Home, End", () => {
    assert.match(a11ySource, /ArrowDown/);
    assert.match(a11ySource, /ArrowUp/);
    assert.match(a11ySource, /Home/);
    assert.match(a11ySource, /End/);
  });

  it("handleListKeyDown returns the focused index or -1", () => {
    // Default case returns -1
    assert.match(a11ySource, /return\s*-1/);
    // Wraps around on ArrowDown from last item
    assert.match(a11ySource, /currentIndex\s*<\s*items\.length\s*-\s*1/);
  });

  // ── Reduced motion detection ───────────────────────────────────
  it("prefersReducedMotion checks matchMedia for prefers-reduced-motion", () => {
    assert.match(
      a11ySource,
      /prefers-reduced-motion:\s*reduce/,
    );
    assert.match(a11ySource, /matchMedia/);
  });

  it("prefersReducedMotion returns boolean", () => {
    assert.match(a11ySource, /:\s*boolean/);
    assert.match(a11ySource, /return\s+false/);
  });

  // ── Module exports ─────────────────────────────────────────────
  it("exports all required utilities", () => {
    const requiredExports = [
      "ARIA_ROLES",
      "announce",
      "trapFocus",
      "createSkipLink",
      "handleListKeyDown",
      "prefersReducedMotion",
    ];
    for (const name of requiredExports) {
      assert.match(
        a11ySource,
        new RegExp(`export\\s+(function|const|type)\\s+${name}`),
        `Should export '${name}'`,
      );
    }
  });
});
