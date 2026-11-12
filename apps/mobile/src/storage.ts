import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";

import type {
  CompanionSettings,
  DictionaryEntry,
  Snippet,
  TranscriptTurn,
} from "./domain";
import { DEFAULT_SETTINGS, normalizeSettings } from "./domain";
import { resolveInitialSettings } from "./firstRun";
import type { NotesLoad } from "./storageCore";
import {
  INDEX_KEY,
  LEGACY_V1_KEY,
  LEGACY_V2_KEY,
  asRecord,
  createJsonStore,
  createNoteStore,
  sanitizeDictionary,
  sanitizeSnippets,
} from "./storageCore";

/**
 * Settings, notes, dictionary and snippets live in the app sandbox via
 * AsyncStorage (SecureStore caps values at ~2 KB). Notes are stored one key
 * per note (storageCore.ts). Nothing is deleted on a read error. The API
 * access token is the only secret and stays in SecureStore (Keychain /
 * Keystore). On web, the token is kept in memory only.
 */
const KEY_PREFIX = "sonolect.mobile.";
const KEYS = {
  settings: "sonolect.mobile.settings",
  dictionary: "sonolect.mobile.dictionary",
  snippets: "sonolect.mobile.snippets",
  apiToken: "sonolect.mobile.apiToken",
} as const;
/** v0.1's SecureStore session key. */
const LEGACY_AUTH_KEY = "sonolect.mobile.auth";
const REMOVE_BATCH = 50;

const notes = createNoteStore(AsyncStorage);
const values = createJsonStore(AsyncStorage);
const webSecrets = new Map<string, string>();

let legacyMigration: Promise<void> | undefined;

/**
 * Version 0.1 kept settings and history in SecureStore. Copy them into
 * AsyncStorage once (only where nothing newer exists), then delete the
 * SecureStore copies. The history goes to the v2 key, which the note store
 * then moves to one key per note without v0.1's sample sentences. Runs at
 * most once per launch.
 */
function migrateLegacySecureStore(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  legacyMigration ??= (async () => {
    try {
      const [legacySettings, legacyHistory] = await Promise.all([
        SecureStore.getItemAsync(KEYS.settings),
        SecureStore.getItemAsync(LEGACY_V1_KEY),
      ]);
      // Keys only: a value too large to read must not stop the migration.
      const stored = new Set(
        legacySettings || legacyHistory ? await AsyncStorage.getAllKeys() : [],
      );
      if (legacySettings && !stored.has(KEYS.settings)) {
        await AsyncStorage.setItem(KEYS.settings, legacySettings);
      }
      if (
        legacyHistory &&
        !stored.has(LEGACY_V2_KEY) &&
        !stored.has(INDEX_KEY)
      ) {
        await AsyncStorage.setItem(LEGACY_V2_KEY, legacyHistory);
      }
      await Promise.all([
        legacySettings ? SecureStore.deleteItemAsync(KEYS.settings) : undefined,
        legacyHistory ? SecureStore.deleteItemAsync(LEGACY_V1_KEY) : undefined,
        SecureStore.deleteItemAsync(LEGACY_AUTH_KEY).catch(() => undefined),
      ]);
    } catch {
      // Keep the legacy copies so the next launch can retry.
      legacyMigration = undefined;
    }
  })();
  return legacyMigration;
}

/**
 * The settings of a first run: the defaults, with the app and dictation
 * languages taken from the device's preferred languages (ux-5). Also what
 * Erase all data goes back to.
 */
export function deviceDefaultSettings(): CompanionSettings {
  let locales: ReturnType<typeof getLocales> | [] = [];
  try {
    locales = getLocales();
  } catch {
    // English defaults.
  }
  return normalizeSettings(undefined, {
    ...DEFAULT_SETTINGS,
    ...resolveInitialSettings(locales),
  });
}

/** What a load read. ok false: a read failed and nothing was deleted. */
export interface Loaded<T> {
  ok: boolean;
  value: T;
}

async function removeKeys(keys: readonly string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += REMOVE_BATCH) {
    await AsyncStorage.multiRemove(keys.slice(start, start + REMOVE_BATCH));
  }
}

