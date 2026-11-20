import { BoundedMap } from "@sonolect/service-kit";

interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window counters per key (an IP address or a vault id), in memory per
 * instance: with N instances a client gets up to N times the limit. The map
 * is bounded, so a flood of keys costs memory once and then evicts the
 * oldest windows.
 */
export class FixedWindowLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly windows: BoundedMap<string, Window>;

  constructor(limit: number, windowMs: number, maxKeys = 50_000) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("limit must be a positive integer");
    if (!Number.isInteger(windowMs) || windowMs < 1)
      throw new Error("windowMs must be a positive integer");
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new BoundedMap(maxKeys);
  }

  private current(key: string, now: number): Window | undefined {
    const window = this.windows.get(key);
    return window && now - window.start < this.windowMs ? window : undefined;
  }

  /** Milliseconds until `key` may try again, or 0 when it is under the limit. Does not count. */
  check(key: string, now: number): number {
    const window = this.current(key, now);
    return window && window.count >= this.limit
      ? window.start + this.windowMs - now
      : 0;
  }

  /** Counts one request for `key`; returns check()'s answer from before it. Refused requests do not count. */
  hit(key: string, now: number): number {
    const wait = this.check(key, now);
    if (wait > 0) return wait;
    const window = this.current(key, now);
    if (window) window.count += 1;
    else {
      // Re-inserted, so the map evicts the windows that started longest ago.
      this.windows.delete(key);
      this.windows.set(key, { start: now, count: 1 });
    }
    return 0;
  }
}

/** Retry-After in whole seconds (at least 1). */
export const retryAfterSeconds = (waitMs: number): number =>
  Math.max(1, Math.ceil(waitMs / 1000));
