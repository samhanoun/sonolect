import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * The system's Reduce Motion and Reduce Transparency settings, read once
 * for the whole app and kept up to date, so a screen full of animated
 * buttons doesn't add a listener per button.
 */
type Preference = "reduceMotion" | "reduceTransparency";

const values: Record<Preference, boolean> = {
  reduceMotion: false,
  reduceTransparency: false,
};
const listeners = new Set<() => void>();
let started = false;

function set(preference: Preference, value: boolean) {
  if (values[preference] === value) return;
  values[preference] = value;
  for (const listener of listeners) listener();
}

/**
 * Reads both settings and listens for changes. react-native-web and
 * Android have no Reduce Transparency, so that one stays off there.
 */
function start() {
  if (started) return;
  started = true;
  const sources: [Preference, string, (() => Promise<boolean>) | undefined][] =
    [
      [
        "reduceMotion",
        "reduceMotionChanged",
        AccessibilityInfo.isReduceMotionEnabled?.bind(AccessibilityInfo),
      ],
      [
        "reduceTransparency",
        "reduceTransparencyChanged",
        AccessibilityInfo.isReduceTransparencyEnabled?.bind(AccessibilityInfo),
      ],
    ];
  for (const [preference, event, read] of sources) {
    if (typeof read !== "function") continue;
    try {
      read()
        .then((value) => set(preference, Boolean(value)))
        .catch(() => undefined);
      AccessibilityInfo.addEventListener(
        event as "reduceMotionChanged",
        (value: boolean) => set(preference, Boolean(value)),
      );
    } catch {
      // Not on this platform: the setting stays off.
    }
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the user asked the system for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => values.reduceMotion,
    () => false,
  );
}

/**
 * True when the user asked for less transparency (iOS): glass becomes
 * opaque, as UIKit's own materials do.
 */
export function useReducedTransparency(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => values.reduceTransparency,
    () => false,
  );
}

// Read the settings before the first screen renders.
start();
