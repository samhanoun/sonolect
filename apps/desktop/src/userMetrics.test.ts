import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

// Minimal localStorage polyfill for Node test environment
let store: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (key: string) => (key in store ? store[key]! : null),
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};

// Inject before importing module
(globalThis as any).localStorage = fakeLocalStorage;

const {
  createDefaultMetrics,
  recordMetricEvent,
  estimateTimeSaved,
  formatTimeSaved,
  calculateStreak,
  loadMetrics,
  saveMetrics,
  getMetricsSummary,
} = await import("./userMetrics");

describe("userMetrics", () => {
  beforeEach(() => {
    store = {};
  });

  describe("createDefaultMetrics", () => {
    it("returns zeroed-out metrics", () => {
      const m = createDefaultMetrics();
      assert.equal(m.totalDictations, 0);
      assert.equal(m.totalWordsTranscribed, 0);
      assert.equal(m.totalInsertions, 0);
      assert.equal(m.totalTransformations, 0);
      assert.equal(m.estimatedTimeSavedMs, 0);
      assert.equal(m.averageLatencyMs, 0);
      assert.equal(m.streakDays, 0);
      assert.equal(m.lastActiveDate, "");
    });
  });

  describe("recordMetricEvent", () => {
    it("increments dictation count and word count", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 50,
        timestamp: "2026-05-06T10:00:00Z",
      });
      assert.equal(updated.totalDictations, 1);
      assert.equal(updated.totalWordsTranscribed, 50);
      assert.ok(updated.estimatedTimeSavedMs > 0);
    });

    it("increments insertion count", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "insertion",
        timestamp: "2026-05-06T10:00:00Z",
      });
      assert.equal(updated.totalInsertions, 1);
    });

    it("increments transformation count", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "transformation",
        timestamp: "2026-05-06T10:00:00Z",
      });
      assert.equal(updated.totalTransformations, 1);
    });

    it("does not mutate the original metrics object", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 10,
        timestamp: "2026-05-06T10:00:00Z",
      });
      assert.equal(m.totalDictations, 0);
      assert.equal(updated.totalDictations, 1);
    });

    it("calculates rolling average latency", () => {
      let m = createDefaultMetrics();
      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 10,
        latencyMs: 100,
        timestamp: "2026-05-06T10:00:00Z",
      });
      assert.equal(m.averageLatencyMs, 100);

      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 10,
        latencyMs: 200,
        timestamp: "2026-05-06T10:01:00Z",
      });
      // Rolling average: should be between 100 and 200
      assert.ok(m.averageLatencyMs > 100);
      assert.ok(m.averageLatencyMs <= 200);
    });

    it("updates lastActiveDate", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 5,
        timestamp: "2026-05-06T14:30:00Z",
      });
      assert.equal(updated.lastActiveDate, "2026-05-06");
    });
  });

  describe("estimateTimeSaved", () => {
    it("returns positive time saved for typical word count", () => {
      // 100 words at 45 WPM typing takes ~133s, at 150 WPM dictation takes ~40s
      const saved = estimateTimeSaved(100);
      assert.ok(saved > 0);
    });

    it("returns 0 for 0 words", () => {
      assert.equal(estimateTimeSaved(0), 0);
    });

    it("returns 0 for negative word count", () => {
      assert.equal(estimateTimeSaved(-10), 0);
    });

    it("allows custom WPM values", () => {
      const saved = estimateTimeSaved(100, 30, 120);
      assert.ok(saved > 0);
    });

    it("returns 0 if dictation is slower than typing", () => {
      // If typing is 200 WPM and dictation is 50 WPM, dictation is slower
      const saved = estimateTimeSaved(100, 200, 50);
      assert.equal(saved, 0);
    });
  });

  describe("formatTimeSaved", () => {
    it("formats zero", () => {
      assert.equal(formatTimeSaved(0), "0m saved");
    });

    it("formats minutes only", () => {
      assert.equal(formatTimeSaved(5 * 60_000), "5m saved");
    });

    it("formats hours and minutes", () => {
      const ms = 2 * 60 * 60_000 + 15 * 60_000; // 2h 15m
      assert.equal(formatTimeSaved(ms), "2h 15m saved");
    });

    it("formats full hours without minutes", () => {
      assert.equal(formatTimeSaved(3 * 60 * 60_000), "3h saved");
    });

    it("handles negative values", () => {
      assert.equal(formatTimeSaved(-1000), "0m saved");
    });
  });

  describe("calculateStreak", () => {
    it("returns 1 for first activity", () => {
      const m = createDefaultMetrics();
      assert.equal(calculateStreak(m, "2026-05-06"), 1);
    });

    it("keeps streak on same day", () => {
      const m = {
        ...createDefaultMetrics(),
        lastActiveDate: "2026-05-06",
        streakDays: 3,
      };
      assert.equal(calculateStreak(m, "2026-05-06"), 3);
    });

    it("increments streak on consecutive day", () => {
      const m = {
        ...createDefaultMetrics(),
        lastActiveDate: "2026-05-05",
        streakDays: 3,
      };
      assert.equal(calculateStreak(m, "2026-05-06"), 4);
    });

    it("resets streak after a gap", () => {
      const m = {
        ...createDefaultMetrics(),
        lastActiveDate: "2026-05-03",
        streakDays: 5,
      };
      assert.equal(calculateStreak(m, "2026-05-06"), 1);
    });
  });

  describe("persistence", () => {
    it("roundtrips metrics through save/load", () => {
      const m = createDefaultMetrics();
      const updated = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 42,
        timestamp: "2026-05-06T12:00:00Z",
      });
      saveMetrics(updated);
      const loaded = loadMetrics();
      assert.equal(loaded.totalDictations, 1);
      assert.equal(loaded.totalWordsTranscribed, 42);
    });

    it("returns default metrics on missing data", () => {
      const loaded = loadMetrics();
      assert.equal(loaded.totalDictations, 0);
    });

    it("returns default metrics on corrupt data", () => {
      store["sonolect.userMetrics"] = "{invalid-json";
      const loaded = loadMetrics();
      assert.equal(loaded.totalDictations, 0);
    });
  });

  describe("getMetricsSummary", () => {
    it("returns start message when no time saved", () => {
      const m = createDefaultMetrics();
      const summary = getMetricsSummary(m);
      assert.ok(summary.headline.includes("Start dictating"));
    });

    it("returns time saved headline when active", () => {
      let m = createDefaultMetrics();
      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 500,
        timestamp: "2026-05-06T12:00:00Z",
      });
      const summary = getMetricsSummary(m);
      assert.ok(summary.headline.includes("saved"));
      assert.ok(summary.details.length > 0);
    });

    it("includes dictation and word counts in details", () => {
      let m = createDefaultMetrics();
      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 100,
        timestamp: "2026-05-06T12:00:00Z",
      });
      const summary = getMetricsSummary(m);
      assert.ok(summary.details.some((d) => d.includes("1 dictation")));
      assert.ok(summary.details.some((d) => d.includes("100 words")));
    });

    it("includes streak in details when > 1", () => {
      let m = createDefaultMetrics();
      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 10,
        timestamp: "2026-05-05T12:00:00Z",
      });
      m = recordMetricEvent(m, {
        type: "dictation",
        wordCount: 10,
        timestamp: "2026-05-06T12:00:00Z",
      });
      const summary = getMetricsSummary(m);
      assert.ok(summary.details.some((d) => d.includes("streak")));
    });
  });
});