export const mobileStorage = {
  async loadSettings(): Promise<Loaded<CompanionSettings>> {
    await migrateLegacySecureStore();
    const read = await values.read(KEYS.settings);
    const saved = read.ok ? asRecord(read.value) : undefined;
    return {
      ok: read.ok,
      // Nothing stored (or nothing usable): a first run follows the device.
      value: saved
        ? normalizeSettings(saved as Partial<CompanionSettings>)
        : deviceDefaultSettings(),
    };
  },

  /** Rejects, writing nothing, when the settings could not be read. */
  async saveSettings(settings: CompanionSettings): Promise<void> {
    await values.write(KEYS.settings, settings);
  },

  /** The notes, newest first, with every one kept (no cap, data-2). */
  async loadNotes(): Promise<NotesLoad> {
    await migrateLegacySecureStore();
    try {
      return await notes.load();
    } catch {
      return { ok: false, notes: [] };
    }
  },

  /**
   * Saves the notes that changed. After a load that failed, saves only add
   * or update notes until a launch reads them all again.
   */
  async saveNotes(history: readonly TranscriptTurn[]): Promise<void> {
    await notes.save(history);
  },

  async clearNotes(): Promise<void> {
    await notes.clear();
    if (Platform.OS !== "web") {
      await SecureStore.deleteItemAsync(LEGACY_V1_KEY).catch(() => undefined);
    }
  },

  async loadDictionary(): Promise<Loaded<DictionaryEntry[]>> {
    const read = await values.read(KEYS.dictionary);
    return {
      ok: read.ok,
      value: read.ok ? sanitizeDictionary(read.value) : [],
    };
  },

  async saveDictionary(entries: DictionaryEntry[]): Promise<void> {
    await values.write(KEYS.dictionary, entries);
  },

  async loadSnippets(): Promise<Loaded<Snippet[]>> {
    const read = await values.read(KEYS.snippets);
    return {
      ok: read.ok,
      value: read.ok ? sanitizeSnippets(read.value) : [],
    };
  },

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    await values.write(KEYS.snippets, snippets);
  },

  async loadApiToken(): Promise<string | undefined> {
    if (Platform.OS === "web") return webSecrets.get(KEYS.apiToken);
    try {
      return (await SecureStore.getItemAsync(KEYS.apiToken)) ?? undefined;
    } catch {
      return undefined;
    }
  },

  async saveApiToken(token: string | undefined): Promise<void> {
    const trimmed = token?.trim();
    if (Platform.OS === "web") {
      if (trimmed) webSecrets.set(KEYS.apiToken, trimmed);
      else webSecrets.delete(KEYS.apiToken);
      return;
    }
    // Delete first: an existing keychain item otherwise keeps the access
    // class it was created with. WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps the
    // token out of backups, so it never moves to another device.
    await SecureStore.deleteItemAsync(KEYS.apiToken);
    if (trimmed) {
      await SecureStore.setItemAsync(KEYS.apiToken, trimmed, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  },

  /**
   * Removes everything Sonolect stored on this device: every AsyncStorage
   * key under 'sonolect.mobile.' (settings, notes, the index, older history
   * values and the copies of broken values) and the SecureStore items.
   */
  async eraseAll(): Promise<void> {
    // Every step runs even when one fails; the first failure is reported.
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    };
    // Through the note store first: it waits for saves in progress and
    // forgets the notes it knew.
    await attempt(() => notes.clear());
    await attempt(async () => {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
        key.startsWith(KEY_PREFIX),
      );
      await removeKeys(keys);
      // Nothing is left to protect: every key may be written again.
      values.reset();
    });
    await attempt(() => this.saveApiToken(undefined));
    if (Platform.OS !== "web") {
      await Promise.all(
        [KEYS.settings, LEGACY_V1_KEY, LEGACY_AUTH_KEY].map((key) =>
          SecureStore.deleteItemAsync(key).catch(() => undefined),
        ),
      );
    }
    if (failures.length > 0) throw failures[0];
  },
};
