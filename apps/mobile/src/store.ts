import { create } from "zustand";

import type {
  AuthSnapshot,
  CaptureSession,
  CompanionSettings,
  TranscriptTurn,
} from "./domain";
import { DEFAULT_SETTINGS } from "./domain";
import {
  mobileAudioCaptureAdapter,
  refineText,
  stopCaptureWithAudio,
} from "./audioCapture";
import {
  fetchLocalTranscriptHistory,
  mergeTranscriptHistory,
  resolveMobileLocalApiConfig,
  syncQueuedTranscriptTurns,
} from "./localApi";
import { notificationGateway } from "./notifications";
import { mobileStorage } from "./storage";
import type { SonolectMode } from "@sonolect/types";

import type { DictionaryEntry } from "./dictionaryCrud";
import {
  addEntry as addDictEntry,
  removeEntry as removeDictEntry,
  loadDictionary,
  saveDictionary,
} from "./dictionaryCrud";
import type { Snippet } from "./snippetCrud";
import {
  addSnippet as addSnip,
  removeSnippet as removeSnip,
  loadSnippets,
  saveSnippets,
} from "./snippetCrud";
import type { RetentionPolicy } from "./retentionControls";
import {
  DEFAULT_RETENTION_POLICY,
  loadRetentionPolicy,
  saveRetentionPolicy,
  validateRetentionPolicy,
} from "./retentionControls";
import type { SearchResult } from "./searchAndFilter";

interface CompanionState {
  hydrated: boolean;
  auth: AuthSnapshot;
  settings: CompanionSettings;
  history: TranscriptTurn[];
  capture: CaptureSession;

  // ── New module state ───────────────────────────────────────────────
  dictionaryEntries: DictionaryEntry[];
  snippets: Snippet[];
  activeStylePreset: string;
  searchQuery: string;
  searchResults: SearchResult[];
  retentionPolicy: RetentionPolicy;

  // ── Existing actions ───────────────────────────────────────────────
  hydrate: () => Promise<void>;
  startCapture: () => void;
  stopCapture: () => Promise<void>;
  cancelCapture: () => void;
  refineLast: (mode: SonolectMode) => Promise<void>;
  updateSettings: (patch: Partial<CompanionSettings>) => Promise<void>;
  clearHistory: () => Promise<void>;
  markAuthReady: () => Promise<void>;

  // ── New actions ────────────────────────────────────────────────────
  addDictionaryEntry: (spoken: string, replacement: string) => Promise<void>;
  removeDictionaryEntry: (id: string) => Promise<void>;
  addSnippet: (trigger: string, body: string) => Promise<void>;
  removeSnippet: (id: string) => Promise<void>;
  setActiveStylePreset: (presetId: string) => void;
  setSearchQuery: (query: string) => void;
  setRetentionPolicy: (patch: Partial<RetentionPolicy>) => Promise<void>;
}

const initialCapture: CaptureSession = {
  id: "idle",
  status: "idle",
  elapsedMs: 0,
  partialTranscript: "",
};

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadAndSyncHistory(
  settings: CompanionSettings,
  history: TranscriptTurn[],
): Promise<TranscriptTurn[]> {
  const syncedHistory = await syncHistoryWhenConfigured(settings, history);
  const config = resolveMobileLocalApiConfig(settings);
  if (!config.apiUrl) return syncedHistory;

  try {
    const remoteHistory = await fetchLocalTranscriptHistory(config);
    return mergeTranscriptHistory(syncedHistory, remoteHistory);
  } catch {
    return syncedHistory;
  }
}

