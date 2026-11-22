import type { ServiceEnv } from "@sonolect/service-kit";
import { SYNC_LIMITS } from "@sonolect/sync-core/wire";

/** Which VaultStore the service runs on (SONOLECT_SYNC_STORE). */
export type StoreSpec =
  | { kind: "memory" }
  | { kind: "sqlite"; path: string }
  | {
      kind: "firestore";
      projectId?: string | undefined;
      databaseId?: string | undefined;
    };

/** The service's limits: the protocol's (SYNC_LIMITS) plus rate limits. */
export interface ServiceLimits {
  maxRecordBytes: number;
  minRecordBytes: number;
  /** A delete (tombstone) larger than this is refused (400). */
  maxTombstoneBytes: number;
  maxBatchWrites: number;
  maxRequestBytes: number;
  maxPageRecords: number;
  maxPageBytes: number;
  /** Notes a vault may hold (tombstones not counted). */
  maxVaultRecords: number;
  /** Records tombstones may take beyond the notes until they are purged. */
  maxVaultTombstones: number;
  maxVaultBytes: number;
  tombstoneTtlMs: number;
  /** A vault's tombstones are purged at most this often. */
  purgeIntervalMs: number;
  /** Requests per minute from one IP address (all routes but /health). */
  ipRequestsPerMinute: number;
  /** Requests per minute to one vault, counted after authentication. */
  vaultRequestsPerMinute: number;
  /** Vaults one IP address may create per hour. */
  vaultCreatesPerHour: number;
}

export const DEFAULT_LIMITS: Readonly<ServiceLimits> = {
  maxRecordBytes: SYNC_LIMITS.maxRecordBytes,
  minRecordBytes: SYNC_LIMITS.minRecordBytes,
  maxTombstoneBytes: SYNC_LIMITS.maxTombstoneBytes,
  maxBatchWrites: SYNC_LIMITS.maxBatchWrites,
  maxRequestBytes: SYNC_LIMITS.maxRequestBytes,
  maxPageRecords: SYNC_LIMITS.maxPageRecords,
  maxPageBytes: SYNC_LIMITS.maxPageBytes,
  maxVaultRecords: SYNC_LIMITS.maxVaultRecords,
  maxVaultTombstones: SYNC_LIMITS.maxVaultTombstones,
  maxVaultBytes: SYNC_LIMITS.maxVaultBytes,
  tombstoneTtlMs: SYNC_LIMITS.tombstoneTtlMs,
  purgeIntervalMs: 24 * 60 * 60_000,
  ipRequestsPerMinute: 600,
  vaultRequestsPerMinute: 120,
  vaultCreatesPerHour: 10,
};

export interface SyncServiceConfig {
  production: boolean;
  store: StoreSpec;
  /** Fastify trustProxy: false, or how many proxy hops to trust. */
  trustProxy: false | number;
  /** CORS origins; undefined keeps CORS off. */
  allowedOrigins: string[] | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`sonolect-sync-service: ${message}`);
    this.name = "ConfigError";
  }
}

const ORIGIN_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const HOPS_PATTERN = /^\d{1,2}$/;

/** Parses SONOLECT_SYNC_STORE: memory, sqlite:<path> or firestore. */
export function parseStoreSpec(env: ServiceEnv): StoreSpec {
  const production = env.NODE_ENV === "production";
  const raw = env.SONOLECT_SYNC_STORE?.trim() ?? "";
  if (raw === "" || raw === "memory") {
    if (production)
      throw new ConfigError(
        raw === ""
          ? "SONOLECT_SYNC_STORE must be set in production (sqlite:<path> or firestore)"
          : "the memory store loses every vault on restart and is refused in production; use sqlite:<path> or firestore",
      );
    return { kind: "memory" };
  }
  if (raw.startsWith("sqlite:")) {
    const path = raw.slice("sqlite:".length).trim();
    if (path === "")
      throw new ConfigError("SONOLECT_SYNC_STORE=sqlite:<path> needs a path");
    if (production && path === ":memory:")
      throw new ConfigError(
        "an in-memory SQLite database is refused in production",
      );
    return { kind: "sqlite", path };
  }
  if (raw === "firestore")
    return {
      kind: "firestore",
      projectId:
        env.GOOGLE_CLOUD_PROJECT?.trim() ||
        env.GCLOUD_PROJECT?.trim() ||
        undefined,
      databaseId: env.SONOLECT_SYNC_FIRESTORE_DATABASE?.trim() || undefined,
    };
  throw new ConfigError(
    "SONOLECT_SYNC_STORE must be memory, sqlite:<path> or firestore",
  );
}

/**
 * How many proxy hops set X-Forwarded-For: SONOLECT_SYNC_TRUST_PROXY when
 * set, else 1 on Cloud Run (K_SERVICE is set there: its front end appends
 * the caller's address) and none elsewhere, so a direct caller cannot pick
 * its own IP for the rate limits.
 */
export function parseTrustProxy(env: ServiceEnv): false | number {
  const raw = env.SONOLECT_SYNC_TRUST_PROXY?.trim();
  if (raw === undefined || raw === "") return env.K_SERVICE ? 1 : false;
  if (!HOPS_PATTERN.test(raw))
    throw new ConfigError(
      "SONOLECT_SYNC_TRUST_PROXY must be the number of proxy hops (0 for none)",
    );
  const hops = Number(raw);
  return hops === 0 ? false : hops;
}

/** SONOLECT_SYNC_ALLOWED_ORIGINS: comma-separated origins, or unset (CORS off). */
export function parseAllowedOrigins(env: ServiceEnv): string[] | undefined {
  const raw = env.SONOLECT_SYNC_ALLOWED_ORIGINS?.trim();
  if (!raw) return undefined;
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  for (const origin of origins)
    if (!ORIGIN_PATTERN.test(origin))
      throw new ConfigError(
        `SONOLECT_SYNC_ALLOWED_ORIGINS has an invalid origin: ${JSON.stringify(origin)} (expected scheme://host[:port])`,
      );
  return origins.length > 0 ? origins : undefined;
}

export function readConfig(env: ServiceEnv): SyncServiceConfig {
  return {
    production: env.NODE_ENV === "production",
    store: parseStoreSpec(env),
    trustProxy: parseTrustProxy(env),
    allowedOrigins: parseAllowedOrigins(env),
  };
}
