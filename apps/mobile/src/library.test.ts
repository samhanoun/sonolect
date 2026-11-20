import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TranscriptTurn } from "./domain";
import { normalizeSettings } from "./domain";
import { STRINGS } from "./i18n";
import {
  exportAsMarkdown,
  exportFileName,
  filterHistory,
  formatDuration,
  formatNoteDate,
  formattingLocale,
  sortHistory,
} from "./library";
import { isAllowedApiUrl } from "./localApi";
import { TranscriptAccumulator, levelFromVolume } from "./speechPolicy";

const turn = (overrides: Partial<TranscriptTurn>): TranscriptTurn => ({
  id: "t",
  rawText: "raw",
  refinedText: "refined",
  mode: "dictate",
  language: "en-US",
  privacyMode: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  durationMs: 1000,
  source: "microphone",
  syncState: "local",
  ...overrides,
});

describe("library", () => {
  const history = [
    turn({
      id: "a",
      refinedText: "Client summary due at four",
      createdAt: "2026-11-01T10:00:00.000Z",
    }),
    turn({
      id: "b",
      refinedText: "Product sync notes",
      mode: "summarize",
      createdAt: "2026-11-02T10:00:00.000Z",
    }),
    turn({
      id: "c",
      refinedText: "• Book room",
      mode: "task_creation",
      pinned: true,
      createdAt: "2026-10-30T10:00:00.000Z",
    }),
  ];

  it("filters by search text and category", () => {
    assert.deepEqual(
      filterHistory(history, "CLIENT", "all").map((t) => t.id),
      ["a"],
    );
    assert.deepEqual(
      filterHistory(history, "", "summaries").map((t) => t.id),
      ["b"],
    );
    assert.deepEqual(
      filterHistory(history, "", "tasks").map((t) => t.id),
      ["c"],
    );
    assert.deepEqual(
      filterHistory(history, "", "pinned").map((t) => t.id),
      ["c"],
    );
  });

  it("sorts pinned first, then newest", () => {
    assert.deepEqual(
      sortHistory(history).map((t) => t.id),
      ["c", "b", "a"],
    );
  });

  it("formats durations and exports markdown", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(75_400), "1:15");
    assert.match(
      exportAsMarkdown(history.slice(0, 1)),
      /^## 2026-11-01 10:00 · dictate\n\nClient summary due at four$/,
    );
  });

  it("exports with the phone's date format and mode names (ux-23)", () => {
    const late = turn({
      refinedText: "• Book room",
      mode: "task_creation",
      createdAt: "2026-11-08T22:30:00.000Z",
    });
    const markdown = exportAsMarkdown([late, history[1]!], {
      formatDate: (iso) => formatNoteDate(iso, "en-US", "America/New_York"),
      modeLabel: (mode) => STRINGS.en.modeTag[mode] ?? mode,
    });
    // Older ICU versions put a narrow no-break space before PM.
    assert.equal(
      markdown.replace(/[^\S\n]/g, " "),
      "## Nov 8, 2026, 05:30 PM · TASKS\n\n• Book room\n\n" +
        "## Nov 2, 2026, 05:00 AM · SUMMARY\n\nProduct sync notes",
    );
  });

  it("formats note dates in the phone's time zone", () => {
    const iso = "2026-11-08T22:30:00.000Z";
    assert.equal(
      formatNoteDate(iso, "en-GB", "Europe/London"),
      "8 Nov 2026, 22:30",
    );
    // 22:30 UTC is 17:30 the same day in New York, 08:30 the next in Sydney.
    assert.match(formatNoteDate(iso, "en-US", "America/New_York"), /^Nov 8,/);
    assert.match(formatNoteDate(iso, "en-US", "America/New_York"), /05:30/);
    assert.match(
      formatNoteDate(iso, "fr", "Australia/Sydney"),
      /^9 nov\. 2026/,
    );
    assert.match(formatNoteDate(iso, "fr", "Australia/Sydney"), /09:30/);
    assert.equal(formatNoteDate("not a date", "en"), "not a date");
  });

  it("names export files with the local date", () => {
    assert.equal(
      exportFileName(new Date(2026, 0, 5, 23, 59)),
      "sonolect-notes-2026-01-05.md",
    );
    assert.equal(
      exportFileName(new Date(2026, 10, 12, 0, 1)),
      "sonolect-notes-2026-11-12.md",
    );
  });

  it("uses the device's formats only when it speaks the UI language", () => {
    assert.equal(formattingLocale("fr", "fr-CA"), undefined);
    assert.equal(formattingLocale("en", "en-GB"), undefined);
    assert.equal(formattingLocale("fr", "en-US"), "fr");
    assert.equal(formattingLocale("en", "fr-FR"), "en");
    assert.equal(formattingLocale("en", undefined), "en");
    assert.equal(formattingLocale("fr", "fr_BE"), undefined);
  });
});

describe("settings and safety", () => {
  it("migrates settings from older versions", () => {
    const settings = normalizeSettings({
      language: "auto" as never,
      speechRate: 9,
    });
    assert.equal(settings.language, "en-US");
    assert.equal(settings.speechRate, 2);
    assert.equal(settings.uiLanguage, "en");
  });

  it("only sends data to https or local-network http endpoints", () => {
    assert.equal(isAllowedApiUrl("https://api.sonolect.app"), true);
    assert.equal(isAllowedApiUrl("http://192.168.1.20:8787"), true);
    assert.equal(isAllowedApiUrl("http://localhost:8787"), true);
    assert.equal(isAllowedApiUrl("http://example.com"), false);
    assert.equal(isAllowedApiUrl("https://user:pass@example.com"), false);
    assert.equal(isAllowedApiUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedApiUrl("not a url"), false);
  });

  it("ships every UI string in both languages", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) =>
            keys(child, `${prefix}${key}.`),
          )
        : [prefix];
    assert.deepEqual(keys(STRINGS.fr).sort(), keys(STRINGS.en).sort());
  });
});

describe("speech helpers", () => {
  it("accumulates continuous recognition segments", () => {
    const acc = new TranscriptAccumulator();
    assert.equal(acc.push("hello", false), "hello");
    assert.equal(acc.push("hello world", true), "hello world");
    assert.equal(acc.push("again", false), "hello world again");
    assert.equal(acc.push("", true), "hello world");
  });

  it("normalises volume to 0..1", () => {
    assert.equal(levelFromVolume(-2), 0);
    assert.equal(levelFromVolume(5), 0.5);
    assert.equal(levelFromVolume(50), 1);
    assert.equal(levelFromVolume(Number.NaN), 0);
  });
});
