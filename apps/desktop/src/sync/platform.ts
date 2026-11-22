/**
 * What note sync needs from the desktop app, passed in so that the sync
 * modules run unchanged in Node tests, and against a real sync server with a
 * fake native side.
 */
import type { RandomBytes } from "@sonolect/sync-core";

/** Calls a native command, as Tauri's `invoke` does. */
export type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SyncPlatform {
  invoke: Invoke;
  timers: Timers;
  /** Wall clock in ms. */
  now(): number;
  /** Cryptographically secure random bytes (root keys, device ids, nonces). */
  randomBytes: RandomBytes;
  /** A number in [0, 1), to spread retries. */
  random(): number;
}

/** Preferences kept in the webview (localStorage in the app). */
export type PreferenceStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/**
 * A native command failed: Rust answers with an English sentence (or, for
 * `sync_request`, an object with a message). Always an Error from here on.
 */
export function nativeError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  const message =
    typeof reason === "object" && reason !== null
      ? (reason as { message?: unknown }).message
      : undefined;
  return new Error(typeof message === "string" ? message : String(reason));
}

/** Tauri's invoke, loaded on first use like the rest of the app does. */
export const tauriInvoke: Invoke = async (command, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
};

/** The platform of the installed app. */
export function appPlatform(): SyncPlatform {
  return {
    invoke: tauriInvoke,
    timers: {
      setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    random: () => Math.random(),
  };
}
