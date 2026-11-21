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
import {
  getT,
  isSupportedLocale,
  useI18nStore,
  type SupportedLocale,
} from "../i18n";
import {
  saveSettings,
  loadSettings,
  SETTINGS_KEYS,
  loadTranscriptDraft,
  clearTranscriptDraft,
} from "../persistence";
import {
  loadMicDeviceId,
  openMicrophone,
  saveMicDeviceId,
} from "../microphone";
import {
  assignSpeakerLabel,
  mergeSegmentRun,
  moveTranscriptSegment,
  resyncSegments,
  segmentsFromCapture,
  segmentsToText,
  splitTranscriptSegment,
  textToSegments,
  type SavedCaptureSegment,
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
import {
  insertTextIntoActiveApp,
  isTauriRuntime,
  restoreDictationTarget,
} from "../desktopNative";
import { formatDuration } from "../lib/format";
import {
  levelFromSamples,
  type DictationOutcome,
  type DictationSource,
} from "../dictationBubble";
import {
  useProviderStore,
  transcribeUsingProvider,
  setProviderMode,
} from "../providerSettings";
import {
  loadCaptureSource,
  recordLive,
  recordSystemAudio,
  saveCaptureSource,
  type CaptureSource,
  type LiveRecording,
} from "../liveCaptureNative";
import { localizeNativeMessage } from "../nativeMessages";

export type PrivacyLevel = "local" | "cloud";
export type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "completed"
  | "error";
export type ViewId =
  | "models"
  | "speech"
  | "transcribe"
  | "library"
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

/** A saved recording's version for sync (sync-core's `Hlc`). */
export type CaptureVersion = { t: number; c: number; d: string };
export type OpenedVersion = { id: string; hlc: CaptureVersion | null };

export type DesktopState = {
  commandOpen: boolean;
  recordingState: RecordingState;
  activeView: ViewId;
  privacyLevel: PrivacyLevel;
  activeSessionId: string | null;
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  /**
   * The version (sync HLC, or null for none) of the saved recording the
   * editor opened, when known: a save then keeps a version that sync wrote
   * meanwhile instead of overwriting it.
   */
  openedVersion: OpenedVersion | null;
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
  /**
   * What the recording in progress has understood so far. Only the desktop
   * app's recorder reports it; empty otherwise.
   */
  liveTranscript: string;
  /**
   * An audio file is going through the app's recorder. The recorder holds
   * one recording at a time, so a new one waits until the file is done.
   */
  importingAudio: boolean;
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
  /** The microphone that records; empty for the system default. */
  micDeviceId: string;
  /** What the Studio's record button records. Dictation uses the microphone. */
  captureSource: CaptureSource;
  setCaptureSource: (source: CaptureSource) => void;
  setMicDeviceId: (deviceId: string) => void;
  setCommandOpen: (open: boolean) => void;
  /** Where the current/last capture was started from. Bubble and hotkey
   * captures are pasted into the focused app when transcription finishes. */
  dictationSource: DictationSource;
  /** Result of the last bubble/hotkey dictation, shown on the bubble. */
  dictationOutcome: DictationOutcome | undefined;
  toggleRecording: (source?: DictationSource) => void;
  startVoiceCapture: (source?: DictationSource) => Promise<void>;
  stopVoiceCapture: () => void;
  /** Stop listening and throw the audio away (bubble ✕ / Esc). */
  cancelVoiceCapture: () => void;
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
  /** Splits a segment at `splitIndex`, or at a readable midpoint. */
  splitSegment: (segmentId: string, splitIndex?: number) => void;
  moveSegment: (segmentId: string, direction: "up" | "down") => void;
  /** Labels every selected segment with one speaker; empty clears the label. */
  setSpeakerForSelection: (speaker: string) => void;
  clearSegmentSelection: () => void;
  /**
   * Opens one saved recording in the editor, with its timings and audio.
   * `hlc`: its version, when the caller knows it (null: it has none).
   */
  openCapture: (capture: {
    id: string;
    durationMs: number;
    transcript: string | null;
    segments?: SavedCaptureSegment[] | null;
    hlc?: CaptureVersion | null;
  }) => void;
  /** The saved recording `id` now has this version (after a save, say). */
  setOpenedVersion: (id: string, hlc: CaptureVersion | null) => void;
  addToast: (message: string) => void;
  transformTranscript: () => void;
};

export const API_URL = import.meta.env?.VITE_SONOLECT_API_URL?.trim();
const AUTH_CONFIG = resolveDesktopAuthConfig();
const API_TOKEN = AUTH_CONFIG.token;
const sessions: TranscriptSession[] = [];

let activeRecorder: MediaRecorder | undefined;
/** The desktop app's recorder, when it is the one recording. */
let activeLive: LiveRecording | undefined;
/** Whether that recorder transcribes with an online model. */
let activeLiveOnline = false;
let activeStream: MediaStream | undefined;
let activeChunks: BlobPart[] = [];
let activeStartedAt = 0;
let captureTimer: ReturnType<typeof setTimeout> | undefined;
let cloudAbort: AbortController | undefined;
let permissionCancelled = false;
/** Why the recorder stopped by itself (the four-hour limit, say). */
let stallNotice: string | undefined;
let discardCapture = false;
/** Bumped when a capture is cancelled mid-transcription so its result is dropped. */
let captureGeneration = 0;
let meterContext: AudioContext | undefined;

type LevelListener = (level: number) => void;
const levelListeners = new Set<LevelListener>();

/** Live microphone level (0..1) while recording, for the dictation bubble. */
export function subscribeMicLevel(listener: LevelListener): () => void {
  levelListeners.add(listener);
  // A meter that appears mid-recording (a page opened while dictating)
  // still gets levels: the metering only runs while someone listens.
  if (!meterContext && activeStream) startLevelMeter(activeStream);
  return () => levelListeners.delete(listener);
}

/**
 * Meter the stream with a ScriptProcessor: unlike requestAnimationFrame or
 * timers, audio callbacks keep firing while the main window is minimised,
 * which is exactly when the floating bubble needs them.
 */
function startLevelMeter(stream: MediaStream) {
  stopLevelMeter();
  if (levelListeners.size === 0) return;
  const Ctx =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const level = levelFromSamples(event.inputBuffer.getChannelData(0));
      levelListeners.forEach((listener) => listener(level));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    // Created outside a user gesture (global hotkey) the context may start
    // suspended; the bubble falls back to an ambient wave if it stays so.
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    meterContext = ctx;
  } catch {
    meterContext = undefined;
  }
}

