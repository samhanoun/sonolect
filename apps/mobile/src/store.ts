import { create } from "zustand";

import { stopCaptureWithAudio, buildTurn } from "./audioCapture";
import type {
  CaptureSession,
  CompanionSettings,
  DictionaryEntry,
  RefinementMode,
  Snippet,
  TranscriptTurn,
} from "./domain";
import { DEFAULT_SETTINGS, HISTORY_LIMIT, createId } from "./domain";
import {
  fetchLocalTranscriptHistory,
  mergeTranscriptHistory,
  refineWithApi,
  resolveMobileLocalApiConfig,
  syncQueuedTranscriptTurns,
} from "./localApi";
import {
  cleanTranscript,
  modeNeedsModel,
  refineLocally,
  stylePresetForMode,
} from "./refine";
import type { SpeechSession } from "./speech";
import {
  getSpeechAvailability,
  requestMicrophonePermission,
  startSpeechSession,
} from "./speech";
import { mobileStorage } from "./storage";

export type CaptureNotice =
  | "none"
  | "noSpeech"
  | "unavailable"
  | "permissionDenied"
  | "needsModel"
  | "error";

interface CompanionState {
  hydrated: boolean;
  settings: CompanionSettings;
  apiToken?: string | undefined;
  history: TranscriptTurn[];
  /** The most recent capture, kept even in ephemeral mode until cleared. */
  latest?: TranscriptTurn | undefined;
  dictionary: DictionaryEntry[];
  snippets: Snippet[];
  capture: CaptureSession;
  level: number;
  notice: CaptureNotice;
  noticeDetail?: string | undefined;
  refining: boolean;
  hydrate: () => Promise<void>;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  cancelCapture: () => void;
  saveTyped: (text: string) => Promise<void>;
  refine: (turnId: string, mode: RefinementMode) => Promise<void>;
  deleteTurn: (turnId: string) => Promise<void>;
  togglePin: (turnId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  eraseAll: () => Promise<void>;
  updateSettings: (patch: Partial<CompanionSettings>) => Promise<void>;
  setApiToken: (token: string) => Promise<void>;
  addDictionaryEntry: (spoken: string, replacement: string) => Promise<boolean>;
  removeDictionaryEntry: (id: string) => Promise<void>;
  addSnippet: (trigger: string, body: string) => Promise<boolean>;
  removeSnippet: (id: string) => Promise<void>;
  dismissNotice: () => void;
}

const idleCapture: CaptureSession = {
  id: "idle",
  status: "idle",
  elapsedMs: 0,
  partialTranscript: "",
};

let activeSession: SpeechSession | null = null;

function keepsHistory(settings: CompanionSettings): boolean {
  return settings.saveHistory && settings.privacyLevel !== "ephemeral";
}

function apiConfig(settings: CompanionSettings, apiToken?: string) {
  return resolveMobileLocalApiConfig({ ...settings, apiToken });
}

export const useCompanionStore = create<CompanionState>((set, get) => {
  const persistHistory = async (history: TranscriptTurn[]) => {
    const { settings, apiToken } = get();
    const trimmed = history.slice(0, HISTORY_LIMIT);
    set({ history: trimmed });
    if (!keepsHistory(settings)) return;
    const config = apiConfig(settings, apiToken);
    const synced = config.apiUrl
      ? await syncQueuedTranscriptTurns(trimmed, config)
      : trimmed;
    if (synced !== trimmed) set({ history: synced });
    await mobileStorage.saveHistory(synced);
  };

  const addTurn = async (turn: TranscriptTurn) => {
    set({ latest: turn });
    if (keepsHistory(get().settings)) {
      await persistHistory([turn, ...get().history]);
    }
  };

  const replaceTurn = async (turn: TranscriptTurn) => {
    if (get().latest?.id === turn.id) set({ latest: turn });
    const history = get().history.map((item) =>
      item.id === turn.id ? turn : item,
    );
    await persistHistory(history);
  };

  return {
    hydrated: false,
    settings: DEFAULT_SETTINGS,
    history: [],
    dictionary: [],
    snippets: [],
    capture: idleCapture,
    level: 0,
    notice: "none",
    refining: false,

    hydrate: async () => {
      const [settings, history, dictionary, snippets, apiToken] =
        await Promise.all([
          mobileStorage.loadSettings(),
          mobileStorage.loadHistory(),
          mobileStorage.loadDictionary(),
          mobileStorage.loadSnippets(),
          mobileStorage.loadApiToken(),
        ]);
      set({
        settings,
        history,
        dictionary,
        snippets,
        ...(apiToken ? { apiToken } : {}),
        latest: history[0],
        hydrated: true,
      });

      const config = apiConfig(settings, apiToken);
      if (!config.apiUrl || !keepsHistory(settings)) return;
      try {
        const synced = await syncQueuedTranscriptTurns(history, config);
        const remote = await fetchLocalTranscriptHistory(config);
        const merged = mergeTranscriptHistory(synced, remote);
        set({ history: merged, latest: merged[0] });
        await mobileStorage.saveHistory(merged);
      } catch {
        // Offline: keep local history as is.
      }
    },

    startCapture: async () => {
      if (get().capture.status === "listening") return;
      const availability = getSpeechAvailability();
      if (!availability.available) {
        set({
          notice: "unavailable",
          capture: { ...idleCapture, status: "error" },
        });
        return;
      }
      const permission = await requestMicrophonePermission();
      if (permission !== "granted") {
        set({
          notice:
            permission === "unsupported" ? "unavailable" : "permissionDenied",
          capture: { ...idleCapture, status: "error" },
        });
        return;
      }

      const { settings, apiToken } = get();
      const startedAt = new Date().toISOString();
      const captureId = createId("capture");
      set({
        notice: "none",
        level: 0,
        capture: {
          id: captureId,
          status: "listening",
          startedAt,
          elapsedMs: 0,
          partialTranscript: "",
        },
      });

      activeSession = startSpeechSession(
        {
          language: settings.language,
          requireOnDevice: settings.privacyLevel !== "standard",
          persistAudio: Boolean(apiConfig(settings, apiToken).apiUrl),
        },
        {
          onTranscript: (text) => {
            const capture = get().capture;
            if (capture.id !== captureId) return;
            set({ capture: { ...capture, partialTranscript: text } });
          },
          onLevel: (level) => {
            if (get().capture.id === captureId) set({ level });
          },
          onError: (code, message) => {
            if (get().capture.id !== captureId) return;
            const notice: CaptureNotice =
              code === "not-allowed" ? "permissionDenied" : "error";
            set({ notice, noticeDetail: message });
          },
          onEnd: async ({ text, audio }) => {
            activeSession = null;
            const capture = get().capture;
            if (capture.id !== captureId) return;
            set({
              level: 0,
              capture: { ...capture, status: "processing" },
            });
            const state = get();
            const turn = await stopCaptureWithAudio({
              captureStartedAt: startedAt,
              settings: { ...state.settings, apiToken: state.apiToken },
              recognizedText: text,
              audio,
              dictionary: state.dictionary,
              snippets: state.snippets,
            });
            if (get().capture.id !== captureId) return;
            if (!turn) {
              set({
                capture: { ...idleCapture },
                notice: get().notice === "none" ? "noSpeech" : get().notice,
              });
              return;
            }
            set({
              capture: {
                ...idleCapture,
                status: "ready",
                partialTranscript: turn.refinedText,
              },
            });
            await addTurn(turn);
          },
        },
      );

      if (!activeSession) {
        set({
          capture: { ...idleCapture, status: "error" },
          notice: "unavailable",
        });
      }
    },

    stopCapture: () => {
      if (get().capture.status !== "listening") return;
      set({ capture: { ...get().capture, status: "processing" } });
      activeSession?.stop();
    },

    cancelCapture: () => {
      activeSession?.abort();
      activeSession = null;
      set({ capture: idleCapture, level: 0 });
    },

    saveTyped: async (text: string) => {
      const raw = text.trim();
      if (!raw) return;
      const { settings, dictionary, snippets } = get();
      const turn = buildTurn({
        settings,
        rawText: raw,
        refinedText: cleanTranscript(raw, {
          language: settings.language,
          dictionary,
          snippets,
        }),
        startedAtMs: Date.now(),
        durationMs: 0,
        source: "typed",
      });
      set({
        notice: "none",
        capture: {
          ...idleCapture,
          status: "ready",
          partialTranscript: turn.refinedText,
        },
      });
      await addTurn(turn);
    },

    refine: async (turnId: string, mode: RefinementMode) => {
      const { history, latest, settings, apiToken, dictionary, snippets } =
        get();
      const source =
        history.find((turn) => turn.id === turnId) ??
        (latest?.id === turnId ? latest : undefined);
      if (!source) return;
      set({ refining: true, notice: "none" });

      const context = { language: source.language, dictionary, snippets };
      let refinedText = refineLocally(source.rawText, mode, context);
      let notice: CaptureNotice = "none";

      const config = apiConfig(settings, apiToken);
      if (config.apiUrl) {
        const result = await refineWithApi(
          source.rawText,
          stylePresetForMode(mode),
          config,
          {
            locale: source.language,
            dictionary: dictionary.map((entry) => ({
              spoken: entry.spoken,
              written: entry.replacement,
            })),
          },
        );
        if (result.status === "completed") refinedText = result.text;
        else if (modeNeedsModel(mode)) notice = "needsModel";
      } else if (modeNeedsModel(mode)) {
        notice = "needsModel";
      }

      const refined: TranscriptTurn = {
        ...source,
        mode,
        refinedText,
        syncState:
          source.syncState === "synced" || source.syncState === "queued"
            ? "queued"
            : source.syncState,
      };
      set({ refining: false, notice });
      if (get().latest?.id === turnId) set({ latest: refined });
      if (history.some((turn) => turn.id === turnId)) {
        await replaceTurn(refined);
      }
    },

    deleteTurn: async (turnId: string) => {
      if (get().latest?.id === turnId) set({ latest: undefined });
      await persistHistory(get().history.filter((turn) => turn.id !== turnId));
    },

    togglePin: async (turnId: string) => {
      const turn = get().history.find((item) => item.id === turnId);
      if (!turn) return;
      await replaceTurn({ ...turn, pinned: !turn.pinned });
    },

    clearHistory: async () => {
      set({ history: [], latest: undefined });
      await mobileStorage.clearHistory();
    },

    eraseAll: async () => {
      activeSession?.abort();
      activeSession = null;
      await mobileStorage.eraseAll();
      set({
        settings: DEFAULT_SETTINGS,
        history: [],
        latest: undefined,
        dictionary: [],
        snippets: [],
        apiToken: undefined,
        capture: idleCapture,
        notice: "none",
      });
    },

    updateSettings: async (patch: Partial<CompanionSettings>) => {
      const previous = get().settings;
      const settings = { ...previous, ...patch };
      set({ settings });
      await mobileStorage.saveSettings(settings);
      if (!keepsHistory(settings) && keepsHistory(previous)) {
        // Turning history off or going ephemeral removes what was stored.
        await mobileStorage.clearHistory();
        set({ history: [] });
      }
      if (settings.cloudSyncEnabled && !previous.cloudSyncEnabled) {
        await persistHistory(
          get().history.map((turn) =>
            turn.syncState === "local"
              ? { ...turn, syncState: "queued" }
              : turn,
          ),
        );
      }
    },

    setApiToken: async (token: string) => {
      const trimmed = token.trim();
      await mobileStorage.saveApiToken(trimmed || undefined);
      set(trimmed ? { apiToken: trimmed } : { apiToken: undefined });
    },

    addDictionaryEntry: async (spoken: string, replacement: string) => {
      const s = spoken.trim();
      const r = replacement.trim();
      if (!s || !r) return false;
      const existing = get().dictionary;
      if (
        existing.some((entry) => entry.spoken.toLowerCase() === s.toLowerCase())
      ) {
        return false;
      }
      const dictionary = [
        ...existing,
        { id: createId("dict"), spoken: s, replacement: r },
      ];
      set({ dictionary });
      await mobileStorage.saveDictionary(dictionary);
      return true;
    },

    removeDictionaryEntry: async (id: string) => {
      const dictionary = get().dictionary.filter((entry) => entry.id !== id);
      set({ dictionary });
      await mobileStorage.saveDictionary(dictionary);
    },

    addSnippet: async (trigger: string, body: string) => {
      const t = trigger.trim();
      const b = body.trim();
      if (!t || !b) return false;
      const existing = get().snippets;
      if (
        existing.some(
          (snippet) => snippet.trigger.toLowerCase() === t.toLowerCase(),
        )
      ) {
        return false;
      }
      const snippets = [
        ...existing,
        { id: createId("snippet"), trigger: t, body: b },
      ];
      set({ snippets });
      await mobileStorage.saveSnippets(snippets);
      return true;
    },

    removeSnippet: async (id: string) => {
      const snippets = get().snippets.filter((snippet) => snippet.id !== id);
      set({ snippets });
      await mobileStorage.saveSnippets(snippets);
    },

    dismissNotice: () => set({ notice: "none", noticeDetail: undefined }),
  };
});
