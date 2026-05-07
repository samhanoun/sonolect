import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  AUDIT_ACTIONS,
  DEFAULT_AUDIT_CONFIG,
  createAuditEvent,
  redactSensitiveFields,
  formatAuditEntry,
  filterAuditLog,
  auditLogSummary,
} from "./auditLog";
import type { AuditEvent, AuditLogConfig } from "./auditLog";

/* ── Constants ────────────────────────────────────────────────────── */

describe("AUDIT_ACTIONS", () => {
  it("contains all required action types", () => {
    const expected = [
      "login",
      "logout",
      "transcribe",
      "export",
      "delete",
      "settings_change",
      "dictionary_update",
      "share",
      "admin_action",
    ];
    for (const action of expected) {
      assert.ok(action in AUDIT_ACTIONS, `Missing audit action: ${action}`);
    }
  });
});

describe("DEFAULT_AUDIT_CONFIG", () => {
  it("is enabled with 365-day retention", () => {
    assert.strictEqual(DEFAULT_AUDIT_CONFIG.enabled, true);
    assert.strictEqual(DEFAULT_AUDIT_CONFIG.retentionDays, 365);
  });

  it("includes common sensitive field names", () => {
    assert.ok(DEFAULT_AUDIT_CONFIG.sensitiveFields.includes("password"));
    assert.ok(DEFAULT_AUDIT_CONFIG.sensitiveFields.includes("token"));
    assert.ok(DEFAULT_AUDIT_CONFIG.sensitiveFields.includes("api_key"));
  });

  it("includes common redact field names", () => {
    assert.ok(DEFAULT_AUDIT_CONFIG.redactFields.includes("email"));
    assert.ok(DEFAULT_AUDIT_CONFIG.redactFields.includes("phone"));
  });
});

/* ── createAuditEvent ─────────────────────────────────────────────── */

describe("createAuditEvent", () => {
  it("creates an event with auto-timestamp", () => {
    const before = new Date().toISOString();
    const event = createAuditEvent("user-1", "login", "auth");
    const after = new Date().toISOString();

    assert.ok(event.timestamp >= before);
    assert.ok(event.timestamp <= after);
    assert.strictEqual(event.userId, "user-1");
    assert.strictEqual(event.action, "login");
    assert.strictEqual(event.resource, "auth");
    assert.strictEqual(event.outcome, "success");
  });

  it("includes optional details when provided", () => {
    const event = createAuditEvent("user-2", "transcribe", "audio", {
      fileSize: 1024,
    });
    assert.deepStrictEqual(event.details, { fileSize: 1024 });
  });

  it("omits details key when not provided", () => {
    const event = createAuditEvent("user-3", "logout", "auth");
    assert.strictEqual("details" in event, false);
  });
});

/* ── redactSensitiveFields ────────────────────────────────────────── */

describe("redactSensitiveFields", () => {
  it("removes sensitive fields from details", () => {
    const event: AuditEvent = {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "u1",
      action: "login",
      resource: "auth",
      outcome: "success",
      details: { password: "s3cret", locale: "en-US" },
    };
    const redacted = redactSensitiveFields(event);
    assert.strictEqual("password" in (redacted.details ?? {}), false);
    assert.strictEqual(redacted.details?.["locale"], "en-US");
  });

  it("masks redact-listed fields", () => {
    const event: AuditEvent = {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "u1",
      action: "settings_change",
      resource: "profile",
      outcome: "success",
      details: { email: "alice@example.com", theme: "dark" },
    };
    const redacted = redactSensitiveFields(event);
    assert.strictEqual(redacted.details?.["email"], "[REDACTED]");
    assert.strictEqual(redacted.details?.["theme"], "dark");
  });

  it("returns a copy when event has no details", () => {
    const event: AuditEvent = {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "u1",
      action: "logout",
      resource: "auth",
      outcome: "success",
    };
    const redacted = redactSensitiveFields(event);
    assert.deepStrictEqual(redacted, event);
    assert.notStrictEqual(redacted, event); // must be a copy
  });

  it("is case-insensitive on field matching", () => {
    const event: AuditEvent = {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "u1",
      action: "login",
      resource: "auth",
      outcome: "success",
      details: { Authorization: "Bearer xyz", apiKey: "abc123" },
    };
    const redacted = redactSensitiveFields(event);
    assert.strictEqual("Authorization" in (redacted.details ?? {}), false);
    assert.strictEqual("apiKey" in (redacted.details ?? {}), false);
  });

  it("accepts a custom config", () => {
    const config: AuditLogConfig = {
      enabled: true,
      retentionDays: 30,
      sensitiveFields: ["secret"],
      redactFields: ["note"],
    };
    const event: AuditEvent = {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "u1",
      action: "admin_action",
      resource: "system",
      outcome: "success",
      details: { secret: "top", note: "internal", visible: true },
    };
    const redacted = redactSensitiveFields(event, config);
    assert.strictEqual("secret" in (redacted.details ?? {}), false);
    assert.strictEqual(redacted.details?.["note"], "[REDACTED]");
    assert.strictEqual(redacted.details?.["visible"], true);
  });
});

