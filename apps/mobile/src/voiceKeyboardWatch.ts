import type { Timers } from "./sync/timers";

/** How often the card reads the keyboard status after the picker opens. */
export const PICKER_POLL_MS = 500;
/** How long it keeps reading; coming back to the app reads it again later. */
export const PICKER_WATCH_MS = 15_000;

/**
 * Reads the voice keyboard's status every `intervalMs` after the system
 * keyboard picker opens, until it differs from what the card showed or
 * `limitMs` pass, then hands over the last status read. The picker's call
 * returns as soon as it shows, and choosing a keyboard there does not send
 * the app to the background, so nothing else would see the change. Returns
 * a function that stops the watch.
 */
export function watchKeyboardChange<T>({
  read,
  changed,
  onStatus,
  timers,
  intervalMs = PICKER_POLL_MS,
  limitMs = PICKER_WATCH_MS,
}: {
  read: () => T;
  changed: (status: T) => boolean;
  onStatus: (status: T) => void;
  timers: Timers;
  intervalMs?: number;
  limitMs?: number;
}): () => void {
  let handle: unknown = null;
  let waited = 0;
  const tick = () => {
    handle = null;
    waited += intervalMs;
    const status = read();
    if (changed(status) || waited >= limitMs) {
      onStatus(status);
      return;
    }
    handle = timers.setTimeout(tick, intervalMs);
  };
  handle = timers.setTimeout(tick, intervalMs);
  return () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
}
