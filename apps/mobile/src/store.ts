import { create } from "zustand";

import type {
  AuthSnapshot,
  CaptureSession,
  CompanionSettings,
  TranscriptTurn,
} from "./domain";
import { DEFAULT_SETTINGS, SAMPLE_TRANSCRIPTS } from "./domain";
import {
  fetchLocalTranscriptHistory,
  mergeTranscriptHistory,
  resolveMobileLocalApiConfig,
  syncQueuedTranscriptTurns,
} from "./localApi";
import { notificationGateway } from "./notifications";
import { mobileStorage } from "./storage";
import type { SonolectMode } from "@sonolect/types";

interface CompanionState {
  hydrated: boolean;
  auth: AuthSnapshot;
  settings: CompanionSettings;
  history: TranscriptTurn[];
  capture: CaptureSession;
  hydrate: () => Promise<void>;
  startCapture: () => void;
  stopCapture: () => Promise<void>;
  cancelCapture: () => void;
  refineLast: (mode: SonolectMode) => Promise<void>;
  updateSettings: (patch: Partial<CompanionSettings>) => Promise<void>;
  clearHistory: () => Promise<void>;
  markAuthReady: () => Promise<void>;
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

function refineText(rawText: string, mode: SonolectMode): string {
  const cleaned = rawText.trim().replace(/\s+/g, " ");

  switch (mode) {
    case "summarize":
      return `Résumé — ${cleaned}.\n\nActions: vérifier le contexte, confirmer le destinataire, envoyer une version concise.`;
    case "reply":
      return `Bonjour, merci pour le retour. Je valide l'approche et je reviens vers vous avec une version finalisée rapidement.`;
    case "task_creation":
      return `À faire\n• Clarifier la demande\n• Préparer la réponse\n• Programmer le suivi`;
    case "translate":
      return `Translation draft — ${cleaned}`;
    case "command":
      return `Commande détectée: ${cleaned}`;
    case "code":
      return `Note technique: ${cleaned}`;
    case "meeting_notes":
      return `Notes de réunion\n• ${cleaned}\n• Décisions et prochaines étapes à confirmer.`;
    case "rewrite":
      return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} Merci de me confirmer si cela vous convient.`;
    case "dictate":
    default:
      return cleaned;
  }
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

  hydrate: async () => {
    const [auth, settings, history] = await Promise.all([
      mobileStorage.loadAuth(),
      mobileStorage.loadSettings(),
      mobileStorage.loadHistory(),
    ]);

    const syncedHistory = await loadAndSyncHistory(settings, history);
    set({ auth, settings, history: syncedHistory, hydrated: true });
    if (syncedHistory !== history) {
      await mobileStorage.saveHistory(syncedHistory);
    }
  },

  startCapture: () => {
    const settings = get().settings;
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

    const started = capture.startedAt
      ? Date.parse(capture.startedAt)
      : Date.now();
    const sample =
      SAMPLE_TRANSCRIPTS[history.length % SAMPLE_TRANSCRIPTS.length] ??
      SAMPLE_TRANSCRIPTS[0];
    const transcript: TranscriptTurn = {
      id: id("turn"),
      rawText: sample,
      refinedText: refineText(sample, "dictate"),
      mode: "dictate",
      language: settings.language,
      privacyMode: settings.privacyLevel !== "standard",
      createdAt: new Date().toISOString(),
      durationMs: Math.max(1200, Date.now() - started),
      source: "microphone",
      syncState: settings.cloudSyncEnabled ? "queued" : "local",
    };

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

  cancelCapture: () => set({ capture: initialCapture }),

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
}));
