import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { AuthSnapshot, CompanionSettings, TranscriptTurn } from "./domain";
import { DEFAULT_SETTINGS } from "./domain";

const KEYS = {
  auth: "sonolect.mobile.auth",
  settings: "sonolect.mobile.settings",
  history: "sonolect.mobile.history",
} as const;

const memoryStorage = new Map<string, string>();

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return memoryStorage.get(key) ?? null;
  }

  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    memoryStorage.set(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    memoryStorage.delete(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    await deleteItem(key);
    return fallback;
  }
}

export const mobileStorage = {
  async loadAuth(): Promise<AuthSnapshot> {
    return readJson<AuthSnapshot>(KEYS.auth, { status: "guest" });
  },

  async saveAuth(auth: AuthSnapshot): Promise<void> {
    await setItem(KEYS.auth, JSON.stringify(auth));
  },

  async loadSettings(): Promise<CompanionSettings> {
    const saved = await readJson<Partial<CompanionSettings>>(
      KEYS.settings,
      DEFAULT_SETTINGS,
    );
    return { ...DEFAULT_SETTINGS, ...saved };
  },

  async saveSettings(settings: CompanionSettings): Promise<void> {
    await setItem(KEYS.settings, JSON.stringify(settings));
  },

  async loadHistory(): Promise<TranscriptTurn[]> {
    return readJson<TranscriptTurn[]>(KEYS.history, []);
  },

  async saveHistory(history: TranscriptTurn[]): Promise<void> {
    await setItem(KEYS.history, JSON.stringify(history.slice(0, 25)));
  },

  async clearHistory(): Promise<void> {
    await deleteItem(KEYS.history);
  },
};
