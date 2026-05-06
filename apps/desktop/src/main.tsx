import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import type { SonolectMode } from "@sonolect/types";
import {
  isVoiceApiConfigured,
  submitCapturedAudio,
  type TranscriptJobResult,
  type VoiceCaptureMetadata,
} from "./voiceApi";
import {
  fetchTranscriptDetail,
  fetchTranscriptHistory,
  offlineTranscriptHistory,
  type TranscriptHistoryRow,
} from "./transcriptHistory";
import { resolveDesktopAuthConfig } from "./localDevAuth";
import { useT, useI18nStore, type SupportedLocale } from "./i18n";
import type { LocaleKeys } from "./locales/en";
import {
  saveSettings,
  loadSettings,
  SETTINGS_KEYS,
  saveTranscriptDraft,
  loadTranscriptDraft,
  clearTranscriptDraft,
} from "./persistence";
import { STT_LANGUAGES } from "./sttLanguages";
import {
  assignSpeakerLabel,
  mergeTranscriptSegments,
  segmentsToText,
  splitTranscriptSegment,
  textToSegments,
  type TranscriptSegment,
} from "./segmentEditor";
import { decodeAudioWaveform } from "./waveform";
import {
  WHISPER_MODEL_CATALOG,
  buildWhisperCommandPreview,
  buildWhisperInstallerGuidance,
  commandArgsJsonForEnv,
  getDefaultWhisperInstallPlan,
  getWhisperSetupStatus,
  parseWhisperConfig,
  serializeWhisperConfig,
  validateWhisperConfig,
  type WhisperConfig,
  type WhisperInstallPlatform,
} from "./whisperSetup";
import {
  exportTranscript,
  type TranscriptExportFormat,
} from "./transcriptExport";
import {
  createTranscriptUndoStack,
  type TranscriptUndoSnapshot,
} from "./transcriptUndo";
import {
  buildInsertionPlan,
  isOnboardingComplete,
  normalizeDictionaryEntry,
  normalizeSnippet,
  onboardingProgress,
  polishDictation,
  type DictionaryEntry,
  type OnboardingChecklist,
  type Snippet,
} from "./wisprWorkflow";
import {
  insertTextIntoActiveApp,
  isTauriRuntime,
  registerNativeDictationShortcuts,
} from "./desktopNative";
import { DEFAULT_COMMANDS, searchCommands } from "./commandRegistry";
import type { Command } from "./commandRegistry";
import { getStylePresets, applyStylePreset } from "./stylePresets";
import { computePolishDiff, formatDiffSummary } from "./polishPreview";
import {
  addEntry as dictAddEntry,
  removeEntry as dictRemoveEntry,
  updateEntry as dictUpdateEntry,
  saveDictionary,
} from "./dictionaryCrud";
import {
  addSnippet as snippetAddSnippet,
  removeSnippet as snippetRemoveSnippet,
  updateSnippet as snippetUpdateSnippet,
  saveSnippets as snippetSaveSnippets,
} from "./snippetCrud";
import {
  searchTranscripts,
  filterHistory,
  type SearchResult,
  type HistoryFilter,
} from "./searchAndFilter";
import {
  loadRetentionPolicy,
  saveRetentionPolicy,
  applyRetentionPolicy,
  type RetentionPolicy,
  DEFAULT_RETENTION_POLICY,
} from "./retentionControls";
import { FloatingRecorderOverlay } from "./FloatingRecorder";
import { DictionaryView } from "./DictionaryView";
import { SnippetView } from "./SnippetView";
import { OnboardingView } from "./OnboardingView";
import { SearchPanel } from "./SearchPanel";
import { StylePresetSelector } from "./StylePresetSelector";
import { RetentionSettings } from "./RetentionSettings";
import "./styles.css";

type PrivacyLevel = "local" | "cloud";
type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "completed"
  | "error";
type ViewId =
  | "home"
  | "settings"
  | "dictionary"
  | "snippets"
  | "onboarding"
  | "search";

type VoiceCaptureResult = VoiceCaptureMetadata & {
  objectUrl: string;
  completedAt: string;
  api: TranscriptJobResult;
};

type TranscriptSession = TranscriptHistoryRow;

type Toast = { id: string; message: string };

type DesktopState = {
  commandOpen: boolean;
  recordingState: RecordingState;
  activeView: ViewId;
  privacyLevel: PrivacyLevel;
  activeSessionId: string | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  selectedSegmentIds: string[];
  canUndoTranscript: boolean;
  canRedoTranscript: boolean;
  draftRestored: boolean;
  transforming: boolean;
  toasts: Toast[];
  transcriptHistory: TranscriptSession[];
  transcriptHistorySource: "api" | "offline";
  transcriptHistoryLoading: boolean;
  transcriptHistoryError: string | undefined;
  voiceCapture: VoiceCaptureResult | undefined;
  voiceError: string | undefined;
  polishedPreview: string;
  insertionStatus: string | undefined;
  dictionaryEntries: DictionaryEntry[];
  snippets: Snippet[];
  onboardingChecklist: OnboardingChecklist;
  activeStylePreset: string;
  searchQuery: string;
  searchResults: SearchResult[];
  historyFilter: HistoryFilter;
  retentionPolicy: RetentionPolicy;
  showFloatingRecorder: boolean;
  dictionarySearch: string;
  snippetSearch: string;
  setActiveStylePreset: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setHistoryFilter: (filter: HistoryFilter) => void;
  setRetentionPolicy: (policy: RetentionPolicy) => void;
  purgeExpiredTranscripts: () => void;
  setDictionarySearch: (q: string) => void;
  setSnippetSearch: (q: string) => void;
  updateDictionaryEntry: (
    id: string,
    updates: Partial<Omit<DictionaryEntry, "id">>,
  ) => void;
  updateSnippetEntry: (
    id: string,
    updates: Partial<Omit<Snippet, "id">>,
  ) => void;
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  sttLanguage: string;
  setSttLanguage: (lang: string) => void;
  whisperConfig: WhisperConfig;
  setWhisperConfig: (config: WhisperConfig) => void;
  setCommandOpen: (open: boolean) => void;
  toggleRecording: () => void;
  startVoiceCapture: () => Promise<void>;
  stopVoiceCapture: () => void;
  resetVoiceCapture: () => void;
  setActiveView: (view: ViewId) => void;
  setPrivacyLevel: (level: PrivacyLevel) => void;
  loadTranscriptHistory: () => Promise<void>;
  selectTranscriptSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string, transcript: string) => void;
  clearActiveSession: () => void;
  setTranscript: (value: string) => void;
  applyPolishedPreview: () => void;
  insertPolishedDictation: () => Promise<void>;
  addDictionaryEntry: (spoken: string, replacement: string) => void;
  removeDictionaryEntry: (id: string) => void;
  addSnippet: (trigger: string, body: string) => void;
  removeSnippet: (id: string) => void;
  setOnboardingStep: (
    step: keyof OnboardingChecklist,
    complete: boolean,
  ) => void;
  undoTranscriptEdit: () => void;
  redoTranscriptEdit: () => void;
  toggleSegmentSelection: (segmentId: string) => void;
  updateSegmentText: (segmentId: string, text: string) => void;
  updateSegmentSpeaker: (segmentId: string, speaker: string) => void;
  mergeSelectedSegments: () => void;
  splitSelectedSegment: () => void;
  addToast: (message: string) => void;
  transformTranscript: () => void;
};

const API_URL = import.meta.env.VITE_SONOLECT_API_URL?.trim();
const AUTH_CONFIG = resolveDesktopAuthConfig();
const API_TOKEN = AUTH_CONFIG.token;
const sessions: TranscriptSession[] = offlineTranscriptHistory;

let activeRecorder: MediaRecorder | undefined;
let activeStream: MediaStream | undefined;
let activeChunks: BlobPart[] = [];
let activeStartedAt = 0;

const preferredAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function supportedAudioMimeType() {
  return preferredAudioMimeTypes.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function splitAtReadableMidpoint(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 2) return 0;
  const midpoint = Math.floor(trimmed.length / 2);
  const after = trimmed.indexOf(" ", midpoint);
  const before = trimmed.lastIndexOf(" ", midpoint);
  if (after > 0 && after < trimmed.length - 1) return after;
  if (before > 0 && before < trimmed.length - 1) return before;
  return midpoint;
}

function syncTranscriptText(transcript: string) {
  return {
    transcript,
    transcriptSegments: textToSegments(transcript),
    selectedSegmentIds: [],
  };
}

function syncSegments(
  transcriptSegments: TranscriptSegment[],
  selectedSegmentIds: string[],
) {
  return {
    transcriptSegments,
    transcript: segmentsToText(transcriptSegments),
    selectedSegmentIds: selectedSegmentIds.filter((id) =>
      transcriptSegments.some((segment) => segment.id === id),
    ),
  };
}

function polishedForState(
  state: Pick<DesktopState, "transcript" | "dictionaryEntries" | "snippets">,
) {
  return polishDictation(state.transcript, {
    dictionary: state.dictionaryEntries,
    snippets: state.snippets,
  });
}

const restoredDraft = loadTranscriptDraft();
const initialTranscriptSnapshot: TranscriptUndoSnapshot = restoredDraft
  ? {
      transcript: restoredDraft.transcript,
      transcriptSegments: restoredDraft.transcriptSegments,
      selectedSegmentIds: restoredDraft.selectedSegmentIds,
    }
  : { transcript: "", transcriptSegments: [], selectedSegmentIds: [] };
const transcriptUndoStack = createTranscriptUndoStack(
  initialTranscriptSnapshot,
);

const defaultOnboardingChecklist: OnboardingChecklist = {
  micPermission: false,
  shortcutPrimer: false,
  whisperSetup: false,
  privacyChoice: false,
};

