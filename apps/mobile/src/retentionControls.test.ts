import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_RETENTION_POLICY,
  applyRetentionPolicy,
  getRetentionStats,
  loadRetentionPolicy,
  saveRetentionPolicy,
  validateRetentionPolicy,
  setRetentionStorage,
} from "./retentionControls";
import type { TranscriptHistoryRow } from "./searchAndFilter";
import type { RetentionPolicy } from "./retentionControls";

// Inject a test storage backend (in-memory Map)
const store = new Map<string, string>();
setRetentionStorage({
  getItem: async (key) => store.get(key) ?? null,
  setItem: async (key, value) => { store.set(key, value); },
});

function makeRow(
  id: string,
  updatedAt: string,
): TranscriptHistoryRow {
  return {
    id,
    title: `Session ${id}`,
    preview: "Preview",
    transcript: "Transcript text",
    timestamp: "Today",
    duration: "1m 00s",
    mode: "summarize",
    status: "draft",
    metadata: "",
    updatedAt,
  };
}

describe("retentionControls (mobile)", () => {
  beforeEach(() => {
    store.clear();
  });

  // ── DEFAULT_RETENTION_POLICY ───────────────────────────────────
  it("has sensible defaults", () => {
    assert.strictEqual(DEFAULT_RETENTION_POLICY.maxAgeDays, 90);
    assert.strictEqual(DEFAULT_RETENTION_POLICY.maxItems, 1000);
    assert.strictEqual(DEFAULT_RETENTION_POLICY.autoDeleteEnabled, false);
  });

  // ── applyRetentionPolicy ───────────────────────────────────────
  describe("applyRetentionPolicy", () => {
    it("marks expired items for removal", () => {
      const now = new Date();
      const old = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const history = [
        makeRow("old", old.toISOString()),
        makeRow("recent", recent.toISOString()),
      ];

      const result = applyRetentionPolicy(history, {
        maxAgeDays: 90,
        maxItems: 1000,
        autoDeleteEnabled: true,
      });

      assert.strictEqual(result.removedCount, 1);
      assert.strictEqual(result.remainingCount, 1);
      assert.ok(result.freedItems.includes("old"));
      assert.ok(!result.freedItems.includes("recent"));
    });

    it("marks items over maxItems for removal", () => {
      const now = new Date();
      const history = Array.from({ length: 5 }, (_, i) =>
        makeRow(
          `item-${i}`,
          new Date(now.getTime() - i * 1000).toISOString(),
        ),
      );

      const result = applyRetentionPolicy(history, {
        maxAgeDays: 3650,
        maxItems: 3,
        autoDeleteEnabled: true,
      });

      assert.strictEqual(result.removedCount, 2);
      assert.strictEqual(result.remainingCount, 3);
    });

    it("returns empty purge for history within policy", () => {
      const now = new Date();
      const history = [makeRow("ok", now.toISOString())];

      const result = applyRetentionPolicy(history, DEFAULT_RETENTION_POLICY);

      assert.strictEqual(result.removedCount, 0);
      assert.strictEqual(result.remainingCount, 1);
      assert.strictEqual(result.freedItems.length, 0);
    });

    it("handles empty history", () => {
      const result = applyRetentionPolicy([], DEFAULT_RETENTION_POLICY);
      assert.strictEqual(result.removedCount, 0);
      assert.strictEqual(result.remainingCount, 0);
    });
  });

  // ── getRetentionStats ──────────────────────────────────────────
  describe("getRetentionStats", () => {
    it("categorizes items into within, expiring, and expired", () => {
      const now = new Date();
      const policy: RetentionPolicy = {
        maxAgeDays: 100,
        maxItems: 1000,
        autoDeleteEnabled: false,
      };
      // 90% of 100 days = 90 days
      const fresh = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days
      const expiring = new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000); // 95 days (> 90)
      const expired = new Date(now.getTime() - 110 * 24 * 60 * 60 * 1000); // 110 days

      const history = [
        makeRow("fresh", fresh.toISOString()),
        makeRow("expiring", expiring.toISOString()),
        makeRow("expired", expired.toISOString()),
      ];

      const stats = getRetentionStats(history, policy);

      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.withinPolicy, 1);
      assert.strictEqual(stats.expiring, 1);
      assert.strictEqual(stats.expired, 1);
    });

    it("handles empty history", () => {
      const stats = getRetentionStats([], DEFAULT_RETENTION_POLICY);
      assert.strictEqual(stats.total, 0);
      assert.strictEqual(stats.withinPolicy, 0);
      assert.strictEqual(stats.expiring, 0);
      assert.strictEqual(stats.expired, 0);
    });
  });

  // ── validateRetentionPolicy ────────────────────────────────────
  describe("validateRetentionPolicy", () => {
    it("returns defaults for empty object", () => {
      const result = validateRetentionPolicy({});
      assert.deepStrictEqual(result, DEFAULT_RETENTION_POLICY);
    });

    it("clamps maxAgeDays to safe range", () => {
      assert.strictEqual(
        validateRetentionPolicy({ maxAgeDays: 0 }).maxAgeDays,
        1,
      );
      assert.strictEqual(
        validateRetentionPolicy({ maxAgeDays: 99999 }).maxAgeDays,
        3650,
      );
      assert.strictEqual(
        validateRetentionPolicy({ maxAgeDays: -5 }).maxAgeDays,
        1,
      );
    });

    it("clamps maxItems to safe range", () => {
      assert.strictEqual(
        validateRetentionPolicy({ maxItems: 0 }).maxItems,
        1,
      );
      assert.strictEqual(
        validateRetentionPolicy({ maxItems: 999999 }).maxItems,
        100_000,
      );
    });

    it("handles NaN and Infinity gracefully", () => {
      assert.strictEqual(
        validateRetentionPolicy({ maxAgeDays: NaN }).maxAgeDays,
        1,
      );
      assert.strictEqual(
        validateRetentionPolicy({ maxItems: Infinity }).maxItems,
        1,
      );
    });

    it("accepts valid values", () => {
      const result = validateRetentionPolicy({
        maxAgeDays: 30,
        maxItems: 500,
        autoDeleteEnabled: true,
      });
      assert.strictEqual(result.maxAgeDays, 30);
      assert.strictEqual(result.maxItems, 500);
      assert.strictEqual(result.autoDeleteEnabled, true);
    });
  });

  // ── persistence round-trip ─────────────────────────────────────
  describe("persistence", () => {
    it("saves and loads retention policy", async () => {
      const policy: RetentionPolicy = {
        maxAgeDays: 30,
        maxItems: 500,
        autoDeleteEnabled: true,
      };
      await saveRetentionPolicy(policy);
      const loaded = await loadRetentionPolicy();
      assert.deepStrictEqual(loaded, policy);
    });

    it("returns defaults when nothing is saved", async () => {
      const loaded = await loadRetentionPolicy();
      assert.deepStrictEqual(loaded, DEFAULT_RETENTION_POLICY);
    });

    it("returns defaults for corrupt saved data", async () => {
      store.set("sonolect.mobile.retentionPolicy", "{not-json");
      const loaded = await loadRetentionPolicy();
      assert.deepStrictEqual(loaded, DEFAULT_RETENTION_POLICY);
    });
  });
});
