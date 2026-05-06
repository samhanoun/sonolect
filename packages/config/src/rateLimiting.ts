/**
 * Rate limiting presets for Sonolect API endpoints.
 *
 * Compatible with @fastify/rate-limit or any middleware that accepts
 * { max, timeWindow } options.
 */

/* ── Types ─────────────────────────────────────────────────────────── */

export interface RateLimitPreset {
  /** Maximum number of requests allowed in the window. */
  max: number;
  /** Time window in milliseconds. */
  timeWindow: number;
  /** Human-readable label for logging / error messages. */
  label: string;
}

export interface RateLimitConfig {
  /** Authentication endpoints (login, signup, password reset). */
  auth: RateLimitPreset;
  /** Transcription / STT endpoints. */
  transcription: RateLimitPreset;
  /** AI refinement + agent command endpoints. */
  ai: RateLimitPreset;
  /** File upload endpoints. */
  upload: RateLimitPreset;
  /** Billing / subscription endpoints. */
  billing: RateLimitPreset;
  /** All other API endpoints. */
  general: RateLimitPreset;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
const FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;

export function createPreset(
  max: number,
  timeWindow: number,
  label: string,
): RateLimitPreset {
  return { max, timeWindow, label };
}

/* ── Default presets ───────────────────────────────────────────────── */

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  auth: createPreset(5, FIFTEEN_MINUTES_MS, "auth"),
  transcription: createPreset(30, ONE_MINUTE_MS, "transcription"),
  ai: createPreset(20, ONE_MINUTE_MS, "ai"),
  upload: createPreset(10, ONE_MINUTE_MS, "upload"),
  billing: createPreset(10, FIVE_MINUTES_MS, "billing"),
  general: createPreset(100, ONE_MINUTE_MS, "general"),
};

/* ── Builder for custom configs ────────────────────────────────────── */

/**
 * Merge partial overrides into the default rate limit config.
 *
 * ```ts
 * const limits = buildRateLimitConfig({
 *   auth: { max: 3 },           // tighten auth
 *   general: { max: 200 },      // relax general
 * });
 * ```
 */
export function buildRateLimitConfig(
  overrides: {
    [K in keyof RateLimitConfig]?: Partial<RateLimitPreset>;
  } = {},
): RateLimitConfig {
  const result = { ...DEFAULT_RATE_LIMITS };

  for (const key of Object.keys(overrides) as (keyof RateLimitConfig)[]) {
    const base = DEFAULT_RATE_LIMITS[key];
    const patch = overrides[key];
    if (base && patch) {
      result[key] = {
        max: patch.max ?? base.max,
        timeWindow: patch.timeWindow ?? base.timeWindow,
        label: patch.label ?? base.label,
      };
    }
  }

  return result;
}

/* ── Fastify plugin helper ─────────────────────────────────────────── */

/**
 * Convert a RateLimitPreset to @fastify/rate-limit route options.
 *
 * Usage:
 * ```ts
 * import rateLimit from "@fastify/rate-limit";
 * import { DEFAULT_RATE_LIMITS, toFastifyRateLimitOptions } from "@sonolect/config/rateLimiting";
 *
 * // Global limiter
 * app.register(rateLimit, toFastifyRateLimitOptions(DEFAULT_RATE_LIMITS.general));
 *
 * // Per-route
 * app.get("/auth/login", {
 *   config: { rateLimit: toFastifyRateLimitOptions(DEFAULT_RATE_LIMITS.auth) },
 * }, handler);
 * ```
 */
export function toFastifyRateLimitOptions(preset: RateLimitPreset) {
  return {
    max: preset.max,
    timeWindow: preset.timeWindow,
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  };
}
