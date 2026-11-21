/**
 * The sync engine's state on desktop: sync-core's key-value layout ("meta"
 * and 64 buckets "r.<c>"), kept by the native side as one file per key in
 * the app's data folder (`sync_state_*`). The values are mirrored here, and
 * each engine save becomes one native call that writes the buckets it
 * touched, then the meta.
 */
import {
  type KeyValueStorage,
  type SyncStateStore,
  createKeyValueStateStore,
} from "@sonolect/sync-core";

import { type Invoke, nativeError } from "./platform";

export function createDesktopStateStore(invoke: Invoke): SyncStateStore {
  let values = new Map<string, string>();
  /** Writes not saved yet: a value, or null to remove the key. */
  let unsaved = new Map<string, string | null>();

  const kv: KeyValueStorage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
      unsaved.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
      unsaved.set(key, null);
    },
  };
  const store = createKeyValueStateStore(kv, "");

  const flush = async () => {
    if (unsaved.size === 0) return;
    const writes = unsaved;
    unsaved = new Map();
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [key, value] of writes)
      if (value === null) remove.push(key);
      else set[key] = value;
    try {
      await invoke("sync_state_save", { set, remove });
    } catch (error) {
      // Kept for the next save; a newer write of the same key wins.
      for (const [key, value] of writes)
        if (!unsaved.has(key)) unsaved.set(key, value);
      throw nativeError(error);
    }
  };

  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    load: () =>
      serialized(async () => {
        let saved: Record<string, string> | null;
        try {
          saved = await invoke<Record<string, string> | null>(
            "sync_state_load",
          );
        } catch (error) {
          throw nativeError(error);
        }
        values = new Map(Object.entries(saved ?? {}));
        unsaved = new Map();
        return store.load();
      }),
    save: (change) =>
      serialized(async () => {
        await store.save(change);
        await flush();
      }),
    clear: () =>
      serialized(async () => {
        await store.clear();
        unsaved = new Map();
        try {
          await invoke("sync_state_clear");
        } catch (error) {
          throw nativeError(error);
        }
        values = new Map();
      }),
  };
}
