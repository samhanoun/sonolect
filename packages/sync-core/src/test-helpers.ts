import { randomBytes as nodeRandomBytes } from "node:crypto";

import { deriveVaultKeys, generateRootKey } from "./keys";
import { syncNote, type SyncNote } from "./payload";

export const randomBytes = (length: number): Uint8Array =>
  new Uint8Array(nodeRandomBytes(length));

/** Root key 0, 1, …, 31: the key of the known-answer vectors. */
export const VECTOR_ROOT = Uint8Array.from({ length: 32 }, (_, i) => i);

export const newKeys = () => deriveVaultKeys(generateRootKey(randomBytes));

export function note(rawText: string, extra: Partial<SyncNote> = {}): SyncNote {
  return syncNote({
    createdAt: "2026-11-01T09:00:00.000Z",
    rawText,
    durationMs: 1000,
    origin: "desktop",
    ...extra,
  });
}

/** A clock tests move by hand. */
export function manualClock(start = Date.parse("2026-11-20T12:00:00.000Z")) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
    set(ms: number) {
      time = ms;
    },
  };
}

export const DAY = 24 * 60 * 60_000;
