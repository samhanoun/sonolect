/**
 * Audit logging configuration and utilities for Sonolect.
 *
 * Provides structured audit event creation, sensitive field redaction,
 * filtering, and summary generation — designed for SOC 2 and HIPAA BAA
 * compliance readiness.
 */

/* ── Types ─────────────────────────────────────────────────────────── */

export interface AuditEvent {
  timestamp: string;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  outcome: "success" | "failure" | "denied";
}

export interface AuditLogConfig {
  enabled: boolean;
  retentionDays: number;
  sensitiveFields: string[];
  redactFields: string[];
}

/* ── Constants ────────────────────────────────────────────────────── */

export const AUDIT_ACTIONS = {
  login: "login",
  logout: "logout",
  transcribe: "transcribe",
  export: "export",
  delete: "delete",
  settings_change: "settings_change",
  dictionary_update: "dictionary_update",
  share: "share",
  admin_action: "admin_action",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const DEFAULT_AUDIT_CONFIG: AuditLogConfig = {
  enabled: true,
  retentionDays: 365,
  sensitiveFields: [
    "password",
    "token",
    "api_key",
    "apiKey",
    "secret",
    "authorization",
    "cookie",
    "session",
    "credit_card",
    "ssn",
  ],
  redactFields: ["email", "phone", "ip_address", "name"],
};

/* ── Factory ──────────────────────────────────────────────────────── */

/**
 * Create a new AuditEvent with an automatic ISO-8601 timestamp.
 */
export function createAuditEvent(
  userId: string,
  action: string,
  resource: string,
  details?: Record<string, unknown>,
): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    userId,
    action,
    resource,
    outcome: "success",
    ...(details !== undefined ? { details } : {}),
  };
}

/* ── Redaction ────────────────────────────────────────────────────── */

const REDACTED = "[REDACTED]";

/**
 * Return a copy of the event with sensitive fields stripped and
 * redact-listed fields masked in `details`.
 */
export function redactSensitiveFields(
  event: AuditEvent,
  config: AuditLogConfig = DEFAULT_AUDIT_CONFIG,
): AuditEvent {
  if (!event.details) return { ...event };

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event.details)) {
    const lower = key.toLowerCase();
    if (config.sensitiveFields.some((f) => lower.includes(f.toLowerCase()))) {
      // Completely remove sensitive fields
      continue;
    }
    if (config.redactFields.some((f) => lower.includes(f.toLowerCase()))) {
      redacted[key] = REDACTED;
    } else {
      redacted[key] = value;
    }
  }

  return { ...event, details: redacted };
}

/* ── Formatting ───────────────────────────────────────────────────── */

/**
 * Serialise an AuditEvent as a single JSON-lines entry (no trailing newline).
 */
export function formatAuditEntry(event: AuditEvent): string {
  return JSON.stringify(event);
}

/* ── Filtering ────────────────────────────────────────────────────── */

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  outcome?: AuditEvent["outcome"];
}

/**
 * Filter an array of audit events by userId, action, date range, and outcome.
 */
export function filterAuditLog(
  events: AuditEvent[],
  filters: AuditLogFilters,
): AuditEvent[] {
  return events.filter((e) => {
    if (filters.userId && e.userId !== filters.userId) return false;
    if (filters.action && e.action !== filters.action) return false;
    if (filters.outcome && e.outcome !== filters.outcome) return false;
    if (filters.dateFrom && e.timestamp < filters.dateFrom) return false;
    if (filters.dateTo && e.timestamp > filters.dateTo) return false;
    return true;
  });
}

/* ── Summary ──────────────────────────────────────────────────────── */

export interface AuditLogSummary {
  totalEvents: number;
  uniqueUsers: number;
  failedAttempts: number;
  topActions: Record<string, number>;
}

/**
 * Produce a summary of audit events: totals, unique users, failures,
 * and a count of each action type.
 */
export function auditLogSummary(events: AuditEvent[]): AuditLogSummary {
  const users = new Set<string>();
  let failedAttempts = 0;
  const actionCounts: Record<string, number> = {};

  for (const event of events) {
    users.add(event.userId);
    if (event.outcome === "failure" || event.outcome === "denied") {
      failedAttempts++;
    }
    actionCounts[event.action] = (actionCounts[event.action] ?? 0) + 1;
  }

  return {
    totalEvents: events.length,
    uniqueUsers: users.size,
    failedAttempts,
    topActions: actionCounts,
  };
}
