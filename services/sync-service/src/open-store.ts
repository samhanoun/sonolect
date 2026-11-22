import type { StoreSpec } from "./config.js";
import { MemoryStore } from "./memory-store.js";
import type { VaultStore } from "./store.js";

/**
 * Opens the configured store. SQLite and Firestore are imported only when
 * chosen, so a service on one never loads the other's driver.
 */
export async function openStore(spec: StoreSpec): Promise<VaultStore> {
  switch (spec.kind) {
    case "memory":
      return new MemoryStore();
    case "sqlite": {
      const { SqliteStore } = await import("./sqlite-store.js");
      return SqliteStore.open(spec.path);
    }
    case "firestore": {
      const { FirestoreStore } = await import("./firestore-store.js");
      return FirestoreStore.open({
        projectId: spec.projectId,
        databaseId: spec.databaseId,
      });
    }
  }
}
