import AsyncStorage from "@react-native-async-storage/async-storage";
import { createKeyValueStateStore, type NoteStore } from "@sonolect/sync-core";
import { getRandomValues } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { SYNC_STATE_PREFIX } from "../storageCore";
import { type SyncPause, SyncController } from "./controller";
import { type SecretStore, createSyncKeyStore } from "./keyStore";
import { systemTimers } from "./timers";
import { createFetchRequester } from "./transport";

/**
 * The phone's sync, wired to the platform: AsyncStorage for the sync state,
 * SecureStore for the key, expo-crypto for randomness, fetch for HTTP. Only
 * builds with a sync server create it (features.ts SYNC_URL, never on web).
 */

/** Out of backups and never moved to another device. */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const secrets: SecretStore = {
  getItem: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
};

/**
 * Secure random bytes. getRandomValues is always native: getRandomBytes
 * falls back to Math.random in development builds without the legacy
 * bridge (React Native's new architecture).
 */
export const secureRandomBytes = (length: number): Uint8Array =>
  getRandomValues(new Uint8Array(length));

export function createAppSync(options: {
  serverUrl: string;
  notes: NoteStore;
  paused: () => SyncPause | null;
  retentionDays: () => number;
}): SyncController {
  return new SyncController({
    request: createFetchRequester({
      baseUrl: options.serverUrl,
      fetch: (url, init) => fetch(url, init),
      timers: systemTimers,
    }),
    keyStore: createSyncKeyStore(secrets, AsyncStorage),
    state: createKeyValueStateStore(AsyncStorage, SYNC_STATE_PREFIX),
    kept: AsyncStorage,
    notes: options.notes,
    randomBytes: secureRandomBytes,
    now: Date.now,
    timers: systemTimers,
    paused: options.paused,
    retentionDays: options.retentionDays,
  });
}
