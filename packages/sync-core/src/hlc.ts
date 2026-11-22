/**
 * Hybrid logical clock: wall time in milliseconds, a counter for changes
 * within the same millisecond, and the device id as the final tie-break, so
 * two versions of a note always compare the same way on every device.
 */
export interface Hlc {
  /** Milliseconds since the epoch. */
  readonly t: number;
  /** Counter within `t`. */
  readonly c: number;
  /** Device id (random per install and per vault). */
  readonly d: string;
}

/** A remote clock this far ahead of ours is treated as this far ahead, no more. */
export const HLC_MAX_FUTURE_MS = 60 * 60_000;

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  return a.d < b.d ? -1 : a.d > b.d ? 1 : 0;
}

export const hlcEquals = (a: Hlc | undefined, b: Hlc | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.t === b.t && a.c === b.c && a.d === b.d;

export const isHlc = (value: unknown): value is Hlc => {
  if (typeof value !== "object" || value === null) return false;
  const { t, c, d } = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(t) &&
    (t as number) >= 0 &&
    Number.isSafeInteger(c) &&
    (c as number) >= 0 &&
    typeof d === "string" &&
    DEVICE_ID_PATTERN.test(d)
  );
};

/** A copy holding only t, c and d. */
export const toHlc = (value: Hlc): Hlc => ({
  t: value.t,
  c: value.c,
  d: value.d,
});

export class HlcClock {
  private latest: Hlc;

  constructor(
    readonly deviceId: string,
    private readonly now: () => number,
    last?: Hlc,
  ) {
    if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error("invalid device id");
    this.latest = last ? toHlc(last) : { t: 0, c: 0, d: deviceId };
  }

  /** The latest time this clock issued or observed. */
  get last(): Hlc {
    return this.latest;
  }

  /**
   * A new time for a local change, later than every time this clock issued or
   * observed and later than `previous` (the changed note's current HLC), so an
   * edit always wins over the version it replaces, even one stamped by a
   * device whose clock runs ahead.
   */
  tick(previous?: Hlc): Hlc {
    const wall = Math.floor(this.now());
    const t = Math.max(wall, this.latest.t);
    let next: Hlc = {
      t,
      c: t === this.latest.t ? this.latest.c + 1 : 0,
      d: this.deviceId,
    };
    if (previous && compareHlc(next, previous) <= 0)
      next = { t: previous.t, c: previous.c + 1, d: this.deviceId };
    // A note stamped far in the future must not drag the clock with it.
    if (next.t <= wall + HLC_MAX_FUTURE_MS) this.latest = next;
    return next;
  }

  /** Moves the clock forward to a time seen on another device, capped one hour ahead. */
  observe(remote: Hlc): void {
    const cap = Math.floor(this.now()) + HLC_MAX_FUTURE_MS;
    const t = Math.min(remote.t, cap);
    const c = t === remote.t ? remote.c : 0;
    if (t > this.latest.t || (t === this.latest.t && c > this.latest.c))
      this.latest = { t, c, d: this.deviceId };
  }
}
