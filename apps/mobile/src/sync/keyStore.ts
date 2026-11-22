import {
  ROOT_KEY_BYTES,
  VAULT_ID_PATTERN,
  base64urlDecode,
  base64urlEncode,
  deriveVaultKeys,
} from "@sonolect/sync-core";

/**
 * The sync key (the vault's 32-byte root key) on this phone.
 *
 * The key lives in SecureStore (Keychain / Keystore) with
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY, so it never reaches a backup or another
 * device. A marker in AsyncStorage names the key's vault. An iOS keychain
 * item survives deleting the app, while the app's storage does not: a key
 * found without its marker belongs to an earlier install and is deleted, so
 * a reinstalled app never syncs by itself.
 */
export const SYNC_KEY_ITEM = "sonolect.mobile.sync.key";
export const SYNC_KEY_MARKER = "sonolect.mobile.sync.keyMarker";

/** expo-secure-store's calls, with the access class set by the caller. */
export interface SecretStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** AsyncStorage's calls the marker needs. */
export interface MarkerStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface SyncKeyStore {
  /**
   * The root key, or null when sync is off. A key without this install's
   * marker, or one that is not a key, is deleted. Throws when the key or
   * the marker cannot be read (a locked device): nothing is deleted then.
   */
  load(): Promise<Uint8Array | null>;
  /** Stores a new key: the marker first, so a failure never leaves a key without one. */
  save(root: Uint8Array): Promise<void>;
  /** Forgets the key: the marker first, so a key left behind is deleted at the next load. */
  remove(): Promise<void>;
  /** The vault the marker names (sync is on with its key), read without the key. */
  vaultId(): Promise<string | null>;
}

const decodeRoot = (raw: string): Uint8Array | null => {
  try {
    const root = base64urlDecode(raw.trim());
    return root.length === ROOT_KEY_BYTES ? root : null;
  } catch {
    return null;
  }
};

export function createSyncKeyStore(
  secrets: SecretStore,
  markers: MarkerStore,
): SyncKeyStore {
  const forget = async () => {
    await markers.removeItem(SYNC_KEY_MARKER);
    await secrets.deleteItem(SYNC_KEY_ITEM);
  };
  return {
    async load() {
      const raw = await secrets.getItem(SYNC_KEY_ITEM);
      const marker = await markers.getItem(SYNC_KEY_MARKER);
      if (raw === null || raw === undefined) {
        if (marker !== null && marker !== undefined)
          await markers.removeItem(SYNC_KEY_MARKER);
        return null;
      }
      const root = decodeRoot(raw);
      if (!root || marker !== deriveVaultKeys(root).vaultId) {
        // Left by an earlier install (or damaged): sync stays off.
        await forget();
        return null;
      }
      return root;
    },
    async save(root) {
      const { vaultId } = deriveVaultKeys(root);
      await markers.setItem(SYNC_KEY_MARKER, vaultId);
      try {
        // Delete first: an existing keychain item keeps the access class it
        // was created with.
        await secrets.deleteItem(SYNC_KEY_ITEM);
        await secrets.setItem(SYNC_KEY_ITEM, base64urlEncode(root));
      } catch (error) {
        await markers.removeItem(SYNC_KEY_MARKER).catch(() => undefined);
        throw error;
      }
    },
    remove: forget,
    async vaultId() {
      const marker = await markers.getItem(SYNC_KEY_MARKER);
      return typeof marker === "string" && VAULT_ID_PATTERN.test(marker)
        ? marker
        : null;
    },
  };
}