/* ── formatAuditEntry ─────────────────────────────────────────────── */

describe("formatAuditEntry", () => {
  it("returns valid JSON string", () => {
    const event = createAuditEvent("u1", "login", "auth");
    const json = formatAuditEntry(event);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.userId, "u1");
    assert.strictEqual(parsed.action, "login");
  });

  it("does not include trailing newline", () => {
    const json = formatAuditEntry(createAuditEvent("u1", "logout", "auth"));
    assert.ok(!json.endsWith("\n"));
  });
});

/* ── filterAuditLog ───────────────────────────────────────────────── */

describe("filterAuditLog", () => {
  const events: AuditEvent[] = [
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "alice",
      action: "login",
      resource: "auth",
      outcome: "success",
    },
    {
      timestamp: "2026-01-02T00:00:00.000Z",
      userId: "bob",
      action: "transcribe",
      resource: "audio",
      outcome: "success",
    },
    {
      timestamp: "2026-01-03T00:00:00.000Z",
      userId: "alice",
      action: "export",
      resource: "transcript",
      outcome: "failure",
    },
    {
      timestamp: "2026-01-04T00:00:00.000Z",
      userId: "charlie",
      action: "login",
      resource: "auth",
      outcome: "denied",
    },
  ];

  it("filters by userId", () => {
    const result = filterAuditLog(events, { userId: "alice" });
    assert.strictEqual(result.length, 2);
    assert.ok(result.every((e) => e.userId === "alice"));
  });

  it("filters by action", () => {
    const result = filterAuditLog(events, { action: "login" });
    assert.strictEqual(result.length, 2);
  });

  it("filters by outcome", () => {
    const result = filterAuditLog(events, { outcome: "failure" });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.userId, "alice");
  });

  it("filters by date range", () => {
    const result = filterAuditLog(events, {
      dateFrom: "2026-01-02T00:00:00.000Z",
      dateTo: "2026-01-03T00:00:00.000Z",
    });
    assert.strictEqual(result.length, 2);
  });

  it("combines multiple filters", () => {
    const result = filterAuditLog(events, {
      userId: "alice",
      outcome: "failure",
    });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.action, "export");
  });

  it("returns all events with empty filters", () => {
    const result = filterAuditLog(events, {});
    assert.strictEqual(result.length, events.length);
  });
});

/* ── auditLogSummary ──────────────────────────────────────────────── */

describe("auditLogSummary", () => {
  const events: AuditEvent[] = [
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      userId: "alice",
      action: "login",
      resource: "auth",
      outcome: "success",
    },
    {
      timestamp: "2026-01-01T01:00:00.000Z",
      userId: "bob",
      action: "login",
      resource: "auth",
      outcome: "failure",
    },
    {
      timestamp: "2026-01-01T02:00:00.000Z",
      userId: "alice",
      action: "transcribe",
      resource: "audio",
      outcome: "success",
    },
    {
      timestamp: "2026-01-01T03:00:00.000Z",
      userId: "charlie",
      action: "login",
      resource: "auth",
      outcome: "denied",
    },
  ];

  it("counts total events", () => {
    const summary = auditLogSummary(events);
    assert.strictEqual(summary.totalEvents, 4);
  });

  it("counts unique users", () => {
    const summary = auditLogSummary(events);
    assert.strictEqual(summary.uniqueUsers, 3);
  });

  it("counts failed attempts (failure + denied)", () => {
    const summary = auditLogSummary(events);
    assert.strictEqual(summary.failedAttempts, 2);
  });

  it("tracks action counts", () => {
    const summary = auditLogSummary(events);
    assert.strictEqual(summary.topActions["login"], 3);
    assert.strictEqual(summary.topActions["transcribe"], 1);
  });

  it("handles empty array", () => {
    const summary = auditLogSummary([]);
    assert.strictEqual(summary.totalEvents, 0);
    assert.strictEqual(summary.uniqueUsers, 0);
    assert.strictEqual(summary.failedAttempts, 0);
    assert.deepStrictEqual(summary.topActions, {});
  });
});
