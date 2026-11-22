import type { OnlineProvider } from "./onlineRefine";
import { ONLINE_PROVIDERS, normalizeProviderKey } from "./onlineRefine";

/**
 * The user's own provider keys for online editing (onlineRefine.ts), one
 * SecureStore item per provider. Pure: storage.ts passes expo-secure-store
 * (Keychain on iOS, Keystore on Android), or null on web, where nothing is
 * stored. A key is only ever read to send a note or to learn whether one is
 * saved; it never goes into app state, AsyncStorage, notices or logs.
 */

/** SecureStore item names may only use letters, digits, ".", "-" and "_". */
export const PROVIDER_KEY_ITEMS: Readonly<Record<OnlineProvider, string>> = {
  openrouter: "sonolect.mobile.providerKey.openrouter",
  opencode: "sonolect.mobile.providerKey.opencode",
};

/** The part of expo-secure-store this module uses. */
export interface SecureItemStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: object): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export type ProviderKeyStatus = Record<OnlineProvider, boolean>;

export const NO_PROVIDER_KEYS: Readonly<ProviderKeyStatus> = {
  openrouter: false,
  opencode: false,
};

export interface ProviderKeyStore {
  /** The saved key, or undefined when there is none or it can't be read. */
  load(provider: OnlineProvider): Promise<string | undefined>;
  /** Which providers have a saved key. Keeps only booleans. */
  status(): Promise<ProviderKeyStatus>;
  /**
   * Saves a key. False, with nothing saved, for a key that isn't valid or
   * where there is no SecureStore (web). Rejects when SecureStore fails.
   */
  save(provider: OnlineProvider, key: string): Promise<boolean>;
  remove(provider: OnlineProvider): Promise<void>;
  /** Deletes every provider key; each delete runs even if one fails. */
  removeAll(): Promise<void>;
}

/**
 * @param saveOptions the options of each write. storage.ts passes
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY, so a key is readable only while the phone
 * is unlocked and never moves to another phone.
 */
export function createProviderKeyStore(
  secure: SecureItemStore | null,
  saveOptions: () => object,
): ProviderKeyStore {
  const load = async (
    provider: OnlineProvider,
  ): Promise<string | undefined> => {
    if (!secure) return undefined;
    try {
      const value = await secure.getItemAsync(PROVIDER_KEY_ITEMS[provider]);
      return value ? normalizeProviderKey(value) : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    load,

    async status() {
      const status: ProviderKeyStatus = { ...NO_PROVIDER_KEYS };
      for (const provider of ONLINE_PROVIDERS) {
        status[provider] = (await load(provider)) !== undefined;
      }
      return status;
    },

    async save(provider, key) {
      const normalized = normalizeProviderKey(key);
      if (!secure || !normalized) return false;
      const item = PROVIDER_KEY_ITEMS[provider];
      // Delete first: an existing keychain item otherwise keeps the access
      // class it was created with.
      await secure.deleteItemAsync(item);
      await secure.setItemAsync(item, normalized, saveOptions());
      return true;
    },

    async remove(provider) {
      if (!secure) return;
      await secure.deleteItemAsync(PROVIDER_KEY_ITEMS[provider]);
    },

    async removeAll() {
      if (!secure) return;
      const failures: unknown[] = [];
      for (const provider of ONLINE_PROVIDERS) {
        try {
          await secure.deleteItemAsync(PROVIDER_KEY_ITEMS[provider]);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw failures[0];
    },
  };
}