function stopLevelMeter() {
  const ctx = meterContext;
  meterContext = undefined;
  if (ctx) void ctx.close().catch(() => undefined);
  levelListeners.forEach((listener) => listener(0));
}

/** Paste one bubble/hotkey dictation into whatever app has focus. */
async function deliverDictation(text: string): Promise<DictationOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  await restoreDictationTarget();
  const result = await insertTextIntoActiveApp(trimmed);
  if (result.ok) return { kind: "inserted", text: trimmed };
  if (result.method === "clipboard-only") {
    // The native status already says the text is on the clipboard.
    return { kind: "copied", text: trimmed, reason: result.status };
  }
  try {
    // Only works while a Sonolect window has focus; otherwise Chromium refuses.
    await navigator.clipboard.writeText(trimmed);
    return {
      kind: "copied",
      text: trimmed,
      reason: getT()("bubble.status.copied", { status: result.status }),
    };
  } catch {
    return {
      kind: "error",
      message: getT()("bubble.pasteFailed"),
    };
  }
}

/**
 * Puts a finished capture into the transcript and, for a bubble or hotkey
 * dictation, pastes its polished text into the app in front.
 */
async function completeCapture(
  api: TranscriptJobResult,
  metadata: VoiceCaptureMetadata,
  objectUrl: string,
) {
  const completedAt = new Date().toISOString();
  const capture: VoiceCaptureResult = {
    ...metadata,
    objectUrl,
    completedAt,
    api,
  };
  useDesktopStore.setState((state) => {
    const nextBaseState = {
      recordingState:
        api.status === "offline" ? ("error" as const) : ("completed" as const),
      voiceCapture: capture,
      liveTranscript: "",
      // A recording that stopped by itself is kept: its note says why.
      voiceError: api.status === "offline" ? api.message : stallNotice,
    };
    const savedSegments = api.captureId
      ? segmentsFromCapture({
          id: api.captureId,
          durationMs: metadata.durationMs,
          transcript: api.transcript ?? "",
          segments: api.segments ?? [],
        })
      : [];
    if (savedSegments.length || api.segments?.length) {
      const captureSegments = savedSegments.length
        ? savedSegments
        : (api.segments ?? []).map((segment, index) => ({
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
      `${state.transcript}${api.transcript ? `\n\n${api.transcript}` : ""}`,
      state.transcriptSegments,
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
  const { dictationSource } = useDesktopStore.getState();
  if (dictationSource === "app" || api.status === "offline") return;
  const spoken =
    api.transcript?.trim() ||
    (api.segments ?? []).map((segment) => segment.text).join(" ");
  const polished = polishDictation(spoken, {
    dictionary: useDesktopStore.getState().dictionaryEntries,
    snippets: useDesktopStore.getState().snippets,
  });
  const outcome = await deliverDictation(polished);
  useDesktopStore.setState({
    dictationOutcome: outcome,
    insertionStatus:
      outcome.kind === "inserted"
        ? getT()("bubble.status.inserted")
        : outcome.kind === "copied"
          ? outcome.reason
          : undefined,
  });
}

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

/**
 * The segments for a transcript edited as text. With `previous`, timings,
 * speakers and audio links survive for every paragraph that did not change.
 */
function syncTranscriptText(
  transcript: string,
  previous?: TranscriptSegment[],
) {
  return {
    transcript,
    transcriptSegments: previous
      ? resyncSegments(previous, transcript)
      : textToSegments(transcript),
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
  clearTimeout(captureTimer);
  stopLevelMeter();
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
}

/**
 * The saved interface language wins over the detected one, and the i18n store
 * has to learn it before the first render.
 */
function initialLocale(): SupportedLocale {
  const saved = loadSettings(SETTINGS_KEYS.locale);
  if (isSupportedLocale(saved)) {
    useI18nStore.getState().setLocale(saved);
    return saved;
  }
  return useI18nStore.getState().locale;
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  commandOpen: false,
  recordingState: "idle",
  dictationSource: "app",
  dictationOutcome: undefined,
  activeView: "home",
  privacyLevel:
    (loadSettings(SETTINGS_KEYS.privacyLevel) as PrivacyLevel) || "local",
  activeSessionId: restoredDraft?.activeSessionId ?? null,
  transcript: initialTranscriptSnapshot.transcript,
  transcriptSegments: initialTranscriptSnapshot.transcriptSegments,
  openedVersion: null,
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
  liveTranscript: "",
  importingAudio: false,
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
  locale: initialLocale(),
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
  micDeviceId: loadMicDeviceId(),
  captureSource: loadCaptureSource(),
  setCaptureSource: (source) => {
    saveCaptureSource(source);
    set({ captureSource: source });
  },
  setMicDeviceId: (deviceId) => {
    saveMicDeviceId(deviceId);
    set({ micDeviceId: deviceId });
  },
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleRecording: (source = "app") => {
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
    void startVoiceCapture(source);
  },
  startVoiceCapture: async (source = "app") => {
    if (!["idle", "completed", "error"].includes(get().recordingState)) return;
    set({ dictationSource: source, dictationOutcome: undefined });

    // Starting now would take the recorder away from the file being
    // transcribed and lose it.
    if (get().importingAudio) {
      set({
        recordingState: "error",
        voiceError: "error.importInProgress",
        voiceCapture: undefined,
        liveTranscript: "",
      });
      return;
    }

    // A recording started in the Studio can take what is playing on this
    // computer instead of the microphone. A dictation is always spoken.
    if (
      source === "app" &&
      get().captureSource === "system" &&
      isTauriRuntime()
    ) {
      permissionCancelled = false;
      stallNotice = undefined;
      discardCapture = false;
      cloudAbort = new AbortController();
      set({
        recordingState: "requesting-permission",
        voiceError: undefined,
        voiceCapture: undefined,
        liveTranscript: "",
      });
      try {
        const stt = { ...useProviderStore.getState().preferences.stt };
        const online =
          stt.provider !== "local" && get().privacyLevel === "cloud";
        if (online) await setProviderMode(true);
        const live = await recordSystemAudio(
          {
            language: get().sttLanguage,
            modelPath: get().whisperConfig.modelPath,
            ...(online ? { provider: stt.provider, model: stt.model } : {}),
          },
          {
            onPartial: (segments) =>
              set({
                liveTranscript: segments
                  .map((segment) => segment.text)
                  .join(" "),
              }),
            onLevel: (level) =>
              levelListeners.forEach((listener) => listener(level)),
            // The feed ended by itself or the recorder is full: keep what
            // was recorded and say why it stopped.
            onStalled: (message) => {
              stallNotice = message;
              get().stopVoiceCapture();
            },
          },
        );
        if (permissionCancelled) {
          await live.cancel().catch(() => undefined);
          set({ recordingState: "idle" });
          return;
        }
        activeLive = live;
        activeLiveOnline = online;
        activeStartedAt = Date.now();
        set({ recordingState: "recording" });
      } catch (error) {
        set({
          recordingState: "error",
          voiceError: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

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

    const captureSettings = {
      processingMode: get().privacyLevel,
      language: get().sttLanguage,
      modelPath: get().whisperConfig.modelPath,
    };
    const onlineChoice = { ...useProviderStore.getState().preferences.stt };
    permissionCancelled = false;
    stallNotice = undefined;
    discardCapture = false;
    cloudAbort = new AbortController();
    set({
      recordingState: "requesting-permission",
      voiceError: undefined,
      voiceCapture: undefined,
      liveTranscript: "",
    });

    try {
      const { stream, fellBack } = await openMicrophone(get().micDeviceId);
      if (fellBack) get().addToast("toast.micFellBack");
      if (permissionCancelled) {
        stream.getTracks().forEach((track) => track.stop());
        set({ recordingState: "idle" });
        return;
      }
      if (isTauriRuntime()) {
        // The app's own recorder: no length limit short of four hours, the
        // audio goes to disk as it is spoken, and text arrives at each pause.
        const online =
          onlineChoice.provider !== "local" &&
          captureSettings.processingMode === "cloud";
        if (online) await setProviderMode(true);
        const live = await recordLive(
          stream,
          {
            language: captureSettings.language,
            modelPath: captureSettings.modelPath,
            ...(online
              ? { provider: onlineChoice.provider, model: onlineChoice.model }
              : {}),
          },
          {
            onPartial: (segments) =>
              set({
                liveTranscript: segments
                  .map((segment) => segment.text)
                  .join(" "),
              }),
            // The recorder takes no more audio (four hours, say): keep what
            // was recorded and say why it stopped.
            onStalled: (message) => {
              stallNotice = message;
              get().stopVoiceCapture();
            },
          },
        );
        if (permissionCancelled) {
          await live?.cancel().catch(() => undefined);
          stream.getTracks().forEach((track) => track.stop());
          set({ recordingState: "idle" });
          return;
        }
        if (live) {
          activeLive = live;
          activeLiveOnline = online;
          activeStream = stream;
          activeStartedAt = Date.now();
          startLevelMeter(stream);
          set({ recordingState: "recording" });
          return;
        }
        // The recorder could not start (no speech model yet, say). The
        // short-recording path below explains what is missing.
      }
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
        if (discardCapture) {
          discardCapture = false;
          stopActiveStream();
          activeRecorder = undefined;
          activeChunks = [];
          set({ recordingState: "idle" });
          return;
        }
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
        const generation = captureGeneration;
        set({ recordingState: "uploading" });

        void submitCapturedAudioCloud(blob, metadata, {
          ...captureSettings,
          canUseCloud: () => get().privacyLevel === "cloud",
          signal: cloudAbort?.signal,
          ...(onlineChoice.provider !== "local"
            ? {
                cloudTranscriber: (
                  audio: Blob,
                  metadata: VoiceCaptureMetadata,
                ) =>
                  transcribeUsingProvider(
                    audio,
                    metadata,
                    onlineChoice,
                    captureSettings.language,
                    () => get().privacyLevel === "cloud",
                  ),
              }
            : {}),
        })
          .then(async (api) => {
            if (generation !== captureGeneration) return;
            await completeCapture(api, metadata, URL.createObjectURL(blob));
          })
          .catch((error: unknown) => {
            if (generation !== captureGeneration) return;
            set({
              recordingState: "error",
              voiceError:
                error instanceof Error ? error.message : "error.sendFailed",
            });
          });
      };

      startLevelMeter(stream);
      activeRecorder.start();
      captureTimer = setTimeout(() => get().stopVoiceCapture(), 179_000);
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
    clearTimeout(captureTimer);
    if (get().recordingState === "requesting-permission") {
      permissionCancelled = true;
      return;
    }
    if (activeLive) {
      const live = activeLive;
      activeLive = undefined;
      const elapsedMs = Date.now() - activeStartedAt;
      const generation = captureGeneration;
      const online = activeLiveOnline;
      // Closing the audio feed comes first, then the microphone itself.
      const finishing = live.finish();
      stopActiveStream();
      set({ recordingState: "uploading" });
      void finishing
        .then(async (result) => {
          if (generation !== captureGeneration) return;
          const durationMs = result.durationMs || elapsedMs;
          await completeCapture(
            {
              status: "completed",
              transcript: result.text,
              segments: result.segments,
              ...(result.captureId ? { captureId: result.captureId } : {}),
              message: getT()(
                online ? "voice.onlineModel" : "voice.localWhisper",
              ),
            },
            // 16 kHz mono 16-bit WAV: 32 bytes a millisecond.
            { durationMs, mimeType: "audio/wav", sizeBytes: durationMs * 32 },
            "",
          );
        })
        .catch((error: unknown) => {
          if (generation !== captureGeneration) return;
          const message =
            error instanceof Error ? error.message : String(error);
          set({
            recordingState: "error",
            liveTranscript: "",
            // Unless nothing was recorded, the audio is saved and can be
            // transcribed again from the Library.
            voiceError:
              message === localizeNativeMessage("No audio was recorded.")
                ? message
                : getT()("capture.keptForRetry", { error: message }),
          });
        });
      return;
    }
    if (activeRecorder?.state === "recording") {
      activeRecorder.stop();
      return;
    }
    stopActiveStream();
    activeRecorder = undefined;
    set({ recordingState: "idle" });
  },
  cancelVoiceCapture: () => {
    const { recordingState } = get();
    if (recordingState === "recording" && activeLive) {
      const live = activeLive;
      activeLive = undefined;
      // Deletes the recording on the native side too.
      void live.cancel().catch(() => undefined);
      stopActiveStream();
      set({ recordingState: "idle", liveTranscript: "" });
      return;
    }
    if (
      recordingState === "recording" &&
      activeRecorder?.state === "recording"
    ) {
      discardCapture = true;
      clearTimeout(captureTimer);
      activeRecorder.stop();
      return;
    }
    if (recordingState === "uploading") {
      captureGeneration += 1;
      cloudAbort?.abort();
      set({ recordingState: "idle" });
      return;
    }
    get().stopVoiceCapture();
  },
  resetVoiceCapture: () =>
    set((state) => {
      if (state.voiceCapture?.objectUrl)
        URL.revokeObjectURL(state.voiceCapture.objectUrl);
      return {
        recordingState: "idle",
        voiceError: undefined,
        voiceCapture: undefined,
        liveTranscript: "",
      };
    }),
  setActiveView: (view) => set({ activeView: view }),
  setPrivacyLevel: (level) => {
    void setProviderMode(level === "cloud").catch(() => undefined);
    if (level === "local") cloudAbort?.abort();
    saveSettings(SETTINGS_KEYS.privacyLevel, level);
    set({ privacyLevel: level });
  },
  loadTranscriptHistory: async () => {
    if (get().privacyLevel !== "cloud") {
      set({
        transcriptHistory: [],
        transcriptHistorySource: "offline",
        transcriptHistoryLoading: false,
      });
      return;
    }
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
    if (get().privacyLevel !== "cloud") return;
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
      ...withUndoSnapshot(
        state,
        syncTranscriptText(value, state.transcriptSegments),
      ),
      polishedPreview: polishDictation(value, {
        dictionary: state.dictionaryEntries,
        snippets: state.snippets,
      }),
    })),
  applyPolishedPreview: () => {
    const { polishedPreview } = get();
    if (!polishedPreview.trim()) return;
    set((state) => {
      const next = syncTranscriptText(
        polishedPreview,
        state.transcriptSegments,
      );
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
    const merged = mergeSegmentRun(transcriptSegments, selectedSegmentIds);
    if (merged === transcriptSegments) return;
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
    const { selectedSegmentIds, splitSegment } = get();
    if (selectedSegmentIds.length === 1) splitSegment(selectedSegmentIds[0]!);
  },
  splitSegment: (segmentId, splitIndex) => {
    const { transcriptSegments } = get();
    const segment = transcriptSegments.find((item) => item.id === segmentId);
    if (!segment) return;
    const usable =
      splitIndex !== undefined &&
      segment.text.slice(0, splitIndex).trim() &&
      segment.text.slice(splitIndex).trim();
    const split = splitTranscriptSegment(
      transcriptSegments,
      segment.id,
      usable ? splitIndex : splitAtReadableMidpoint(segment.text),
    );
    if (split === transcriptSegments) return;
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
  moveSegment: (segmentId, direction) => {
    const moved = moveTranscriptSegment(
      get().transcriptSegments,
      segmentId,
      direction,
    );
    if (moved === get().transcriptSegments) return;
    set((state) => {
      const next = syncSegments(moved, state.selectedSegmentIds);
      return {
        ...withUndoSnapshot(state, next),
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    });
  },
  setSpeakerForSelection: (speaker) =>
    set((state) => {
      if (!state.selectedSegmentIds.length) return state;
      const next = syncSegments(
        state.transcriptSegments.map((segment) =>
          state.selectedSegmentIds.includes(segment.id)
            ? assignSpeakerLabel(segment, speaker)
            : segment,
        ),
        state.selectedSegmentIds,
      );
      return withUndoSnapshot(state, next);
    }),
  clearSegmentSelection: () => set({ selectedSegmentIds: [] }),
  setOpenedVersion: (id, hlc) => set({ openedVersion: { id, hlc } }),
  openCapture: (capture) =>
    set((state) => {
      const next = syncSegments(segmentsFromCapture(capture), []);
      return {
        ...withUndoSnapshot(state, next),
        openedVersion:
          capture.hlc === undefined
            ? null
            : { id: capture.id, hlc: capture.hlc },
        activeSessionId: null,
        polishedPreview: polishedForState({
          ...state,
          transcript: next.transcript,
        }),
      };
    }),
  addToast: (message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 6000);
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
      const next = syncTranscriptText(transformed, state.transcriptSegments);
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
