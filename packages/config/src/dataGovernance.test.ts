import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_RETENTION_RULES,
  classifyData,
  getRetentionRule,
  buildGdprExport,
  buildDeletionManifest,
  validateEncryptionRequirement,
  isDataExpired,
} from "./dataGovernance";
import type { DataClassification } from "./dataGovernance";

/* ── DEFAULT_RETENTION_RULES ──────────────────────────────────────── */

describe("DEFAULT_RETENTION_RULES", () => {
  it("has rules for all four classification levels", () => {
    const levels: DataClassification[] = [
      "public",
      "internal",
      "confidential",
      "restricted",
    ];
    for (const level of levels) {
      assert.ok(
        DEFAULT_RETENTION_RULES.some((r) => r.classification === level),
        `Missing retention rule for: ${level}`,
      );
    }
  });

  it("public retains for 365 days without encryption", () => {
    const rule = DEFAULT_RETENTION_RULES.find(
      (r) => r.classification === "public",
    )!;
    assert.strictEqual(rule.retentionDays, 365);
    assert.strictEqual(rule.requiresEncryption, false);
    assert.strictEqual(rule.autoDelete, false);
  });

  it("restricted retains for 30 days with encryption and auto-delete", () => {
    const rule = DEFAULT_RETENTION_RULES.find(
      (r) => r.classification === "restricted",
    )!;
    assert.strictEqual(rule.retentionDays, 30);
    assert.strictEqual(rule.requiresEncryption, true);
    assert.strictEqual(rule.autoDelete, true);
  });

  it("confidential requires encryption", () => {
    const rule = DEFAULT_RETENTION_RULES.find(
      (r) => r.classification === "confidential",
    )!;
    assert.strictEqual(rule.requiresEncryption, true);
  });
});

/* ── classifyData ─────────────────────────────────────────────────── */

describe("classifyData", () => {
  it("classifies transcript as confidential", () => {
    assert.strictEqual(classifyData("transcript"), "confidential");
  });

  it("classifies audio as restricted", () => {
    assert.strictEqual(classifyData("audio"), "restricted");
  });

  it("classifies dictionary as internal", () => {
    assert.strictEqual(classifyData("dictionary"), "internal");
  });

  it("classifies settings as internal", () => {
    assert.strictEqual(classifyData("settings"), "internal");
  });

  it("classifies metrics as public", () => {
    assert.strictEqual(classifyData("metrics"), "public");
  });

  it("defaults to internal for unknown resource types", () => {
    assert.strictEqual(classifyData("unknown_thing"), "internal");
  });
});

/* ── getRetentionRule ─────────────────────────────────────────────── */

describe("getRetentionRule", () => {
  it("returns the correct rule for each classification", () => {
    const publicRule = getRetentionRule("public");
    assert.strictEqual(publicRule.retentionDays, 365);

    const restricted = getRetentionRule("restricted");
    assert.strictEqual(restricted.retentionDays, 30);
    assert.strictEqual(restricted.autoDelete, true);
  });
});

/* ── buildGdprExport ──────────────────────────────────────────────── */

describe("buildGdprExport", () => {
  it("returns the correct item count and userId", () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = buildGdprExport("user-42", data);

    assert.strictEqual(result.userId, "user-42");
    assert.strictEqual(result.itemCount, 3);
    assert.ok(result.sizeBytes > 0);
    assert.ok(result.exportedAt.length > 0);
  });

  it("handles empty data array", () => {
    const result = buildGdprExport("user-0", []);
    assert.strictEqual(result.itemCount, 0);
    assert.strictEqual(result.sizeBytes, 2); // "[]"
  });

  it("does not include downloadUrl by default", () => {
    const result = buildGdprExport("user-1", [{ a: 1 }]);
    assert.strictEqual(result.downloadUrl, undefined);
  });
});

/* ── buildDeletionManifest ────────────────────────────────────────── */

describe("buildDeletionManifest", () => {
  it("lists all expected resource paths for a user", () => {
    const manifest = buildDeletionManifest("user-99");
    assert.ok(manifest.length > 0);
    assert.ok(manifest.every((p) => p.startsWith("users/user-99/")));
    assert.ok(manifest.includes("users/user-99/transcripts"));
    assert.ok(manifest.includes("users/user-99/audio"));
    assert.ok(manifest.includes("users/user-99/profile"));
    assert.ok(manifest.includes("users/user-99/settings"));
  });
});

/* ── validateEncryptionRequirement ────────────────────────────────── */

describe("validateEncryptionRequirement", () => {
  it("passes when encryption not required and data is unencrypted", () => {
    assert.strictEqual(validateEncryptionRequirement("public", false), true);
  });

  it("passes when encryption required and data is encrypted", () => {
    assert.strictEqual(
      validateEncryptionRequirement("confidential", true),
      true,
    );
  });

  it("fails when encryption required but data is unencrypted", () => {
    assert.strictEqual(
      validateEncryptionRequirement("restricted", false),
      false,
    );
  });

  it("passes when encryption not required but data is encrypted anyway", () => {
    assert.strictEqual(validateEncryptionRequirement("internal", true), true);
  });
});

/* ── isDataExpired ────────────────────────────────────────────────── */

describe("isDataExpired", () => {
  it("returns true for data older than its retention period", () => {
    // restricted = 30 days. Create a date 60 days ago.
    const sixtyDaysAgo = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    assert.strictEqual(isDataExpired(sixtyDaysAgo, "restricted"), true);
  });

  it("returns false for data within its retention period", () => {
    // public = 365 days. Create a date 10 days ago.
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    assert.strictEqual(isDataExpired(tenDaysAgo, "public"), false);
  });

  it("returns false for data created just now", () => {
    assert.strictEqual(
      isDataExpired(new Date().toISOString(), "restricted"),
      false,
    );
  });
});