function loadJsonArray<T>(
  key: string,
  normalize: (value: Partial<T>) => T | null,
  maxItems = 100,
): T[] {
  const raw = loadSettings(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, maxItems).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      try {
        const normalized = normalize(item as Partial<T>);
        return normalized ? [normalized] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function loadOnboardingChecklist(): OnboardingChecklist {
  const raw = loadSettings(SETTINGS_KEYS.onboardingChecklist);
  if (!raw) return defaultOnboardingChecklist;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingChecklist>;
    return {
      micPermission: Boolean(parsed.micPermission),
      shortcutPrimer: Boolean(parsed.shortcutPrimer),
      whisperSetup: Boolean(parsed.whisperSetup),
      privacyChoice: Boolean(parsed.privacyChoice),
    };
  } catch {
    return defaultOnboardingChecklist;
  }
}

function saveJsonSetting(key: string, value: unknown) {
  saveSettings(key, JSON.stringify(value));
}

function undoFlags() {
  return {
    canUndoTranscript: transcriptUndoStack.canUndo(),
    canRedoTranscript: transcriptUndoStack.canRedo(),
  };
}

function snapshotFromState(
  state: Pick<
    DesktopState,
    "transcript" | "transcriptSegments" | "selectedSegmentIds"
  >,
): TranscriptUndoSnapshot {
  return {
    transcript: state.transcript,
    transcriptSegments: state.transcriptSegments,
    selectedSegmentIds: state.selectedSegmentIds,
  };
}

function withUndoSnapshot(
  previous: Pick<
    DesktopState,
    "transcript" | "transcriptSegments" | "selectedSegmentIds"
  >,
  next: TranscriptUndoSnapshot,
) {
  transcriptUndoStack.push(snapshotFromState(previous));
  transcriptUndoStack.push(next);
  return { ...next, ...undoFlags() };
}

function stopActiveStream() {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
}

const useDesktopStore = create<DesktopState>((set, get) => ({
  commandOpen: false,
  recordingState: "idle",
  activeView: "home",
  privacyLevel:
    (loadSettings(SETTINGS_KEYS.privacyLevel) as PrivacyLevel) || "local",
  activeSessionId: restoredDraft?.activeSessionId ?? null,
  transcript: initialTranscriptSnapshot.transcript,
  transcriptSegments: initialTranscriptSnapshot.transcriptSegments,
  selectedSegmentIds: initialTranscriptSnapshot.selectedSegmentIds,
  canUndoTranscript: false,
  canRedoTranscript: false,
  draftRestored: Boolean(restoredDraft),
  transcriptHistory: sessions,
  transcriptHistorySource: "offline",
  transcriptHistoryLoading: false,
  transcriptHistoryError: undefined,
  voiceCapture: undefined,
  voiceError: undefined,
  polishedPreview: polishDictation(initialTranscriptSnapshot.transcript, {
    dictionary: loadJsonArray<DictionaryEntry>(
      SETTINGS_KEYS.dictionaryEntries,
      normalizeDictionaryEntry,
    ),
    snippets: loadJsonArray<Snippet>(SETTINGS_KEYS.snippets, normalizeSnippet),
  }),
  insertionStatus: undefined,
  dictionaryEntries: loadJsonArray<DictionaryEntry>(
    SETTINGS_KEYS.dictionaryEntries,
    normalizeDictionaryEntry,
  ),
  snippets: loadJsonArray<Snippet>(SETTINGS_KEYS.snippets, normalizeSnippet),
  onboardingChecklist: loadOnboardingChecklist(),
  transforming: false,
  toasts: [],
  activeStylePreset: "custom",
  searchQuery: "",
  searchResults: [],
  historyFilter: {},
  retentionPolicy: loadRetentionPolicy(),
  showFloatingRecorder: false,
  dictionarySearch: "",
  snippetSearch: "",
  locale:
    (loadSettings(SETTINGS_KEYS.locale) as SupportedLocale) ||
    useI18nStore.getState().locale,
  setLocale: (locale) => {
    useI18nStore.getState().setLocale(locale);
    saveSettings(SETTINGS_KEYS.locale, locale);
    set({ locale });
  },
  sttLanguage: loadSettings(SETTINGS_KEYS.sttLanguage) || "auto",
  setSttLanguage: (lang) => {
    saveSettings(SETTINGS_KEYS.sttLanguage, lang);
    set({ sttLanguage: lang });
  },
  whisperConfig: parseWhisperConfig(loadSettings(SETTINGS_KEYS.whisperConfig)),
  setWhisperConfig: (config) => {
    saveSettings(SETTINGS_KEYS.whisperConfig, serializeWhisperConfig(config));
    set({ whisperConfig: config });
  },
  setActiveStylePreset: (id) =>
    set((state) => {
      const styled = applyStylePreset(state.transcript, id);
      return {
        activeStylePreset: id,
        polishedPreview: styled,
      };
    }),
  setSearchQuery: (query) =>
    set((state) => ({
      searchQuery: query,
      searchResults: searchTranscripts(state.transcriptHistory, query),
    })),
  setHistoryFilter: (filter) => set({ historyFilter: filter }),
  setRetentionPolicy: (policy) => {
    saveRetentionPolicy(policy);
    set({ retentionPolicy: policy });
  },
  purgeExpiredTranscripts: () =>
    set((state) => {
      const result = applyRetentionPolicy(
        state.transcriptHistory,
        state.retentionPolicy,
      );
      const remaining = state.transcriptHistory.filter(
        (row) => !result.freedItems.includes(row.id),
      );
      return { transcriptHistory: remaining };
    }),
  setDictionarySearch: (q) => set({ dictionarySearch: q }),
  setSnippetSearch: (q) => set({ snippetSearch: q }),
  updateDictionaryEntry: (id, updates) =>
    set((state) => {
      const dictionaryEntries = dictUpdateEntry(
        state.dictionaryEntries,
        id,
        updates,
      );
      saveDictionary(dictionaryEntries);
      return {
        dictionaryEntries,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: dictionaryEntries,
          snippets: state.snippets,
        }),
      };
    }),
  updateSnippetEntry: (id, updates) =>
    set((state) => {
      const snippets = snippetUpdateSnippet(state.snippets, id, updates);
      snippetSaveSnippets(snippets);
      return {
        snippets,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: state.dictionaryEntries,
          snippets,
        }),
      };
    }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleRecording: () => {
    const {
      recordingState,
      startVoiceCapture,
      stopVoiceCapture,
      resetVoiceCapture,
    } = get();
    if (recordingState === "recording") {
      stopVoiceCapture();
      return;
    }
    if (
      recordingState === "requesting-permission" ||
      recordingState === "uploading"
    ) {
      return;
    }
    if (recordingState === "completed" || recordingState === "error") {
      resetVoiceCapture();
    }
    void startVoiceCapture();
  },
  startVoiceCapture: async () => {
    if (!["idle", "completed", "error"].includes(get().recordingState)) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      set({
        recordingState: "error",
        voiceError: "error.micUnavailable",
      });
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      set({
        recordingState: "error",
        voiceError: "error.mediaRecorderUnsupported",
      });
      return;
    }

    set({
      recordingState: "requesting-permission",
      voiceError: undefined,
      voiceCapture: undefined,
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = supportedAudioMimeType();
      activeStream = stream;
      activeChunks = [];
      activeStartedAt = Date.now();
      activeRecorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      activeRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) activeChunks.push(event.data);
      };

      activeRecorder.onerror = () => {
        stopActiveStream();
        set({
          recordingState: "error",
          voiceError: "error.recordingError",
        });
      };

      activeRecorder.onstop = () => {
        const recorderMimeType =
          activeRecorder?.mimeType || mimeType || "audio/webm";
        const durationMs = Date.now() - activeStartedAt;
        const blob = new Blob(activeChunks, { type: recorderMimeType });
        const metadata: VoiceCaptureMetadata = {
          durationMs,
          mimeType: blob.type || recorderMimeType,
          sizeBytes: blob.size,
        };

        stopActiveStream();
        activeRecorder = undefined;
        activeChunks = [];
        set({ recordingState: "uploading" });

        void submitCapturedAudio(blob, metadata)
          .then((api) => {
            const objectUrl = URL.createObjectURL(blob);
            const completedAt = new Date().toISOString();
            const capture: VoiceCaptureResult = {
              ...metadata,
              objectUrl,
              completedAt,
              api,
            };
            const fallbackTranscript =
              api.status === "offline"
                ? `\n\n[${formatDuration(metadata.durationMs)} · ${metadata.mimeType} · ${Math.round(metadata.sizeBytes / 1024)} KB]`
                : `\n\n[Job ${api.jobId ?? "pending"} · ${formatDuration(metadata.durationMs)}]`;
            set((state) => {
              const nextBaseState = {
                recordingState: "completed" as const,
                voiceCapture: capture,
                voiceError: undefined,
              };
              if (api.segments?.length) {
                const captureSegments = api.segments.map((segment, index) => ({
                  ...segment,
                  id: `capture-${completedAt}-${index + 1}-${segment.id}`,
                }));
                const next = syncSegments(
                  [...state.transcriptSegments, ...captureSegments],
                  [],
                );
                return {
                  ...nextBaseState,
                  ...withUndoSnapshot(state, next),
                  polishedPreview: polishDictation(next.transcript, {
                    dictionary: state.dictionaryEntries,
                    snippets: state.snippets,
                  }),
                };
              }
              const next = syncTranscriptText(
                `${state.transcript}${api.transcript ? `\n\n${api.transcript}` : fallbackTranscript}`,
              );
              return {
                ...nextBaseState,
                ...withUndoSnapshot(state, next),
                polishedPreview: polishDictation(next.transcript, {
                  dictionary: state.dictionaryEntries,
                  snippets: state.snippets,
                }),
              };
            });
          })
          .catch((error: unknown) => {
            set({
              recordingState: "error",
              voiceError:
                error instanceof Error ? error.message : "error.sendFailed",
            });
          });
      };

      activeRecorder.start();
      set({ recordingState: "recording" });
    } catch (error) {
      stopActiveStream();
      activeRecorder = undefined;
      set({
        recordingState: "error",
        voiceError:
          error instanceof Error ? error.message : "error.micPermissionDenied",
      });
    }
  },
  stopVoiceCapture: () => {
    if (activeRecorder?.state === "recording") {
      activeRecorder.stop();
      return;
    }
    stopActiveStream();
    activeRecorder = undefined;
    set({ recordingState: "idle" });
  },
  resetVoiceCapture: () =>
    set((state) => {
      if (state.voiceCapture?.objectUrl)
        URL.revokeObjectURL(state.voiceCapture.objectUrl);
      return {
        recordingState: "idle",
        voiceError: undefined,
        voiceCapture: undefined,
      };
    }),
  setActiveView: (view) => set({ activeView: view }),
  setPrivacyLevel: (level) => {
    saveSettings(SETTINGS_KEYS.privacyLevel, level);
    set({ privacyLevel: level });
  },
  loadTranscriptHistory: async () => {
    set({ transcriptHistoryLoading: true, transcriptHistoryError: undefined });
    try {
      const history = await fetchTranscriptHistory({
        apiUrl: API_URL,
        token: API_TOKEN,
      });
      set(() => ({
        transcriptHistory: history.items,
        transcriptHistorySource: history.source,
        transcriptHistoryLoading: false,
        transcriptHistoryError: undefined,
      }));
    } catch (error) {
      set({
        transcriptHistory: sessions,
        transcriptHistorySource: "offline",
        transcriptHistoryLoading: false,
        transcriptHistoryError:
          error instanceof Error ? error.message : "error.historyLoadFailed",
      });
    }
  },
  selectTranscriptSession: async (sessionId) => {
    const fallback = get().transcriptHistory.find(
      (item) => item.id === sessionId,
    );
    if (fallback) {
      const next = {
        ...syncTranscriptText(fallback.transcript),
        selectedSegmentIds: [],
      };
      transcriptUndoStack.reset(next);
      set({
        activeSessionId: fallback.id,
        ...next,
        ...undoFlags(),
        polishedPreview: polishDictation(next.transcript, {
          dictionary: get().dictionaryEntries,
          snippets: get().snippets,
        }),
        draftRestored: false,
      });
    }
    try {
      const detail = await fetchTranscriptDetail(sessionId, {
        apiUrl: API_URL,
        token: API_TOKEN,
      });
      if (detail) {
        const next = {
          ...syncTranscriptText(detail.transcript),
          selectedSegmentIds: [],
        };
        transcriptUndoStack.reset(next);
        set((state) => ({
          activeSessionId: detail.id,
          ...next,
          ...undoFlags(),
          polishedPreview: polishDictation(next.transcript, {
            dictionary: state.dictionaryEntries,
            snippets: state.snippets,
          }),
          draftRestored: false,
          transcriptHistory: state.transcriptHistory.map((item) =>
            item.id === detail.id ? detail : item,
          ),
          transcriptHistoryError: undefined,
        }));
      }
    } catch (error) {
      set({
        transcriptHistoryError:
          error instanceof Error ? error.message : "error.detailLoadFailed",
      });
    }
  },
  setActiveSession: (sessionId, transcript) => {
    const next = { ...syncTranscriptText(transcript), selectedSegmentIds: [] };
    transcriptUndoStack.reset(next);
    set({
      activeSessionId: sessionId,
      ...next,
      ...undoFlags(),
      polishedPreview: polishDictation(next.transcript, {
        dictionary: get().dictionaryEntries,
        snippets: get().snippets,
      }),
      draftRestored: false,
    });
  },
  clearActiveSession: () => {
    const next = {
      transcript: "",
      transcriptSegments: [],
      selectedSegmentIds: [],
    };
    transcriptUndoStack.reset(next);
    clearTranscriptDraft();
    set({
      activeSessionId: null,
      ...next,
      ...undoFlags(),
      polishedPreview: "",
      insertionStatus: undefined,
      draftRestored: false,
    });
  },
  setTranscript: (value) =>
    set((state) => ({
      ...withUndoSnapshot(state, syncTranscriptText(value)),
      polishedPreview: polishDictation(value, {
        dictionary: state.dictionaryEntries,
        snippets: state.snippets,
      }),
    })),
  applyPolishedPreview: () => {
    const { polishedPreview } = get();
    if (!polishedPreview.trim()) return;
    set((state) => {
      const next = syncTranscriptText(polishedPreview);
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    });
  },
  insertPolishedDictation: async () => {
    const { polishedPreview, transcript, addToast } = get();
    const clipboardAvailable = Boolean(navigator.clipboard?.writeText);
    const plan = buildInsertionPlan(
      polishedPreview || transcript,
      clipboardAvailable,
      isTauriRuntime(),
    );
    if (plan.method === "native-insert") {
      const result = await insertTextIntoActiveApp(plan.text);
      if (result.ok) {
        set({ insertionStatus: result.status });
        addToast("toast.insertionReady");
        return;
      }
      set({ insertionStatus: result.status });
      if (!clipboardAvailable) return;
    }
    if (
      clipboardAvailable &&
      (plan.method === "clipboard-fallback" || isTauriRuntime())
    ) {
      try {
        await navigator.clipboard.writeText(plan.text);
        set({
          insertionStatus:
            plan.method === "native-insert"
              ? "Direct insertion failed; copied polished dictation to clipboard instead."
              : plan.status,
        });
        addToast("toast.insertionReady");
      } catch {
        set({
          insertionStatus:
            "Clipboard copy was blocked. Select the polished text and copy it manually.",
        });
      }
      return;
    }
    set({ insertionStatus: plan.status });
  },
  addDictionaryEntry: (spoken, replacement) => {
    const entry = normalizeDictionaryEntry({ spoken, replacement });
    if (!entry) return;
    set((state) => {
      const dictionaryEntries = [...state.dictionaryEntries, entry];
      saveJsonSetting(SETTINGS_KEYS.dictionaryEntries, dictionaryEntries);
      return {
        dictionaryEntries,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: dictionaryEntries,
          snippets: state.snippets,
        }),
      };
    });
  },
  removeDictionaryEntry: (id) =>
    set((state) => {
      const dictionaryEntries = state.dictionaryEntries.filter(
        (entry) => entry.id !== id,
      );
      saveJsonSetting(SETTINGS_KEYS.dictionaryEntries, dictionaryEntries);
      return {
        dictionaryEntries,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: dictionaryEntries,
          snippets: state.snippets,
        }),
      };
    }),
  addSnippet: (trigger, body) => {
    const snippet = normalizeSnippet({ trigger, body });
    if (!snippet) return;
    set((state) => {
      const snippets = [...state.snippets, snippet];
      saveJsonSetting(SETTINGS_KEYS.snippets, snippets);
      return {
        snippets,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: state.dictionaryEntries,
          snippets,
        }),
      };
    });
  },
  removeSnippet: (id) =>
    set((state) => {
      const snippets = state.snippets.filter((snippet) => snippet.id !== id);
      saveJsonSetting(SETTINGS_KEYS.snippets, snippets);
      return {
        snippets,
        polishedPreview: polishDictation(state.transcript, {
          dictionary: state.dictionaryEntries,
          snippets,
        }),
      };
    }),
  setOnboardingStep: (step, complete) =>
    set((state) => {
      const onboardingChecklist = {
        ...state.onboardingChecklist,
        [step]: complete,
      };
      saveJsonSetting(SETTINGS_KEYS.onboardingChecklist, onboardingChecklist);
      return { onboardingChecklist };
    }),
  undoTranscriptEdit: () => {
    const snapshot = transcriptUndoStack.undo();
    if (!snapshot) return;
    set((state) => ({
      ...snapshot,
      ...undoFlags(),
      polishedPreview: polishedForState({
        ...state,
        transcript: snapshot.transcript,
      }),
    }));
  },
  redoTranscriptEdit: () => {
    const snapshot = transcriptUndoStack.redo();
    if (!snapshot) return;
    set((state) => ({
      ...snapshot,
      ...undoFlags(),
      polishedPreview: polishedForState({
        ...state,
        transcript: snapshot.transcript,
      }),
    }));
  },
  toggleSegmentSelection: (segmentId) =>
    set((state) => ({
      selectedSegmentIds: state.selectedSegmentIds.includes(segmentId)
        ? state.selectedSegmentIds.filter((id) => id !== segmentId)
        : [...state.selectedSegmentIds, segmentId],
    })),
  updateSegmentText: (segmentId, text) =>
    set((state) => {
      const next = syncSegments(
        state.transcriptSegments.map((segment) =>
          segment.id === segmentId ? { ...segment, text } : segment,
        ),
        state.selectedSegmentIds,
      );
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    }),
  updateSegmentSpeaker: (segmentId, speaker) =>
    set((state) => {
      const next = syncSegments(
        state.transcriptSegments.map((segment) =>
          segment.id === segmentId
            ? assignSpeakerLabel(segment, speaker)
            : segment,
        ),
        state.selectedSegmentIds,
      );
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    }),
  mergeSelectedSegments: () => {
    const { transcriptSegments, selectedSegmentIds } = get();
    if (selectedSegmentIds.length !== 2) return;
    const merged = mergeTranscriptSegments(
      transcriptSegments,
      selectedSegmentIds[0]!,
      selectedSegmentIds[1]!,
    );
    set((state) => {
      const next = syncSegments(merged, []);
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    });
  },
  splitSelectedSegment: () => {
    const { transcriptSegments, selectedSegmentIds } = get();
    if (selectedSegmentIds.length !== 1) return;
    const segment = transcriptSegments.find(
      (item) => item.id === selectedSegmentIds[0],
    );
    if (!segment) return;
    const split = splitTranscriptSegment(
      transcriptSegments,
      segment.id,
      splitAtReadableMidpoint(segment.text),
    );
    set((state) => {
      const next = syncSegments(split, []);
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    });
  },
  addToast: (message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  transformTranscript: () => {
    const { transforming, transcript, addToast } = get();
    if (transforming || !transcript.trim()) return;
    set({ transforming: true });
    const cleaned = transcript
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    const paragraphs: string[] = [];
    for (let i = 0; i < sentences.length; i += 3) {
      paragraphs.push(sentences.slice(i, i + 3).join(" "));
    }
    const firstWords = cleaned.split(/\s+/).slice(0, 6).join(" ");
    const title = `# ${firstWords}${firstWords.length < cleaned.length ? "…" : ""}`;
    const transformed = `${title}\n\n${paragraphs.join("\n\n")}`;
    set((state) => {
      const next = syncTranscriptText(transformed);
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
        transforming: false,
      };
    });
    addToast("toast.transformComplete");
  },
}));

