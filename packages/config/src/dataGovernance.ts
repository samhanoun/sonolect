/**
 * Data governance configuration for Sonolect.
 *
 * Covers data classification, retention policies, GDPR right-to-export /
 * right-to-erasure helpers, and encryption requirement validation —
 * designed for SOC 2 and HIPAA BAA compliance readiness.
 */

/* ── Types ─────────────────────────────────────────────────────────── */

export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export interface DataRetentionRule {
  classification: DataClassification;
  retentionDays: number;
  autoDelete: boolean;
  requiresEncryption: boolean;
}

export interface GdprExportRequest {
  userId: string;
  requestedAt: string;
  format: "json" | "csv";
  includeAudio: boolean;
}

export interface GdprExportResult {
  userId: string;
  exportedAt: string;
  itemCount: number;
  sizeBytes: number;
  downloadUrl?: string;
}

/* ── Default retention rules ──────────────────────────────────────── */

export const DEFAULT_RETENTION_RULES: DataRetentionRule[] = [
  {
    classification: "public",
    retentionDays: 365,
    autoDelete: false,
    requiresEncryption: false,
  },
  {
    classification: "internal",
    retentionDays: 180,
    autoDelete: false,
    requiresEncryption: false,
  },
  {
    classification: "confidential",
    retentionDays: 90,
    autoDelete: false,
    requiresEncryption: true,
  },
  {
    classification: "restricted",
    retentionDays: 30,
    autoDelete: true,
    requiresEncryption: true,
  },
];

/* ── Classification ───────────────────────────────────────────────── */

const CLASSIFICATION_MAP: Record<string, DataClassification> = {
  transcript: "confidential",
  audio: "restricted",
  dictionary: "internal",
  settings: "internal",
  metrics: "public",
};

/**
 * Classify a Sonolect resource type into a data classification level.
 * Returns `"internal"` for unrecognised resource types (safe default).
 */
export function classifyData(resourceType: string): DataClassification {
  return CLASSIFICATION_MAP[resourceType] ?? "internal";
}

/* ── Retention ────────────────────────────────────────────────────── */

/**
 * Look up the retention rule for a given data classification.
 */
export function getRetentionRule(
  classification: DataClassification,
): DataRetentionRule {
  const rule = DEFAULT_RETENTION_RULES.find(
    (r) => r.classification === classification,
  );
  // Every classification is represented — this is a safety fallback.
  return (
    rule ?? {
      classification,
      retentionDays: 90,
      autoDelete: false,
      requiresEncryption: true,
    }
  );
}

/* ── GDPR helpers ─────────────────────────────────────────────────── */

/**
 * Build a GDPR data-export result from a user's data payload.
 *
 * `data` should be an array of exportable records (the caller is
 * responsible for gathering the actual data from storage).
 */
export function buildGdprExport(
  userId: string,
  data: unknown[],
): GdprExportResult {
  const serialised = JSON.stringify(data);
  return {
    userId,
    exportedAt: new Date().toISOString(),
    itemCount: data.length,
    sizeBytes: new TextEncoder().encode(serialised).byteLength,
  };
}

/**
 * Build a deletion manifest listing all resource categories that must
 * be removed for a right-to-erasure request.
 */
export function buildDeletionManifest(userId: string): string[] {
  return [
    `users/${userId}/profile`,
    `users/${userId}/transcripts`,
    `users/${userId}/audio`,
    `users/${userId}/dictionaries`,
    `users/${userId}/settings`,
    `users/${userId}/exports`,
    `users/${userId}/audit-logs`,
    `users/${userId}/sessions`,
  ];
}

/* ── Encryption validation ────────────────────────────────────────── */

/**
 * Returns `true` when the encryption state satisfies the requirement
 * for the given classification level.
 */
export function validateEncryptionRequirement(
  classification: DataClassification,
  isEncrypted: boolean,
): boolean {
  const rule = getRetentionRule(classification);
  if (rule.requiresEncryption && !isEncrypted) return false;
  return true;
}

/* ── Expiration check ─────────────────────────────────────────────── */

/**
 * Determine whether a resource has exceeded its retention period based
 * on its creation date and classification.
 */
export function isDataExpired(
  createdAt: string,
  classification: DataClassification,
): boolean {
  const rule = getRetentionRule(classification);
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const retentionMs = rule.retentionDays * 24 * 60 * 60 * 1000;
  return now - created > retentionMs;
}
