/**
 * The HTTP protocol between the apps and services/sync-service, version 1.
 *
 * This module has no dependencies, so the service imports it
 * (`@sonolect/sync-core/wire`) without pulling the client crypto into its
 * bundle. Every byte string travels as unpadded base64url.
 *
 * What the server sees: vault ids, the bearer token (one per vault, shared
 * by every device; it stores only its SHA-256), record ids, revisions,
 * sequence numbers, the vault's epoch, which records are deletes and when,
 * sizes, timestamps, the user agent, IP addresses and ciphertext. Never a
 * key, a note id or a word of a note.
 */

/** A vault id: 16 bytes as base64url. */
export const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** A record id: 18 bytes of HMAC as base64url. */
export const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
/** The bearer token and its SHA-256 verifier: 32 bytes as base64url. */
export const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const AUTH_VERIFIER_PATTERN = AUTH_TOKEN_PATTERN;
/** Unpadded base64url of any length. */
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

const KIB = 1024;
const MIB = 1024 * KIB;
const DAY_MS = 24 * 60 * 60_000;

/** Limits that the server enforces and the client respects. */
export const SYNC_LIMITS = {
  /** Largest sealed record (ciphertext bytes): stays under Firestore's 1 MiB document limit. */
  maxRecordBytes: 768 * KIB,
  /** Smallest well-formed sealed record: header, nonce and tag. */
  minRecordBytes: 2 + 24 + 16,
  /** Largest sealed tombstone (a delete): a real one is 298 bytes. */
  maxTombstoneBytes: KIB,
  /** Largest note JSON before compression. */
  maxPlaintextBytes: 4 * MIB,
  /** Writes in one POST /records. */
  maxBatchWrites: 100,
  /** Request body limit: a full batch of base64url records. */
  maxRequestBytes: 5 * MIB,
  /** Records and ciphertext bytes in one page of changes. */
  maxPageRecords: 200,
  maxPageBytes: 4 * MIB,
  /**
   * Per vault quotas (notes only: recordings do not sync in v1). Records
   * count notes, so a delete frees a slot at once; tombstones count in the
   * bytes, and may take up to `maxVaultTombstones` records beyond the notes
   * until they are purged.
   */
  maxVaultRecords: 20_000,
  maxVaultTombstones: 20_000,
  maxVaultBytes: 200 * MIB,
  /** Tombstones are purged this long after the delete. */
  tombstoneTtlMs: 90 * DAY_MS,
  /** A device that has not synced for this long does a full resync. */
  fullResyncAfterMs: 60 * DAY_MS,
} as const;

/** The length of `bytes` bytes as unpadded base64url. */
export const base64urlLength = (bytes: number): number =>
  Math.ceil((bytes * 4) / 3);

/**
 * JSON around one record of a page of changes: its rid, rev, seq, deleted
 * flag, key names and punctuation (about 120 bytes with 16-digit numbers).
 */
const PAGE_RECORD_JSON_BYTES = 256;

/**
 * The largest answer a client must read: a full page of changes. Its
 * ciphertext is measured in decoded bytes (`maxPageBytes`, or one record
 * alone, at most `maxRecordBytes`) and travels as base64url, a third
 * larger, with the JSON of up to `maxPageRecords` records around it and
 * the page's own fields. About 5.4 MiB.
 */
export const MAX_RESPONSE_BYTES =
  base64urlLength(
    Math.max(SYNC_LIMITS.maxPageBytes, SYNC_LIMITS.maxRecordBytes),
  ) +
  SYNC_LIMITS.maxPageRecords * PAGE_RECORD_JSON_BYTES +
  16 * KIB;

/** A vault epoch: 8 random bytes the server picks when it creates the vault. */
export const EPOCH_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** POST /v1/vaults (no Authorization header). */
export interface CreateVaultRequest {
  vaultId: string;
  authVerifier: string;
}
/** 201 when created, 200 when it already exists with the same verifier. */
export interface CreateVaultResponse {
  vaultId: string;
  created: boolean;
  /**
   * Changes whenever the vault is created again (the server lost it), so a
   * device whose cursor belongs to the old vault starts over.
   */
  epoch: string;
}

/** One record as the server returns it. */
export interface WireRecord {
  rid: string;
  /** Revision of this record, 1 for its first write. */
  rev: number;
  /** Position in the vault's change feed. */
  seq: number;
  deleted: boolean;
  /** The sealed envelope, base64url. */
  ct: string;
}

/** GET /v1/vaults/:vaultId/changes?since=<seq>&limit=<n> */
export interface ChangesResponse {
  /** Records with seq > since, in seq order. */
  records: WireRecord[];
  /** The cursor for the next page: the last record's seq, or `since`. */
  next: number;
  hasMore: boolean;
  /** The vault's latest seq. */
  head: number;
  /** The vault's epoch (see CreateVaultResponse). */
  epoch: string;
}

/** One write in POST /v1/vaults/:vaultId/records. */
export interface WireWrite {
  rid: string;
  /** The revision this write replaces; 0 for a record the server does not have. */
  baseRev: number;
  deleted: boolean;
  ct: string;
}
export interface WriteRequest {
  writes: WireWrite[];
}

export type QuotaReason = "quota_records" | "quota_bytes";

/** The outcome of one write, in request order. */
export type WireWriteResult =
  | { rid: string; status: "ok"; rev: number; seq: number }
  /** baseRev was not the current revision: `current` is what the server holds (null: nothing). */
  | { rid: string; status: "conflict"; current: WireRecord | null }
  | { rid: string; status: "rejected"; reason: QuotaReason };

export interface WriteResponse {
  results: WireWriteResult[];
}

/** Every error answer: `{ error: <code>, message }`. */
export interface ErrorResponse {
  error: string;
  message?: string;
}

/** The error codes the vault routes answer with. */
export const SYNC_ERROR_CODES = {
  /** 400 */
  badRequest: "bad_request",
  /** 401: unknown vault or wrong token, deliberately the same answer. */
  unauthorized: "unauthorized",
  /** 404: a malformed vault id in the path. */
  notFound: "not_found",
  /** 409: POST /v1/vaults for an id that exists with another verifier. */
  vaultExists: "vault_exists",
  /** 410: the vault was deleted (by DELETE /v1/vaults/:vaultId). */
  vaultDeleted: "vault_deleted",
  /** 410: `since` is older than tombstones the server has purged: resync from 0. */
  cursorExpired: "cursor_expired",
  /** 410: `since` is past the vault's head (the server lost data): resync from 0. */
  cursorReset: "cursor_reset",
  /** 413 */
  recordTooLarge: "record_too_large",
  /** 429, with a Retry-After header in seconds. */
  rateLimited: "rate_limited",
} as const;

/** Paths of the vault routes. */
export const SYNC_PATHS = {
  health: "/health",
  vaults: "/v1/vaults",
  vault: (vaultId: string) => `/v1/vaults/${vaultId}`,
  changes: (vaultId: string, since: number, limit: number) =>
    `/v1/vaults/${vaultId}/changes?since=${since}&limit=${limit}`,
  records: (vaultId: string) => `/v1/vaults/${vaultId}/records`,
} as const;
