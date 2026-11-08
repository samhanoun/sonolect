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
import {
  showRecorderWindow,
  hideRecorderWindow,
  resizeRecorderWindow,
} from "./tauriWindowManager";
import { FloatingRecorderOverlay } from "./FloatingRecorder";
import type { RecordingState as FloatingRecordingState } from "./recordingStateMachine";
import { ReaderView } from "./ReaderView";
import { TeamView } from "./TeamView";
import { processTranscriptWithCommands } from "./voiceCommandIntegration";
import { generateSummary, type SummaryStyle } from "./aiSummary";
import {
  buildWhisperPrompt,
  extractProperNouns,
  extractTechnicalTerms,
} from "./contextSpelling";
import { preprocessAudio, AUDIO_PRESETS } from "./audioPreprocessing";
import "./tailwind.css";
import DictionaryPanel from "./components/DictionaryPanel";
import SnippetsPanel from "./components/SnippetsPanel";
import SettingsPanel from "./components/LocalSettingsPanel";
import StudioShell from "./components/StudioShell";
import CloudFeature from "./components/CloudFeature";
import HistoryPanel from "./components/LocalHistoryPanel";
import AppSidebar from "./components/Sidebar";
import OnboardingView from "./components/OnboardingPanel";
import CommandPaletteView from "./components/CommandPalette";
import RecorderPillView from "./components/RecorderPill";
import { formatDuration, formatTimestamp } from "./lib/format";
import {
  useDesktopStore,
  API_URL,
  type ViewId,
  type TranscriptSession,
  type RecordingState,
} from "./store/appStore";
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
        !isTauriRuntime() &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        toggleRecording();
      }
      // Push-to-talk: ⌘⇧V — hold to record
      if (
        !isTauriRuntime() &&
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
        if (
          !isTauriRuntime() &&
          (rs === "recording" || rs === "requesting-permission")
        ) {
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
      if (rs === "recording" || rs === "requesting-permission") {
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

  return <StudioShell />;
}

/* ── Workspace Router ────────────────────────────────────────── */

function WorkspaceRouter() {
  const activeView = useDesktopStore((state) => state.activeView);
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const t = useT();

  const panels: Partial<Record<ViewId, React.ReactNode>> = {
    settings: <SettingsPanel />,
    dictionary: <DictionaryPanel />,
    snippets: <SnippetsPanel />,
    onboarding: <SettingsPanel />,
    team: (
      <div className="flex-1 overflow-y-auto p-10">
        <CloudFeature>
          <TeamView currentUserId="local-user" />
        </CloudFeature>
      </div>
    ),
    reader: (
      <div className="flex-1 overflow-y-auto p-10">
        <CloudFeature>
          <ReaderView />
        </CloudFeature>
      </div>
    ),
  };

  return (
    <section
      className="flex flex-1 flex-col h-full min-w-0 overflow-hidden"
      aria-label={t("workspace.ariaLabel")}
    >
      <TopBar />
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {panels[activeView] ??
          (activeSessionId ? <TranscriptDetail /> : <HistoryPanel />)}
      </div>
    </section>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────── */

function TopBar() {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const t = useT();

  return (
    <header className="flex items-center justify-between gap-4 px-8 py-4 border-b border-white/5 bg-[#0A0A0A] shrink-0">
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Sonolect · local speech
        </p>
        <h2 className="text-sm font-medium text-white mt-0.5">
          {t("topbar.headline")}
        </h2>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-slate-400 border border-white/10 rounded-full px-3 py-1.5">
          {privacyLevel === "local"
            ? t("topbar.localFirst")
            : t("topbar.cloudAssisted")}{" "}
          ·{" "}
          {isVoiceApiConfigured() ? t("topbar.apiReady") : t("topbar.offline")}
        </span>
        <button
          className="flex items-center gap-2 text-xs text-slate-300 border border-white/10 rounded-full px-4 py-2 hover:bg-white/5 transition-all"
          onClick={() => setCommandOpen(true)}
          type="button"
        >
          {t("topbar.searchCommand")}{" "}
          <kbd className="text-[10px] font-mono text-slate-500 border border-white/10 rounded px-1">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}

/* ── Home Dashboard (Whispr Flow inspired) ───────────────────── */

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

  const ghost =
    "px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40 transition-all";
  const primary =
    "px-4 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-slate-200 disabled:opacity-40 transition-all";

  return (
    <section className="flex-1 overflow-y-auto p-10 bg-[#0A0A0A] text-[#F0F0F0] space-y-6 artistic-aura">
      <button
        className="text-[11px] uppercase tracking-widest text-slate-400 hover:text-white transition-all"
        onClick={clearActiveSession}
        type="button"
      >
        ← {t("home.backToTimeline")}
      </button>
      <div>
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
          {t("editor.eyebrow")}
        </p>
        <h3 className="text-2xl font-light text-white tracking-tight mt-1">
          {activeSession?.title ?? t("editor.fallbackTitle")}
        </h3>
        {activeSession ? (
          <p className="text-[11px] text-slate-500 mt-1">
            {activeSession.status} · {activeSession.duration} ·{" "}
            {activeSession.metadata}
          </p>
        ) : null}
      </div>

      <div className="bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 space-y-4">
        {draftRestored ? (
          <p className="text-[11px] text-cyan-400">
            {t("editor.draftRestored")}
          </p>
        ) : null}
        <div className="flex gap-2" aria-label={t("editor.historyControls")}>
          <button
            className={ghost}
            disabled={!canUndoTranscript}
            onClick={undoTranscriptEdit}
            type="button"
          >
            {t("editor.undo")}
          </button>
          <button
            className={ghost}
            disabled={!canRedoTranscript}
            onClick={redoTranscriptEdit}
            type="button"
          >
            {t("editor.redo")}
          </button>
        </div>
        <textarea
          aria-label={t("editor.textareaLabel")}
          className="w-full min-h-[200px] bg-[#0E0E0E] border border-white/5 rounded-xl p-4 text-sm text-white leading-relaxed focus:outline-none focus:border-white/20 resize-y"
          onChange={(event) => setTranscript(event.target.value)}
          spellCheck="true"
          value={transcript}
        />
      </div>

      <section
        className="bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 space-y-4"
        aria-label={t("segments.ariaLabel")}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
              {t("segments.title")}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {transcriptSegments.length} {t("segments.count")}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={ghost}
              disabled={!canMergeSegments}
              onClick={mergeSelectedSegments}
              type="button"
            >
              {t("segments.merge")}
            </button>
            <button
              className={ghost}
              disabled={!canSplitSegment}
              onClick={splitSelectedSegment}
              type="button"
            >
              {t("segments.split")}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {transcriptSegments.length === 0 ? (
            <p className="text-[11px] text-slate-500">{t("segments.empty")}</p>
          ) : (
            transcriptSegments.map((segment, index) => {
              const selected = selectedSegmentIds.includes(segment.id);
              return (
                <article
                  className={`bg-[#0E0E0E] border rounded-xl p-4 space-y-2.5 ${
                    selected ? "border-white/20" : "border-white/5"
                  }`}
                  key={segment.id}
                >
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
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
                  <label className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>{t("segments.speaker")}</span>
                    <input
                      aria-label={`${t("segments.speaker")} ${index + 1}`}
                      className="bg-[#0C0C0C] border border-white/5 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-white/20"
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
                    className="w-full bg-[#0C0C0C] border border-white/5 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-white/20 resize-y"
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

      <section
        className="bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 space-y-3"
        aria-label="Wispr-style polished preview"
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            Wispr-style auto-edit
          </p>
          <h4 className="text-sm text-white mt-0.5">
            Raw speech → polished text
          </h4>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          {polishedPreview ||
            "Record or type a dictation to see the cleaned preview."}
        </p>
        {insertionStatus ? (
          <p className="text-[11px] text-slate-500">{insertionStatus}</p>
        ) : null}
        <div className="flex gap-2">
          <button
            className={ghost}
            disabled={!polishedPreview.trim()}
            onClick={applyPolishedPreview}
            type="button"
          >
            Replace editor with preview
          </button>
          <button
            className={primary}
            disabled={!polishedPreview.trim() && !transcript.trim()}
            onClick={() => void insertPolishedDictation()}
            type="button"
          >
            Copy for active app
          </button>
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-2">
        <span>
          {wordCount} {t("editor.wordCount")}
        </span>
        <span>{t("editor.language")}</span>
        <button className={ghost} onClick={handleCopy} type="button">
          {t("editor.copy")}
        </button>
        {(["txt", "md", "srt", "vtt", "json"] as TranscriptExportFormat[]).map(
          (format) => (
            <button
              className={ghost}
              key={format}
              onClick={() => handleDownload(format)}
              type="button"
            >
              {format === "txt" ? t("editor.download") : format.toUpperCase()}
            </button>
          ),
        )}
        <button
          className={primary}
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

function ToastContainer() {
  const toasts = useDesktopStore((state) => state.toasts);
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="px-4 py-2.5 rounded-xl bg-[#0C0C0C] border border-white/10 text-xs text-white shadow-2xl"
        >
          {t(toast.message as LocaleKeys)}
        </div>
      ))}
    </div>
  );
}

/* ── Recorder window shell (rendered when ?window=recorder) ──── */

function RecorderWindowShell() {
  const [state, setState] = useState<FloatingRecordingState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(true);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | undefined;
      if (!data || data.type !== "sonolect-recorder-sync") return;
      if (typeof data.state === "string")
        setState(data.state as FloatingRecordingState);
      if (typeof data.durationMs === "number") setDurationMs(data.durationMs);
      if (Array.isArray(data.peaks)) setPeaks(data.peaks as number[]);
      if (typeof data.preview === "string" || data.preview === null)
        setPreview(data.preview as string | null);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleMinimize = useCallback(() => {
    const next = !minimized;
    setMinimized(next);
    void resizeRecorderWindow(!next);
  }, [minimized]);

  return (
    <FloatingRecorderOverlay
      recordingState={state}
      durationMs={durationMs}
      waveformPeaks={peaks}
      polishedPreview={preview}
      minimized={minimized}
      onCancel={() =>
        window.postMessage({
          type: "sonolect-recorder-action",
          action: "cancel",
        })
      }
      onFinish={() =>
        window.postMessage({
          type: "sonolect-recorder-action",
          action: "finish",
        })
      }
      onInsert={() =>
        window.postMessage({
          type: "sonolect-recorder-action",
          action: "insert",
        })
      }
      onMinimize={handleMinimize}
    />
  );
}

/* ── Recording window lifecycle hook ───────────────────────────── */

function useRecorderWindowLifecycle() {
  const recordingState = useDesktopStore((s) => s.recordingState);
  const prevStateRef = useRef<RecordingState>("idle");

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = recordingState;

    // Show the recorder window when recording starts
    if (
      prev === "idle" &&
      (recordingState === "requesting-permission" ||
        recordingState === "recording")
    ) {
      void showRecorderWindow();
    }

    // Hide the recorder window after a brief delay when recording completes or resets
    if (
      (recordingState === "idle" || recordingState === "completed") &&
      prev !== "idle" &&
      prev !== "completed"
    ) {
      const timer = setTimeout(() => void hideRecorderWindow(), 600);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [recordingState]);
}

/* ── Mount ───────────────────────────────────────────────────── */

const isRecorderWindow =
  new URLSearchParams(window.location.search).get("window") === "recorder";

if (isRecorderWindow) {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RecorderWindowShell />
    </React.StrictMode>,
  );
} else {
  // Wrap App to include the recorder window lifecycle hook
  function AppWithRecorderWindow() {
    // Use the in-window recorder until cross-window state and focus are verified.
    return <App />;
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppWithRecorderWindow />
    </React.StrictMode>,
  );
}