/* ── App Shell ───────────────────────────────────────────────── */

function App() {
  const commandOpen = useDesktopStore((state) => state.commandOpen);
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const loadTranscriptHistory = useDesktopStore(
    (state) => state.loadTranscriptHistory,
  );
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const transcript = useDesktopStore((state) => state.transcript);
  const transcriptSegments = useDesktopStore(
    (state) => state.transcriptSegments,
  );
  const selectedSegmentIds = useDesktopStore(
    (state) => state.selectedSegmentIds,
  );
  const undoTranscriptEdit = useDesktopStore(
    (state) => state.undoTranscriptEdit,
  );
  const redoTranscriptEdit = useDesktopStore(
    (state) => state.redoTranscriptEdit,
  );

  useEffect(() => {
    void loadTranscriptHistory();
  }, [loadTranscriptHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTranscriptEdit();
        else undoTranscriptEdit();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoTranscriptEdit();
      }
      // Hands-free toggle: ⌘⇧M — press to start, press to stop
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        toggleRecording();
      }
      // Push-to-talk: ⌘⇧V — hold to record
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "v" &&
        !event.repeat
      ) {
        event.preventDefault();
        const { recordingState: rs } = useDesktopStore.getState();
        if (rs === "idle" || rs === "completed" || rs === "error") {
          if (rs === "completed" || rs === "error") {
            useDesktopStore.getState().resetVoiceCapture();
          }
          void useDesktopStore.getState().startVoiceCapture();
        }
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };

    // Push-to-talk release: stop recording when ⌘⇧V is released
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "v") {
        const { recordingState: rs } = useDesktopStore.getState();
        if (rs === "recording") {
          useDesktopStore.getState().stopVoiceCapture();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [setCommandOpen, toggleRecording, undoTranscriptEdit, redoTranscriptEdit]);

  useEffect(() => {
    let unregister: (() => Promise<void>) | undefined;
    const startPushToTalk = () => {
      const { recordingState: rs } = useDesktopStore.getState();
      if (rs === "idle" || rs === "completed" || rs === "error") {
        if (rs === "completed" || rs === "error") {
          useDesktopStore.getState().resetVoiceCapture();
        }
        void useDesktopStore.getState().startVoiceCapture();
      }
    };
    const stopPushToTalk = () => {
      const { recordingState: rs } = useDesktopStore.getState();
      if (rs === "recording") {
        useDesktopStore.getState().stopVoiceCapture();
      }
    };

    void registerNativeDictationShortcuts({
      onToggle: () => useDesktopStore.getState().toggleRecording(),
      onPushToTalkStart: startPushToTalk,
      onPushToTalkStop: stopPushToTalk,
    }).then((registration) => {
      unregister = registration.unregister;
      if (!registration.enabled && isTauriRuntime()) {
        useDesktopStore.getState().addToast("toast.error");
      }
    });

    return () => {
      if (unregister) void unregister();
    };
  }, []);

  useEffect(() => {
    if (!transcript.trim() && transcriptSegments.length === 0) {
      clearTranscriptDraft();
      return;
    }
    saveTranscriptDraft({
      activeSessionId,
      transcript,
      transcriptSegments,
      selectedSegmentIds,
      savedAt: new Date().toISOString(),
    });
  }, [activeSessionId, transcript, transcriptSegments, selectedSegmentIds]);

  const recordingState = useDesktopStore((state) => state.recordingState);
  const polishedPreview = useDesktopStore((state) => state.polishedPreview);
  const showFloatingRecorder = recordingState === "recording";

  return (
    <main className="desktop-shell" id="main-content">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="signal-rings" aria-hidden="true" />
      <Sidebar />
      <WorkspaceRouter />
      <VoiceRecorderPill />
      {showFloatingRecorder ? (
        <FloatingRecorderOverlay
          recordingState="recording"
          durationMs={0}
          waveformPeaks={Array.from({ length: 24 }, () => 0.4)}
          polishedPreview={polishedPreview || null}
          minimized={false}
          onCancel={() => useDesktopStore.getState().stopVoiceCapture()}
          onFinish={() => useDesktopStore.getState().stopVoiceCapture()}
          onInsert={() =>
            void useDesktopStore.getState().insertPolishedDictation()
          }
          onMinimize={() => {}}
        />
      ) : null}
      {commandOpen ? <CommandPalette /> : null}
      <ToastContainer />
    </main>
  );
}

