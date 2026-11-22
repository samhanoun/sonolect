/**
 * Shared by the service's tests (not a test file itself): keys, sealed-looking
 * payloads, a hand-moved clock and the store factories.
 */
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveVaultKeys, generateRootKey } from "@sonolect/sync-core";

import { MemoryStore } from "./memory-store.js";
import { SqliteStore } from "./sqlite-store.js";
import type { VaultStore } from "./store.js";

export const randomBytes = (size: number): Uint8Array =>
  new Uint8Array(nodeRandomBytes(size));

export const DAY = 24 * 60 * 60_000;

export const newKeys = () => deriveVaultKeys(generateRootKey(randomBytes));

/** Opaque bytes the size of a sealed record (the server cannot tell). */
export const sealedBytes = (size = 300): Uint8Array => randomBytes(size);

export const b64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

/** A record id: 18 random bytes as base64url. */
export const newRid = (): string => b64(randomBytes(18));

/** A vault id: 16 random bytes as base64url. */
export const newVaultId = (): string => b64(randomBytes(16));

/** A verifier: 32 random bytes as base64url. */
export const newVerifier = (): string => b64(randomBytes(32));

/** A clock tests move by hand. */
export function manualClock(start = Date.parse("2026-11-20T12:00:00.000Z")) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) {
      time += ms;
    },
  };
}

export interface StoreFactory {
  label: string;
  /** A fresh, empty store. */
  open(): Promise<VaultStore>;
  /** Removes what the factory created (files). */
  cleanup?(): void;
}

export const memoryStores: StoreFactory = {
  label: "memory",
  open: async () => new MemoryStore(),
};

/** SQLite stores, each in its own file under one temporary directory. */
export function sqliteStores(): StoreFactory {
  let directory: string | undefined;
  let count = 0;
  return {
    label: "sqlite",
    async open() {
      directory ??= mkdtempSync(join(tmpdir(), "sonolect-sync-test-"));
      count += 1;
      // A nested path: the store creates missing directories.
      return SqliteStore.open(join(directory, `db-${count}`, "sync.db"));
    },
    cleanup() {
      if (directory) rmSync(directory, { recursive: true, force: true });
    },
  };
}
