import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type {
  CompanionSettings,
  DictionaryEntry,
  Snippet,
  TranscriptTurn,
} from "./domain";
import { HISTORY_LIMIT, normalizeSettings } from "./domain";

/**
 * Settings, history, dictionary and snippets live in the app sandbox via
 * AsyncStorage (SecureStore caps values at ~2 KB, too small for history).
 * The API access token is the only secret and stays in SecureStore
 * (Keychain / Keystore). On web, the token is kept in memory only.
 */
const KEYS = {
  settings: "sonolect.mobile.settings",
  history: "sonolect.mobile.history.v2",
  legacyHistory: "sonolect.mobile.history",
  dictionary: "sonolect.mobile.dictionary",
  snippets: "sonolect.mobile.snippets",
  apiToken: "sonolect.mobile.apiToken",
} as const;

const webSecrets = new Map<string, string>();

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    await AsyncStorage.removeItem(key).catch(() => undefined);
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function isTurn(value: unknown): value is TranscriptTurn {
  const turn = value as TranscriptTurn;
  return (
    typeof turn === "object" &&
    turn !== null &&
    typeof turn.id === "string" &&
    typeof turn.refinedText === "string" &&
    typeof turn.createdAt === "string"
  );
}

export const mobileStorage = {
  async loadSettings(): Promise<CompanionSettings> {
    return normalizeSettings(
      await readJson<Partial<CompanionSettings>>(KEYS.settings, {}),
    );
  },

  async saveSettings(settings: CompanionSettings): Promise<void> {
    await writeJson(KEYS.settings, settings);
  },

  async loadHistory(): Promise<TranscriptTurn[]> {
    const history = await readJson<unknown[]>(KEYS.history, []);
    return Array.isArray(history) ? history.filter(isTurn) : [];
  },

  async saveHistory(history: TranscriptTurn[]): Promise<void> {
    await writeJson(KEYS.history, history.slice(0, HISTORY_LIMIT));
  },

  async clearHistory(): Promise<void> {
    await AsyncStorage.multiRemove([KEYS.history, KEYS.legacyHistory]);
  },

  async loadDictionary(): Promise<DictionaryEntry[]> {
    const entries = await readJson<DictionaryEntry[]>(KEYS.dictionary, []);
    return Array.isArray(entries)
      ? entries.filter(
          (entry) =>
            typeof entry?.id === "string" &&
            typeof entry.spoken === "string" &&
            typeof entry.replacement === "string",
        )
      : [];
  },

  async saveDictionary(entries: DictionaryEntry[]): Promise<void> {
    await writeJson(KEYS.dictionary, entries);
  },

  async loadSnippets(): Promise<Snippet[]> {
    const snippets = await readJson<Snippet[]>(KEYS.snippets, []);
    return Array.isArray(snippets)
      ? snippets.filter(
          (snippet) =>
            typeof snippet?.id === "string" &&
            typeof snippet.trigger === "string" &&
            typeof snippet.body === "string",
        )
      : [];
  },

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    await writeJson(KEYS.snippets, snippets);
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
    if (trimmed) await SecureStore.setItemAsync(KEYS.apiToken, trimmed);
    else await SecureStore.deleteItemAsync(KEYS.apiToken);
  },

  /** Removes everything Sonolect stored on this device. */
  async eraseAll(): Promise<void> {
    await AsyncStorage.multiRemove([
      KEYS.settings,
      KEYS.history,
      KEYS.legacyHistory,
      KEYS.dictionary,
      KEYS.snippets,
    ]);
    await this.saveApiToken(undefined);
  },
};