/* ── Workspace Router ────────────────────────────────────────── */

function WorkspaceRouter() {
  const activeView = useDesktopStore((state) => state.activeView);
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const t = useT();

  const dictionaryEntries = useDesktopStore((state) => state.dictionaryEntries);
  const snippets = useDesktopStore((state) => state.snippets);
  const checklist = useDesktopStore((state) => state.onboardingChecklist);
  const transcriptHistory = useDesktopStore((state) => state.transcriptHistory);
  const dictionarySearch = useDesktopStore((state) => state.dictionarySearch);
  const snippetSearch = useDesktopStore((state) => state.snippetSearch);

  return (
    <section className="workspace" aria-label={t("workspace.ariaLabel")}>
      <TopBar />
      {activeView === "settings" ? (
        <div className="workspace-grid">
          <SettingsPrivacy />
        </div>
      ) : activeView === "dictionary" ? (
        <div className="workspace-grid">
          <DictionaryView
            entries={dictionaryEntries}
            onAdd={(spoken, replacement) =>
              useDesktopStore.getState().addDictionaryEntry(spoken, replacement)
            }
            onRemove={(id) =>
              useDesktopStore.getState().removeDictionaryEntry(id)
            }
            onUpdate={(id, updates) =>
              useDesktopStore.getState().updateDictionaryEntry(id, updates)
            }
            searchQuery={dictionarySearch}
            onSearchChange={(q) =>
              useDesktopStore.getState().setDictionarySearch(q)
            }
          />
        </div>
      ) : activeView === "snippets" ? (
        <div className="workspace-grid">
          <SnippetView
            snippets={snippets}
            onAdd={(trigger, body) =>
              useDesktopStore.getState().addSnippet(trigger, body)
            }
            onRemove={(id) => useDesktopStore.getState().removeSnippet(id)}
            onUpdate={(id, updates) =>
              useDesktopStore.getState().updateSnippetEntry(id, updates)
            }
            searchQuery={snippetSearch}
            onSearchChange={(q) =>
              useDesktopStore.getState().setSnippetSearch(q)
            }
          />
        </div>
      ) : activeView === "onboarding" ? (
        <div className="workspace-grid">
          <OnboardingView
            checklist={checklist}
            onComplete={(step) =>
              useDesktopStore.getState().setOnboardingStep(step, true)
            }
            onSkip={(step) =>
              useDesktopStore.getState().setOnboardingStep(step, true)
            }
          />
        </div>
      ) : activeView === "search" ? (
        <div className="workspace-grid">
          <SearchPanel
            history={transcriptHistory}
            onSelectResult={(id) => {
              useDesktopStore.getState().setActiveView("home");
              void useDesktopStore.getState().selectTranscriptSession(id);
            }}
          />
        </div>
      ) : activeSessionId ? (
        <div className="workspace-grid">
          <TranscriptDetail />
        </div>
      ) : (
        <HomeDashboard />
      )}
    </section>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────── */

function Sidebar() {
  const activeView = useDesktopStore((state) => state.activeView);
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const clearActiveSession = useDesktopStore(
    (state) => state.clearActiveSession,
  );
  const t = useT();

  const navItems: Array<{ id: ViewId; labelKey: LocaleKeys }> = [
    { id: "home", labelKey: "nav.home" },
    { id: "search", labelKey: "nav.history" },
    { id: "onboarding", labelKey: "nav.onboarding" },
    { id: "dictionary", labelKey: "nav.dictionary" },
    { id: "snippets", labelKey: "nav.snippets" },
    { id: "settings", labelKey: "nav.settings" },
  ];

  return (
    <aside className="sidebar" aria-label="Sidebar navigation">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <div>
          <p className="eyebrow">Sonolect</p>
          <h1>Voice OS</h1>
        </div>
      </div>

      <button
        className="record-cta"
        onClick={() => useDesktopStore.getState().toggleRecording()}
        type="button"
        aria-label={t("sidebar.recordNow")}
      >
        <span className="record-dot" aria-hidden="true" />{" "}
        {t("sidebar.recordNow")}
        <span className="shortcut-group">
          <kbd title="Hands-free toggle">⌘⇧M</kbd>
          <kbd title="Push to talk (hold)">⌘⇧V</kbd>
        </span>
      </button>

      <nav className="nav-list" aria-label="Main navigation">
        {navItems.map((item) => (
          <button
            className={activeView === item.id ? "nav-item active" : "nav-item"}
            key={item.id}
            onClick={() => {
              setActiveView(item.id);
              if (item.id === "home") clearActiveSession();
            }}
            type="button"
            aria-current={activeView === item.id ? "page" : undefined}
          >
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <SidebarHistoryList />
    </aside>
  );
}

function SidebarHistoryList() {
  const transcriptHistory = useDesktopStore((state) => state.transcriptHistory);
  const transcriptHistorySource = useDesktopStore(
    (state) => state.transcriptHistorySource,
  );
  const transcriptHistoryLoading = useDesktopStore(
    (state) => state.transcriptHistoryLoading,
  );
  const transcriptHistoryError = useDesktopStore(
    (state) => state.transcriptHistoryError,
  );
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const selectTranscriptSession = useDesktopStore(
    (state) => state.selectTranscriptSession,
  );
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const t = useT();

  return (
    <div className="history-block">
      <div className="section-title">
        {t("sidebar.lastDictations")} ·{" "}
        {transcriptHistorySource === "api" ? "API" : "offline"}
      </div>
      {transcriptHistoryLoading ? (
        <p className="history-helper">{t("sidebar.loadingHistory")}</p>
      ) : null}
      {transcriptHistoryError ? (
        <p className="history-helper error">{transcriptHistoryError}</p>
      ) : null}
      {transcriptHistory.map((session) => (
        <button
          className={
            activeSessionId === session.id
              ? "history-card selected"
              : "history-card"
          }
          key={session.id}
          onClick={() => {
            setActiveView("home");
            void selectTranscriptSession(session.id);
          }}
          type="button"
          aria-current={activeSessionId === session.id ? true : undefined}
          aria-label={`${session.title} — ${session.timestamp} — ${session.duration}`}
        >
          <span className="history-title">{session.title}</span>
          <span className="history-meta">
            {session.timestamp} · {session.duration}
          </span>
          <span className="history-status">{session.metadata}</span>
        </button>
      ))}
    </div>
  );
}

/* ── TopBar ──────────────────────────────────────────────────── */

function TopBar() {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const t = useT();

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{t("topbar.eyebrow")}</p>
        <h2>{t("topbar.headline")}</h2>
      </div>
      <div className="topbar-actions">
        <span className="status-chip" role="status" aria-live="polite">
          {privacyLevel === "local"
            ? t("topbar.localFirst")
            : t("topbar.cloudAssisted")}{" "}
          ·{" "}
          {isVoiceApiConfigured() ? t("topbar.apiReady") : t("topbar.offline")}
        </span>
        <button
          className="ghost-button"
          onClick={() => setCommandOpen(true)}
          type="button"
          aria-label={t("topbar.searchCommand")}
        >
          {t("topbar.searchCommand")} <kbd aria-hidden="true">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}

/* ── Home Dashboard (Whispr Flow inspired) ───────────────────── */

function HomeDashboard() {
  const transcriptHistory = useDesktopStore((state) => state.transcriptHistory);
  const voiceCapture = useDesktopStore((state) => state.voiceCapture);
  const t = useT();

  return (
    <div className="home-dashboard">
      <div className="home-main">
        <div className="home-header">
          <div>
            <h2>{t("home.welcome")}</h2>
            <p className="home-banner">{t("home.banner")}</p>
          </div>
        </div>
        {voiceCapture?.objectUrl ? (
          <AudioPlaybackCard
            audioUrl={voiceCapture.objectUrl}
            className="recent-capture-player"
            durationLabel={formatDuration(voiceCapture.durationMs)}
            title={t("audio.recentCapture")}
          />
        ) : null}
        <TimelineFeed entries={transcriptHistory} />
      </div>
      <div className="stats-rail">
        <StatsCard entries={transcriptHistory} />
      </div>
    </div>
  );
}

/* ── Timeline Feed ───────────────────────────────────────────── */

function groupByDate(entries: TranscriptSession[]) {
  const groups: Map<string, TranscriptSession[]> = new Map();
  for (const entry of entries) {
    // Use updatedAt for real grouping, fall back to timestamp label
    const dateObj = new Date(entry.updatedAt);
    const dateKey = Number.isNaN(dateObj.getTime())
      ? entry.timestamp
      : dateObj.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
    const group = groups.get(dateKey);
    if (group) {
      group.push(entry);
    } else {
      groups.set(dateKey, [entry]);
    }
  }
  return groups;
}

function extractTime(entry: TranscriptSession) {
  const dateObj = new Date(entry.updatedAt);
  if (Number.isNaN(dateObj.getTime())) return entry.timestamp;
  return dateObj.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function TimelineFeed({ entries }: { entries: TranscriptSession[] }) {
  const selectTranscriptSession = useDesktopStore(
    (state) => state.selectTranscriptSession,
  );
  const t = useT();

  if (entries.length === 0) {
    return <p className="home-banner">{t("home.noTranscripts")}</p>;
  }

  const groups = groupByDate(entries);

  return (
    <div className="timeline-feed">
      {Array.from(groups.entries()).map(([dateLabel, items]) => (
        <div className="timeline-group" key={dateLabel}>
          <div className="timeline-date-header">{dateLabel}</div>
          {items.map((entry) => (
            <article
              className="timeline-entry"
              key={entry.id}
              onClick={() => void selectTranscriptSession(entry.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void selectTranscriptSession(entry.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="timeline-time">{extractTime(entry)}</span>
              <div className="timeline-content">
                <span className="timeline-title">{entry.title}</span>
                <span className="timeline-preview">{entry.preview}</span>
                {entry.audioUrl ? (
                  <AudioPlaybackCard
                    audioUrl={entry.audioUrl}
                    compact
                    durationLabel={entry.duration}
                    onClick={(event) => event.stopPropagation()}
                    title={entry.title}
                  />
                ) : null}
              </div>
              <span className="timeline-duration">{entry.duration}</span>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Audio Playback ───────────────────────────────────────────── */

function AudioPlaybackCard({
  audioUrl,
  className,
  compact = false,
  durationLabel,
  onClick,
  title,
}: {
  audioUrl: string;
  className?: string;
  compact?: boolean;
  durationLabel?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  title: string;
}) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const handleToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  return (
    <section
      className={[
        "audio-playback-card",
        compact ? "compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      aria-label={title}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        src={audioUrl}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <button
        aria-label={t("audio.playPause")}
        className="audio-play-button"
        onClick={handleToggle}
        type="button"
      >
        {playing ? "Ⅱ" : "▶"}
      </button>
      <div className="audio-playback-body">
        <div className="audio-playback-header">
          <span>{title}</span>
          {durationLabel ? <small>{durationLabel}</small> : null}
        </div>
        <Waveform audioUrl={audioUrl} active={playing} />
      </div>
    </section>
  );
}

/* ── Stats Card ──────────────────────────────────────────────── */

function StatsCard({ entries }: { entries: TranscriptSession[] }) {
  const t = useT();

  const stats = useMemo(() => {
    let totalWords = 0;
    let totalDurationMs = 0;
    const datesSet = new Set<string>();

    for (const entry of entries) {
      const words = entry.transcript.trim().split(/\s+/).filter(Boolean).length;
      totalWords += words;

      // Parse duration string like "2m 18s" or "48s"
      const mMatch = entry.duration.match(/(\d+)m/);
      const sMatch = entry.duration.match(/(\d+)s/);
      const ms =
        (mMatch?.[1] ? parseInt(mMatch[1], 10) * 60000 : 0) +
        (sMatch?.[1] ? parseInt(sMatch[1], 10) * 1000 : 0);
      totalDurationMs += ms;

      const dateObj = new Date(entry.updatedAt);
      if (!Number.isNaN(dateObj.getTime())) {
        datesSet.add(dateObj.toISOString().slice(0, 10));
      }
    }

    const wpm =
      totalDurationMs > 0
        ? Math.round(totalWords / (totalDurationMs / 60000))
        : 0;

    // Calculate streak (consecutive days ending today or most recent)
    const sortedDates = Array.from(datesSet).sort().reverse();
    let streak = 0;
    if (sortedDates.length > 0) {
      const first = sortedDates[0] as string;
      let cursor = new Date(first);
      for (const d of sortedDates) {
        const diff = Math.round(
          (cursor.getTime() - new Date(d).getTime()) / 86400000,
        );
        if (diff <= 1) {
          streak++;
          cursor = new Date(d);
        } else {
          break;
        }
      }
    }

    return { totalWords, wpm, streak };
  }, [entries]);

  return (
    <div className="stats-card glass-card">
      <div className="section-title">{t("stats.title")}</div>
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-value">
            {stats.totalWords >= 1000
              ? `${(stats.totalWords / 1000).toFixed(1)}K`
              : stats.totalWords}
          </span>
          <span className="stat-label">{t("stats.totalWords")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.wpm}</span>
          <span className="stat-label">{t("stats.wpm")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.streak}</span>
          <span className="stat-label">{t("stats.dayStreak")}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Transcript Detail (replaces editor panel) ───────────────── */

function TranscriptDetail() {
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const transcript = useDesktopStore((state) => state.transcript);
  const transcriptSegments = useDesktopStore(
    (state) => state.transcriptSegments,
  );
  const selectedSegmentIds = useDesktopStore(
    (state) => state.selectedSegmentIds,
  );
  const transcriptHistory = useDesktopStore((state) => state.transcriptHistory);
  const setTranscript = useDesktopStore((state) => state.setTranscript);
  const undoTranscriptEdit = useDesktopStore(
    (state) => state.undoTranscriptEdit,
  );
  const redoTranscriptEdit = useDesktopStore(
    (state) => state.redoTranscriptEdit,
  );
  const canUndoTranscript = useDesktopStore((state) => state.canUndoTranscript);
  const canRedoTranscript = useDesktopStore((state) => state.canRedoTranscript);
  const draftRestored = useDesktopStore((state) => state.draftRestored);
  const toggleSegmentSelection = useDesktopStore(
    (state) => state.toggleSegmentSelection,
  );
  const updateSegmentText = useDesktopStore((state) => state.updateSegmentText);
  const updateSegmentSpeaker = useDesktopStore(
    (state) => state.updateSegmentSpeaker,
  );
  const mergeSelectedSegments = useDesktopStore(
    (state) => state.mergeSelectedSegments,
  );
  const splitSelectedSegment = useDesktopStore(
    (state) => state.splitSelectedSegment,
  );
  const transforming = useDesktopStore((state) => state.transforming);
  const polishedPreview = useDesktopStore((state) => state.polishedPreview);
  const insertionStatus = useDesktopStore((state) => state.insertionStatus);
  const applyPolishedPreview = useDesktopStore(
    (state) => state.applyPolishedPreview,
  );
  const insertPolishedDictation = useDesktopStore(
    (state) => state.insertPolishedDictation,
  );
  const transformTranscript = useDesktopStore(
    (state) => state.transformTranscript,
  );
  const clearActiveSession = useDesktopStore(
    (state) => state.clearActiveSession,
  );
  const addToast = useDesktopStore((state) => state.addToast);
  const t = useT();

  const activeSession = transcriptHistory.find(
    (session) => session.id === activeSessionId,
  );
  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript],
  );
  const selectedSegmentIndexes = selectedSegmentIds
    .map((id) => transcriptSegments.findIndex((segment) => segment.id === id))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const canMergeSegments =
    selectedSegmentIndexes.length === 2 &&
    selectedSegmentIndexes[1] === selectedSegmentIndexes[0]! + 1;
  const canSplitSegment = selectedSegmentIds.length === 1;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(transcript).then(() => {
      addToast("toast.copySuccess");
    });
  }, [transcript, addToast]);

  const handleDownload = useCallback(
    (format: TranscriptExportFormat = "txt") => {
      const exported = exportTranscript({
        format,
        transcript,
        segments: transcriptSegments,
        sessionId: activeSessionId,
        title: activeSession?.title ?? t("editor.fallbackTitle"),
      });
      const blob = new Blob([exported.content], { type: exported.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exported.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [activeSession?.title, activeSessionId, transcript, transcriptSegments, t],
  );

  return (
    <section className="editor-panel">
      <button
        className="ghost-button back-button"
        onClick={clearActiveSession}
        type="button"
      >
        {t("home.backToTimeline")}
      </button>
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("editor.eyebrow")}</p>
          <h3>{activeSession?.title ?? t("editor.fallbackTitle")}</h3>
          {activeSession ? (
            <p className="editor-meta">
              {activeSession.status} · {activeSession.duration} ·{" "}
              {activeSession.metadata}
            </p>
          ) : null}
        </div>
      </div>

      <div className="hologram-frame">
        {draftRestored ? (
          <p className="draft-recovery-banner">{t("editor.draftRestored")}</p>
        ) : null}
        <div
          className="editor-history-actions"
          aria-label={t("editor.historyControls")}
        >
          <button
            className="ghost-button"
            disabled={!canUndoTranscript}
            onClick={undoTranscriptEdit}
            type="button"
          >
            {t("editor.undo")}
          </button>
          <button
            className="ghost-button"
            disabled={!canRedoTranscript}
            onClick={redoTranscriptEdit}
            type="button"
          >
            {t("editor.redo")}
          </button>
        </div>
        <textarea
          aria-label={t("editor.textareaLabel")}
          className="transcript-input"
          onChange={(event) => setTranscript(event.target.value)}
          spellCheck="true"
          value={transcript}
        />
      </div>

      <section className="segment-editor" aria-label={t("segments.ariaLabel")}>
        <div className="segment-toolbar">
          <div>
            <p className="section-title">{t("segments.title")}</p>
            <p className="editor-meta">
              {transcriptSegments.length} {t("segments.count")}
            </p>
          </div>
          <div className="segment-actions">
            <button
              className="ghost-button"
              disabled={!canMergeSegments}
              onClick={mergeSelectedSegments}
              type="button"
            >
              {t("segments.merge")}
            </button>
            <button
              className="ghost-button"
              disabled={!canSplitSegment}
              onClick={splitSelectedSegment}
              type="button"
            >
              {t("segments.split")}
            </button>
          </div>
        </div>

        <div className="segment-list">
          {transcriptSegments.length === 0 ? (
            <p className="editor-meta">{t("segments.empty")}</p>
          ) : (
            transcriptSegments.map((segment, index) => {
              const selected = selectedSegmentIds.includes(segment.id);
              return (
                <article
                  className={
                    selected ? "segment-card selected" : "segment-card"
                  }
                  key={segment.id}
                >
                  <label className="segment-select">
                    <input
                      checked={selected}
                      onChange={() => toggleSegmentSelection(segment.id)}
                      type="checkbox"
                    />
                    <span>
                      {t("segments.segment")} {index + 1} ·{" "}
                      {formatTimestamp(segment.startMs)}–
                      {formatTimestamp(segment.endMs)}
                    </span>
                  </label>
                  <label className="segment-speaker">
                    <span>{t("segments.speaker")}</span>
                    <input
                      aria-label={`${t("segments.speaker")} ${index + 1}`}
                      onChange={(event) =>
                        updateSegmentSpeaker(segment.id, event.target.value)
                      }
                      placeholder={t("segments.speakerPlaceholder")}
                      type="text"
                      value={segment.speaker ?? ""}
                    />
                  </label>
                  <textarea
                    aria-label={`${t("segments.textLabel")} ${index + 1}`}
                    className="segment-textarea"
                    onChange={(event) =>
                      updateSegmentText(segment.id, event.target.value)
                    }
                    spellCheck="true"
                    value={segment.text}
                  />
                </article>
              );
            })
          )}
        </div>
      </section>

      <StylePresetSelector
        currentPresetId={useDesktopStore.getState().activeStylePreset}
        onSelect={(id) => useDesktopStore.getState().setActiveStylePreset(id)}
      />

      <section
        className="polish-preview-card"
        aria-label="Wispr-style polished preview"
      >
        <div>
          <p className="section-title">Wispr-style auto-edit</p>
          <h4>Raw speech → polished text</h4>
        </div>
        <p className="preview-text">
          {polishedPreview ||
            "Record or type a dictation to see the cleaned preview."}
        </p>
        {insertionStatus ? (
          <p className="editor-meta">{insertionStatus}</p>
        ) : null}
        <div className="inline-actions">
          <button
            className="ghost-button"
            disabled={!polishedPreview.trim()}
            onClick={applyPolishedPreview}
            type="button"
          >
            Replace editor with preview
          </button>
          <button
            className="primary-button compact"
            disabled={!polishedPreview.trim() && !transcript.trim()}
            onClick={() => void insertPolishedDictation()}
            type="button"
          >
            Copy for active app
          </button>
        </div>
      </section>

      <footer className="editor-footer">
        <span>
          {wordCount} {t("editor.wordCount")}
        </span>
        <span>{t("editor.language")}</span>
        <button className="ghost-button" onClick={handleCopy} type="button">
          {t("editor.copy")}
        </button>
        {(["txt", "md", "srt", "vtt", "json"] as TranscriptExportFormat[]).map(
          (format) => (
            <button
              className="ghost-button"
              key={format}
              onClick={() => handleDownload(format)}
              type="button"
            >
              {format === "txt" ? t("editor.download") : format.toUpperCase()}
            </button>
          ),
        )}
        <button
          className="primary-button"
          disabled={transforming}
          onClick={transformTranscript}
          type="button"
        >
          {transforming ? t("editor.transforming") : t("editor.transformCta")}
        </button>
      </footer>
    </section>
  );
}

/* ── Product Setup Panels ────────────────────────────────────── */

function DictionaryPanel() {
  const entries = useDesktopStore((state) => state.dictionaryEntries);
  const addDictionaryEntry = useDesktopStore(
    (state) => state.addDictionaryEntry,
  );
  const removeDictionaryEntry = useDesktopStore(
    (state) => state.removeDictionaryEntry,
  );
  const [spoken, setSpoken] = useState("");
  const [replacement, setReplacement] = useState("");

  return (
    <section className="glass-card management-panel">
      <p className="section-title">Personal dictionary</p>
      <h3>Teach Sonolect names, products, and spellings</h3>
      <p>
        These replacements are applied during the Wispr-style polished preview
        before you copy text into another app.
      </p>
      <div className="form-grid two">
        <label>
          <span>When I say</span>
          <input
            value={spoken}
            onChange={(event) => setSpoken(event.target.value)}
            placeholder="open claw"
          />
        </label>
        <label>
          <span>Write</span>
          <input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="OpenClaw"
          />
        </label>
      </div>
      <button
        className="primary-button compact"
        onClick={() => {
          addDictionaryEntry(spoken, replacement);
          setSpoken("");
          setReplacement("");
        }}
        type="button"
      >
        Add dictionary entry
      </button>
      <div className="preference-list">
        {entries.length === 0 ? (
          <p className="editor-meta">No dictionary entries yet.</p>
        ) : null}
        {entries.map((entry) => (
          <article className="preference-row" key={entry.id}>
            <div>
              <strong>{entry.spoken}</strong>
              <p>{entry.replacement}</p>
            </div>
            <button
              aria-label={`Remove dictionary entry ${entry.spoken}`}
              className="ghost-button"
              onClick={() => removeDictionaryEntry(entry.id)}
              type="button"
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function SnippetsPanel() {
  const snippets = useDesktopStore((state) => state.snippets);
  const addSnippet = useDesktopStore((state) => state.addSnippet);
  const removeSnippet = useDesktopStore((state) => state.removeSnippet);
  const [trigger, setTrigger] = useState("");
  const [body, setBody] = useState("");

  return (
    <section className="glass-card management-panel">
      <p className="section-title">Snippet library</p>
      <h3>Expand voice shortcuts while dictating</h3>
      <p>
        Say or type a trigger like /sig and Sonolect expands it in the polished
        preview.
      </p>
      <div className="form-grid two">
        <label>
          <span>Trigger</span>
          <input
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            placeholder="/sig"
          />
        </label>
        <label>
          <span>Expansion</span>
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Best, Ismail"
          />
        </label>
      </div>
      <button
        className="primary-button compact"
        onClick={() => {
          addSnippet(trigger, body);
          setTrigger("");
          setBody("");
        }}
        type="button"
      >
        Add snippet
      </button>
      <div className="preference-list">
        {snippets.length === 0 ? (
          <p className="editor-meta">No snippets yet.</p>
        ) : null}
        {snippets.map((snippet) => (
          <article className="preference-row" key={snippet.id}>
            <div>
              <strong>{snippet.trigger}</strong>
              <p>{snippet.body}</p>
            </div>
            <button
              aria-label={`Remove snippet ${snippet.trigger}`}
              className="ghost-button"
              onClick={() => removeSnippet(snippet.id)}
              type="button"
            >
              Remove
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function OnboardingPanel() {
  const checklist = useDesktopStore((state) => state.onboardingChecklist);
  const setOnboardingStep = useDesktopStore((state) => state.setOnboardingStep);
  const percent = onboardingProgress(checklist);
  const done = isOnboardingComplete(checklist);
  const items: Array<{
    key: keyof OnboardingChecklist;
    title: string;
    detail: string;
  }> = [
    {
      key: "micPermission",
      title: "Microphone permission",
      detail: "Verify the app can request and receive audio input.",
    },
    {
      key: "shortcutPrimer",
      title: "Global shortcut primer",
      detail: "Learn hands-free toggle ⌘⇧M and push-to-talk ⌘⇧V.",
    },
    {
      key: "whisperSetup",
      title: "Whisper setup",
      detail:
        "Configure local Whisper command/model or confirm offline demo mode.",
    },
    {
      key: "privacyChoice",
      title: "Privacy choice",
      detail:
        "Choose local-first or cloud-assisted processing and retention behavior.",
    },
  ];

  return (
    <section className="glass-card management-panel">
      <p className="section-title">First-run setup</p>
      <h3>
        {done
          ? "Sonolect is ready for dictation"
          : "Complete setup before relying on dictation"}
      </h3>
      <p>
        {percent}% complete · Wispr-style loop requires mic, shortcut,
        transcription, and privacy confidence.
      </p>
      <div className="setup-progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="preference-list">
        {items.map((item) => (
          <label className="preference-row check-row" key={item.key}>
            <input
              type="checkbox"
              checked={checklist[item.key]}
              onChange={(event) =>
                setOnboardingStep(item.key, event.target.checked)
              }
            />
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

/* ── Settings ────────────────────────────────────────────────── */

function SettingsPrivacy() {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  const setPrivacyLevel = useDesktopStore((state) => state.setPrivacyLevel);
  const locale = useDesktopStore((state) => state.locale);
  const setLocale = useDesktopStore((state) => state.setLocale);
  const sttLanguage = useDesktopStore((state) => state.sttLanguage);
  const setSttLanguage = useDesktopStore((state) => state.setSttLanguage);
  const whisperConfig = useDesktopStore((state) => state.whisperConfig);
  const setWhisperConfig = useDesktopStore((state) => state.setWhisperConfig);
  const t = useT();
  const [commandJson, setCommandJson] = React.useState(() =>
    JSON.stringify(whisperConfig.command, null, 2),
  );
  const [diagnostic, setDiagnostic] = React.useState<string | undefined>();
  const whisperStatus = getWhisperSetupStatus(whisperConfig);
  const whisperErrors = validateWhisperConfig(whisperConfig);
  const detectedWhisperPlatform: WhisperInstallPlatform = /Win/i.test(
    navigator.platform,
  )
    ? "win32"
    : /Mac/i.test(navigator.platform)
      ? "darwin"
      : "linux";
  const defaultWhisperHome =
    detectedWhisperPlatform === "darwin"
      ? "/Users/you"
      : detectedWhisperPlatform === "win32"
        ? "C:/Users/you"
        : "/home/you";
  const selectedModelId = WHISPER_MODEL_CATALOG.some(
    (model) => model.id === whisperConfig.modelName,
  )
    ? (whisperConfig.modelName as (typeof WHISPER_MODEL_CATALOG)[number]["id"])
    : "base.en";
  const whisperInstallPlan = getDefaultWhisperInstallPlan({
    platform: detectedWhisperPlatform,
    homeDir: defaultWhisperHome,
    modelId: selectedModelId,
  });
  const whisperGuidance = buildWhisperInstallerGuidance(whisperInstallPlan);

  useEffect(() => {
    setCommandJson(JSON.stringify(whisperConfig.command, null, 2));
  }, [whisperConfig.command]);

  function updateWhisperConfig(next: Partial<WhisperConfig>) {
    setWhisperConfig({ ...whisperConfig, ...next });
    setDiagnostic(undefined);
  }

  function saveCommandJson() {
    try {
      const parsed = JSON.parse(commandJson) as unknown;
      if (
        !Array.isArray(parsed) ||
        !parsed.every((arg) => typeof arg === "string")
      ) {
        setDiagnostic(t("settings.whisper.commandJsonInvalid"));
        return;
      }
      updateWhisperConfig({ command: parsed });
      setDiagnostic(t("settings.whisper.commandSaved"));
    } catch {
      setDiagnostic(t("settings.whisper.commandJsonInvalid"));
    }
  }

  return (
    <section className="glass-card">
      <div className="section-title">{t("privacy.title")}</div>
      <h3>{t("privacy.heading")}</h3>
      <p>{t("privacy.description")}</p>
      <div
        className="privacy-toggle"
        role="group"
        aria-label={t("privacy.ariaLabel")}
      >
        <button
          className={privacyLevel === "local" ? "active" : ""}
          onClick={() => setPrivacyLevel("local")}
          type="button"
          aria-current={privacyLevel === "local" ? true : undefined}
        >
          {t("privacy.local")}
        </button>
        <button
          className={privacyLevel === "cloud" ? "active" : ""}
          onClick={() => setPrivacyLevel("cloud")}
          type="button"
          aria-current={privacyLevel === "cloud" ? true : undefined}
        >
          {t("privacy.cloud")}
        </button>
      </div>
      <ul className="check-list">
        <li>{t("privacy.autoDelete")}</li>
        <li>{t("privacy.maskNames")}</li>
        <li>{t("privacy.exportTextOnly")}</li>
      </ul>

      <div className="section-title" style={{ marginTop: "1.5rem" }}>
        Locale
      </div>
      <div className="privacy-toggle" role="group" aria-label="Locale toggle">
        <button
          className={locale === "en" ? "active" : ""}
          onClick={() => setLocale("en")}
          type="button"
          aria-current={locale === "en" ? true : undefined}
        >
          EN
        </button>
        <button
          className={locale === "fr" ? "active" : ""}
          onClick={() => setLocale("fr")}
          type="button"
          aria-current={locale === "fr" ? true : undefined}
        >
          FR
        </button>
      </div>

      <div className="section-title" style={{ marginTop: "1.5rem" }}>
        STT Language
      </div>
      <select
        className="ghost-button"
        value={sttLanguage}
        onChange={(e) => setSttLanguage(e.target.value)}
        aria-label="STT Language"
      >
        {STT_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeName} ({lang.name})
          </option>
        ))}
      </select>

      <div className="section-title" style={{ marginTop: "1.5rem" }}>
        {t("settings.localApi.title")}
      </div>
      <p>{t("settings.localApi.description")}</p>
      <ul className="check-list">
        <li>
          {t("settings.localApi.url")}:{" "}
          <code>{API_URL || "VITE_SONOLECT_API_URL not set"}</code>
        </li>
        <li>
          {t(
            isVoiceApiConfigured()
              ? "settings.localApi.configured"
              : "settings.localApi.offline",
          )}
        </li>
      </ul>

      <div className="section-title" style={{ marginTop: "1.5rem" }}>
        {t("settings.whisper.title")}
      </div>
      <p>{t("settings.whisper.description")}</p>
      <ul className="check-list">
        <li>{t("settings.whisper.install")}</li>
        <li>{t("settings.whisper.download")}</li>
        <li>
          {t("settings.whisper.env")}:{" "}
          <code>SONOLECT_DESKTOP_WHISPER_COMMAND_ARGS</code>
        </li>
      </ul>
      <div className="section-title" style={{ marginTop: "1rem" }}>
        {t("settings.whisper.catalog")}
      </div>
      <p>{whisperGuidance.summary}</p>
      <label className="field-label" htmlFor="whisper-model-catalog">
        {t("settings.whisper.recommendedModel")}
      </label>
      <select
        id="whisper-model-catalog"
        className="ghost-button"
        value={selectedModelId}
        onChange={(event) => {
          const nextPlan = getDefaultWhisperInstallPlan({
            platform: detectedWhisperPlatform,
            homeDir: defaultWhisperHome,
            modelId: event.target.value as typeof selectedModelId,
          });
          updateWhisperConfig({
            modelName: nextPlan.model.id,
          });
        }}
      >
        {WHISPER_MODEL_CATALOG.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label} · {Math.round(model.sizeBytes / 1024 / 1024)} MB
          </option>
        ))}
      </select>
      <ul className="check-list">
        <li>
          {t("settings.whisper.defaultBinary")}:{" "}
          <code>{whisperInstallPlan.binaryPath}</code>
        </li>
        <li>
          {t("settings.whisper.defaultModel")}:{" "}
          <code>{whisperInstallPlan.modelPath}</code>
        </li>
        <li>
          {t("settings.whisper.downloadUrl")}:{" "}
          <a
            href={whisperInstallPlan.model.downloadUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            {whisperInstallPlan.model.filename}
          </a>
        </li>
      </ul>
      <div className="editor-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={() => {
            const commandTemplate = {
              command: [
                "whisper-cli",
                "--model",
                "{model}",
                "--file",
                "{audioPath}",
                "--output-json",
              ],
              modelName: whisperInstallPlan.model.id,
            } satisfies Partial<WhisperConfig>;
            updateWhisperConfig(commandTemplate);
            setCommandJson(JSON.stringify(commandTemplate.command, null, 2));
            setDiagnostic(t("settings.whisper.planApplied"));
          }}
        >
          {t("settings.whisper.usePlan")}
        </button>
      </div>
      <ol className="check-list">
        {whisperGuidance.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <label className="field-label" htmlFor="whisper-model-path">
        {t("settings.whisper.modelPath")}
      </label>
      <input
        id="whisper-model-path"
        className="search-input"
        value={whisperConfig.modelPath}
        onChange={(event) =>
          updateWhisperConfig({ modelPath: event.target.value })
        }
        placeholder="/Users/me/Models/ggml-base.en.bin"
      />
      <label className="field-label" htmlFor="whisper-model-name">
        {t("settings.whisper.modelName")}
      </label>
      <input
        id="whisper-model-name"
        className="search-input"
        value={whisperConfig.modelName}
        onChange={(event) =>
          updateWhisperConfig({ modelName: event.target.value })
        }
        placeholder="base.en"
      />
      <label className="field-label" htmlFor="whisper-command-json">
        {t("settings.whisper.commandArgs")}
      </label>
      <textarea
        id="whisper-command-json"
        className="transcript-textarea"
        value={commandJson}
        onChange={(event) => setCommandJson(event.target.value)}
        rows={5}
        spellCheck={false}
      />
      <div className="editor-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={saveCommandJson}
        >
          {t("settings.whisper.saveCommand")}
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={() => setDiagnostic(whisperStatus.message)}
        >
          {t("settings.whisper.validate")}
        </button>
      </div>
      <p>
        <strong>{t("settings.whisper.status")}:</strong> {whisperStatus.message}
      </p>
      {whisperErrors.length > 0 ? (
        <ul className="check-list">
          {whisperErrors.map((error) => (
            <li key={error.code}>{error.message}</li>
          ))}
        </ul>
      ) : null}
      {whisperConfig.command.length > 0 ? (
        <>
          <p>
            <strong>{t("settings.whisper.preview")}:</strong>{" "}
            <code>{buildWhisperCommandPreview(whisperConfig)}</code>
          </p>
          <p>
            <strong>{t("settings.whisper.envValue")}:</strong>{" "}
            <code>{commandArgsJsonForEnv(whisperConfig)}</code>
          </p>
        </>
      ) : null}
      {diagnostic ? <p role="status">{diagnostic}</p> : null}
      <RetentionSettings
        history={useDesktopStore.getState().transcriptHistory}
        policy={useDesktopStore.getState().retentionPolicy}
        onPolicyChange={(policy) =>
          useDesktopStore.getState().setRetentionPolicy(policy)
        }
        onPurge={() => useDesktopStore.getState().purgeExpiredTranscripts()}
      />
    </section>
  );
}

/* ── VoiceRecorderPill ───────────────────────────────────────── */

function VoiceRecorderPill() {
  const recordingState = useDesktopStore((state) => state.recordingState);
  const voiceCapture = useDesktopStore((state) => state.voiceCapture);
  const voiceError = useDesktopStore((state) => state.voiceError);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const resetVoiceCapture = useDesktopStore((state) => state.resetVoiceCapture);
  const t = useT();
  const [elapsed, setElapsed] = React.useState(0);

  useEffect(() => {
    if (recordingState !== "recording") {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(id);
  }, [recordingState]);

  // Keep completed captures available so users can play back the recent audio.
  useEffect(() => {
    if (recordingState !== "error") return;
    const id = setTimeout(() => resetVoiceCapture(), 3000);
    return () => clearTimeout(id);
  }, [recordingState, resetVoiceCapture]);

  if (recordingState === "idle") return null;

  const isRecording = recordingState === "recording";
  const isProcessing =
    recordingState === "requesting-permission" ||
    recordingState === "uploading";
  const isDone = recordingState === "completed" || recordingState === "error";

  const statusLabel = (() => {
    switch (recordingState) {
      case "requesting-permission":
        return t("pill.permitting");
      case "recording":
        return formatDuration(elapsed);
      case "uploading":
        return t("pill.processing");
      case "completed":
        return t("pill.done");
      case "error":
        return t("pill.error");
      default:
        return "";
    }
  })();

  return (
    <div
      className="recorder-pill"
      role="status"
      aria-label={t("recorder.ariaLabel")}
    >
      <div
        className={isRecording ? "pill-orb active" : "pill-orb"}
        aria-hidden="true"
      />
      <Waveform active={isRecording} />
      <span className="pill-status" aria-live="polite">
        {statusLabel}
      </span>
      {voiceError && isDone ? (
        <span className="pill-error" role="alert">
          {voiceError}
        </span>
      ) : null}
      {voiceCapture && isDone ? (
        <a
          className="pill-link"
          href={voiceCapture.objectUrl}
          download="sonolect-capture.webm"
          title={t("recorder.listenDownload")}
          aria-label={t("recorder.listenDownload")}
        >
          <span aria-hidden="true">↓</span>
        </a>
      ) : null}
      {isDone ? (
        <button
          className="pill-btn pill-btn-ghost"
          onClick={resetVoiceCapture}
          type="button"
          title={t("recorder.close")}
          aria-label={t("recorder.close")}
        >
          <span aria-hidden="true">✕</span>
        </button>
      ) : null}
      <button
        className="pill-btn pill-btn-primary"
        disabled={isProcessing}
        onClick={toggleRecording}
        type="button"
        aria-label={
          isRecording
            ? t("pill.stop")
            : isDone
              ? t("pill.again")
              : t("pill.processing")
        }
      >
        {isRecording ? t("pill.stop") : isDone ? t("pill.again") : "…"}
      </button>
    </div>
  );
}

function Waveform({
  active,
  audioUrl,
}: {
  active: boolean;
  audioUrl?: string;
}) {
  const t = useT();
  const [peaks, setPeaks] = useState<number[]>(() =>
    Array.from({ length: 18 }, () => 0.18),
  );

  useEffect(() => {
    if (!audioUrl) {
      setPeaks(Array.from({ length: 18 }, () => (active ? 0.45 : 0.18)));
      return;
    }

    let cancelled = false;
    void decodeAudioWaveform(audioUrl, 32)
      .then((nextPeaks) => {
        if (!cancelled) setPeaks(nextPeaks);
      })
      .catch(() => {
        if (!cancelled) setPeaks(Array.from({ length: 32 }, () => 0.12));
      });

    return () => {
      cancelled = true;
    };
  }, [active, audioUrl]);

  return (
    <div
      className={active ? "waveform active" : "waveform"}
      aria-label={t("audio.waveform")}
      role="img"
    >
      {peaks.map((peak, index) => (
        <span
          className="waveform-bar"
          key={`${audioUrl ?? "live"}-${index}`}
          style={{ height: `${Math.max(8, Math.round(peak * 56))}px` }}
        />
      ))}
    </div>
  );
}

/* ── Command Palette ─────────────────────────────────────────── */

function CommandPalette() {
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const clearActiveSession = useDesktopStore(
    (state) => state.clearActiveSession,
  );
  const t = useT();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commandActionMap: Record<string, () => void> = {
    "recording:start": () => useDesktopStore.getState().toggleRecording(),
    "recording:stop": () => useDesktopStore.getState().stopVoiceCapture(),
    "recording:ptt": () => useDesktopStore.getState().toggleRecording(),
    "editing:undo": () => useDesktopStore.getState().undoTranscriptEdit(),
    "editing:redo": () => useDesktopStore.getState().redoTranscriptEdit(),
    "editing:transform": () => useDesktopStore.getState().transformTranscript(),
    "editing:style": () => setActiveView("settings"),
    "editing:copy": () =>
      void navigator.clipboard.writeText(useDesktopStore.getState().transcript),
    "editing:insert": () =>
      void useDesktopStore.getState().insertPolishedDictation(),
    "navigation:history": () => {
      setActiveView("home");
      clearActiveSession();
    },
    "navigation:dictionary": () => setActiveView("dictionary"),
    "navigation:snippets": () => setActiveView("snippets"),
    "navigation:settings": () => setActiveView("settings"),
    "navigation:onboarding": () => setActiveView("onboarding"),
    "export:markdown": () => {},
    "export:srt": () => {},
    "export:vtt": () => {},
    "export:json": () => {},
    "export:text": () => {},
    "data:clearHistory": () => {},
    "data:privacy": () => setActiveView("settings"),
    "data:importDictionary": () => setActiveView("dictionary"),
    "data:exportDictionary": () => setActiveView("dictionary"),
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(
    () => searchCommands(DEFAULT_COMMANDS, search),
    [search],
  );

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={() => setCommandOpen(false)}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-label={t("palette.ariaLabel")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="palette-input"
          role="search"
          aria-label={t("palette.ariaLabel")}
        >
          <span className="palette-prefix" aria-hidden="true">
            ⌘K
          </span>
          <input
            ref={inputRef}
            className="palette-search"
            type="text"
            placeholder={t("palette.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("palette.searchPlaceholder")}
          />
        </div>
        <div className="command-list" role="list" aria-label="Commands">
          {filtered.length === 0 ? (
            <p className="palette-no-results">{t("palette.noResults")}</p>
          ) : (
            filtered.map((command) => (
              <button
                key={command.id}
                onClick={() => {
                  const handler = commandActionMap[command.action];
                  if (handler) handler();
                  setCommandOpen(false);
                }}
                type="button"
              >
                <span>
                  {command.label}
                  {command.shortcut ? (
                    <kbd style={{ marginLeft: "0.5rem", opacity: 0.5 }}>
                      {command.shortcut}
                    </kbd>
                  ) : null}
                </span>
                <small>{command.hint}</small>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ── Toasts ──────────────────────────────────────────────────── */

function ToastContainer() {
  const toasts = useDesktopStore((state) => state.toasts);
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-container"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" role="alert">
          {t(toast.message as LocaleKeys)}
        </div>
      ))}
    </div>
  );
}

/* ── Mount ───────────────────────────────────────────────────── */

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
