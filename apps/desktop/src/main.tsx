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
import "./styles.css";
import DictionaryPanel from "./components/DictionaryPanel";
import SnippetsPanel from "./components/SnippetsPanel";
import SettingsPanel from "./components/SettingsPanel";
import HistoryPanel from "./components/HistoryPanel";
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

  return (
    <main className="desktop-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="signal-rings" aria-hidden="true" />
      <AppSidebar />
      <WorkspaceRouter />
      <RecorderPillView />
      {commandOpen ? <CommandPaletteView /> : null}
      <ToastContainer />
    </main>
  );
}

/* ── Workspace Router ────────────────────────────────────────── */

function WorkspaceRouter() {
  const activeView = useDesktopStore((state) => state.activeView);
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const t = useT();

  return (
    <section className="workspace" aria-label={t("workspace.ariaLabel")}>
      <TopBar />
      {activeView === "settings" ? (
        <div className="workspace-grid">
          <SettingsPanel />
        </div>
      ) : activeView === "dictionary" ? (
        <div className="workspace-grid">
          <DictionaryPanel />
        </div>
      ) : activeView === "snippets" ? (
        <div className="workspace-grid">
          <SnippetsPanel />
        </div>
      ) : activeView === "onboarding" ? (
        <div className="workspace-grid">
          <OnboardingView />
        </div>
      ) : activeView === "team" ? (
        <div className="workspace-grid">
          <TeamView currentUserId="local-user" />
        </div>
      ) : activeView === "reader" ? (
        <div className="workspace-grid">
          <ReaderView />
        </div>
      ) : activeSessionId ? (
        <div className="workspace-grid">
          <TranscriptDetail />
        </div>
      ) : (
        <HistoryPanel />
      )}
    </section>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────── */

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
        <span className="status-chip">
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
        >
          {t("topbar.searchCommand")} <kbd>⌘K</kbd>
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

function ToastContainer() {
  const toasts = useDesktopStore((state) => state.toasts);
  const t = useT();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
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
    useRecorderWindowLifecycle();
    return <App />;
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppWithRecorderWindow />
    </React.StrictMode>,
  );
}