async function syncHistoryWhenConfigured(
  settings: CompanionSettings,
  history: TranscriptTurn[],
): Promise<TranscriptTurn[]> {
  const config = resolveMobileLocalApiConfig(settings);
  if (!config.apiUrl) return history;
  return syncQueuedTranscriptTurns(history, config);
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  hydrated: false,
  auth: { status: "guest" },
  settings: DEFAULT_SETTINGS,
  history: [],
  capture: initialCapture,

  // ── New module initial state ─────────────────────────────────────
  dictionaryEntries: [],
  snippets: [],
  activeStylePreset: "concise",
  searchQuery: "",
  searchResults: [],
  retentionPolicy: { ...DEFAULT_RETENTION_POLICY },

  hydrate: async () => {
    const [
      auth,
      settings,
      history,
      dictionaryEntries,
      snippets,
      retentionPolicy,
    ] = await Promise.all([
      mobileStorage.loadAuth(),
      mobileStorage.loadSettings(),
      mobileStorage.loadHistory(),
      loadDictionary(),
      loadSnippets(),
      loadRetentionPolicy(),
    ]);

    const syncedHistory = await loadAndSyncHistory(settings, history);
    set({
      auth,
      settings,
      history: syncedHistory,
      dictionaryEntries,
      snippets,
      retentionPolicy,
      hydrated: true,
    });
    if (syncedHistory !== history) {
      await mobileStorage.saveHistory(syncedHistory);
    }
  },

  startCapture: () => {
    const settings = get().settings;
    void mobileAudioCaptureAdapter.start();
    set({
      capture: {
        id: id("capture"),
        status: "listening",
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        partialTranscript:
          settings.privacyLevel === "ephemeral"
            ? "Mode éphémère: aucune sauvegarde."
            : "Écoute en cours…",
      },
    });
  },

  stopCapture: async () => {
    const { capture, settings, history } = get();
    if (capture.status !== "listening") {
      return;
    }

    set({
      capture: {
        ...capture,
        status: "processing",
        partialTranscript: "Transcription et raffinage…",
      },
    });

    const transcript = await stopCaptureWithAudio({
      captureStartedAt: capture.startedAt,
      settings,
      historyLength: history.length,
    });

    const nextHistory =
      settings.saveHistory && settings.privacyLevel !== "ephemeral"
        ? [transcript, ...history].slice(0, 25)
        : history;
    set({
      history: nextHistory,
      capture: {
        ...initialCapture,
        status: "ready",
        partialTranscript: transcript.refinedText,
      },
    });

    if (settings.saveHistory && settings.privacyLevel !== "ephemeral") {
      const syncedHistory = await syncHistoryWhenConfigured(
        settings,
        nextHistory,
      );
      set({ history: syncedHistory });
      await mobileStorage.saveHistory(syncedHistory);
    }

    if (settings.notificationsEnabled) {
      await notificationGateway.schedule({
        id: id("notification"),
        intent: "refinement",
        title: "Dictée prête",
        body: "Votre transcription Sonolect est disponible.",
        createdAt: new Date().toISOString(),
      });
    }
  },

  cancelCapture: () => {
    void mobileAudioCaptureAdapter.cancel();
    set({ capture: initialCapture });
  },

  refineLast: async (mode: SonolectMode) => {
    const { history } = get();
    const [latest, ...rest] = history;
    if (!latest) {
      return;
    }

    const refined: TranscriptTurn = {
      ...latest,
      id: id("turn"),
      mode,
      refinedText: refineText(latest.rawText, mode),
      createdAt: new Date().toISOString(),
      syncState: latest.syncState === "synced" ? "queued" : latest.syncState,
    };
    const nextHistory = [refined, latest, ...rest].slice(0, 25);
    set({ history: nextHistory });
    const syncedHistory = await syncHistoryWhenConfigured(
      get().settings,
      nextHistory,
    );
    set({ history: syncedHistory });
    await mobileStorage.saveHistory(syncedHistory);
  },

  updateSettings: async (patch: Partial<CompanionSettings>) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await mobileStorage.saveSettings(settings);
    if (settings.cloudSyncEnabled) {
      const syncedHistory = await loadAndSyncHistory(settings, get().history);
      set({ history: syncedHistory });
      await mobileStorage.saveHistory(syncedHistory);
    }
  },

  clearHistory: async () => {
    set({ history: [] });
    await mobileStorage.clearHistory();
  },

  markAuthReady: async () => {
    const auth: AuthSnapshot = {
      status: "ready",
      userId: "local-preview-user",
      email: "preview@sonolect.app",
      tokenRef: "secure-store-ready",
    };
    set({ auth });
    await mobileStorage.saveAuth(auth);
  },

  // ── Dictionary actions ───────────────────────────────────────────
  addDictionaryEntry: async (spoken: string, replacement: string) => {
    const next = addDictEntry(get().dictionaryEntries, spoken, replacement);
    set({ dictionaryEntries: next });
    await saveDictionary(next);
  },

  removeDictionaryEntry: async (entryId: string) => {
    const next = removeDictEntry(get().dictionaryEntries, entryId);
    set({ dictionaryEntries: next });
    await saveDictionary(next);
  },

  // ── Snippet actions ──────────────────────────────────────────────
  addSnippet: async (trigger: string, body: string) => {
    const next = addSnip(get().snippets, trigger, body);
    set({ snippets: next });
    await saveSnippets(next);
  },

  removeSnippet: async (snippetId: string) => {
    const next = removeSnip(get().snippets, snippetId);
    set({ snippets: next });
    await saveSnippets(next);
  },

  // ── Style preset action ──────────────────────────────────────────
  setActiveStylePreset: (presetId: string) => {
    set({ activeStylePreset: presetId });
  },

  // ── Search action ────────────────────────────────────────────────
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  // ── Retention policy action ──────────────────────────────────────
  setRetentionPolicy: async (patch: Partial<RetentionPolicy>) => {
    const validated = validateRetentionPolicy({
      ...get().retentionPolicy,
      ...patch,
    });
    set({ retentionPolicy: validated });
    await saveRetentionPolicy(validated);
  },
}));
