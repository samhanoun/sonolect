import { create } from "zustand";
import {
  submitCapturedAudioCloud,
  type TranscriptJobResult,
  type VoiceCaptureMetadata,
} from "../voiceApi";
import {
  fetchTranscriptDetail,
  fetchTranscriptHistory,
  offlineTranscriptHistory,
  type TranscriptHistoryRow,
} from "../transcriptHistory";
import { resolveDesktopAuthConfig } from "../localDevAuth";
import { useI18nStore, type SupportedLocale } from "../i18n";
import {
  saveSettings,
  loadSettings,
  SETTINGS_KEYS,
  loadTranscriptDraft,
  clearTranscriptDraft,
} from "../persistence";
import {
  assignSpeakerLabel,
  mergeTranscriptSegments,
  segmentsToText,
  splitTranscriptSegment,
  textToSegments,
  type TranscriptSegment,
} from "../segmentEditor";
import {
  parseWhisperConfig,
  serializeWhisperConfig,
  type WhisperConfig,
} from "../whisperSetup";
import {
  createTranscriptUndoStack,
  type TranscriptUndoSnapshot,
} from "../transcriptUndo";
import {
  buildInsertionPlan,
  normalizeDictionaryEntry,
  normalizeSnippet,
  polishDictation,
  type DictionaryEntry,
  type OnboardingChecklist,
  type Snippet,
} from "../wisprWorkflow";
import { insertTextIntoActiveApp, isTauriRuntime } from "../desktopNative";
import { formatDuration } from "../lib/format";

export type PrivacyLevel = "local" | "cloud";
export type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "completed"
  | "error";
export type ViewId =
  | "home"
  | "settings"
  | "dictionary"
  | "snippets"
  | "onboarding"
  | "team"
  | "meeting"
  | "reader";

export type VoiceCaptureResult = VoiceCaptureMetadata & {
  objectUrl: string;
  completedAt: string;
  api: TranscriptJobResult;
};

export type TranscriptSession = TranscriptHistoryRow;

export type Toast = { id: string; message: string };

export type DesktopState = {
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

export const API_URL = import.meta.env.VITE_SONOLECT_API_URL?.trim();
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

export const useDesktopStore = create<DesktopState>((set, get) => ({
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

        void submitCapturedAudioCloud(blob, metadata)
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
