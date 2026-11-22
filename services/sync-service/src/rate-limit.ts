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

  /** Gives back a request `hit` counted (one that turned out not to count). */
  release(key: string, now: number): void {
    const window = this.current(key, now);
    if (window && window.count > 0) window.count -= 1;
  }
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** The 8 groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(text) || !text.includes(":")) return null;
  // An IPv4 address in the last 32 bits (::ffff:192.0.2.1, 64:ff9b::192.0.2.1).
  const v4 = IPV4_PATTERN.exec(text.slice(text.lastIndexOf(":") + 1));
  if (v4) {
    const bytes = v4.slice(1).map(Number);
    if (bytes.some((byte) => byte > 255)) return null;
    text = `${text.slice(0, text.lastIndexOf(":") + 1)}${(
      (bytes[0]! << 8) |
      bytes[1]!
    ).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [
    ...head,
    ...Array<string>(Math.max(0, missing)).fill("0"),
    ...tail,
  ];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/**
 * The key an IP limit counts under. An IPv4 address counts alone. An IPv6
 * client usually holds a whole /64 and can pick any address in it, so its
 * /64 prefix counts as one. An IPv4 address mapped into IPv6
 * (::ffff:192.0.2.1) counts as that IPv4 address.
 */
export function clientKey(address: string): string {
  const groups = ipv6Groups(address);
  if (!groups) return address;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff)
    return [
      groups[6]! >> 8,
      groups[6]! & 255,
      groups[7]! >> 8,
      groups[7]! & 255,
    ].join(".");
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/** Retry-After in whole seconds (at least 1). */
export const retryAfterSeconds = (waitMs: number): number =>
  Math.max(1, Math.ceil(waitMs / 1000));
