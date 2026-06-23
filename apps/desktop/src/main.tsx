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
      <Sidebar />
      <WorkspaceRouter />
      <VoiceRecorderPill />
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
          <OnboardingPanel />
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

function Sidebar() {
  const activeView = useDesktopStore((state) => state.activeView);
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const clearActiveSession = useDesktopStore(
    (state) => state.clearActiveSession,
  );
  const t = useT();

  const navItems: Array<{ id: ViewId; labelKey: LocaleKeys }> = [
    { id: "home", labelKey: "nav.home" },
    { id: "onboarding", labelKey: "nav.onboarding" },
    { id: "dictionary", labelKey: "nav.dictionary" },
    { id: "snippets", labelKey: "nav.snippets" },
    { id: "reader", labelKey: "nav.reader" },
    { id: "team", labelKey: "nav.team" },
    { id: "settings", labelKey: "nav.settings" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">S</div>
        <div>
          <p className="eyebrow">Sonolect</p>
          <h1>Voice OS</h1>
        </div>
      </div>

      <button
        className="record-cta"
        onClick={() => useDesktopStore.getState().toggleRecording()}
        type="button"
      >
        <span className="record-dot" /> {t("sidebar.recordNow")}
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
      <div className={isRecording ? "pill-orb active" : "pill-orb"} />
      <Waveform active={isRecording} />
      <span className="pill-status">{statusLabel}</span>
      {voiceError && isDone ? (
        <span className="pill-error">{voiceError}</span>
      ) : null}
      {voiceCapture && isDone ? (
        <a
          className="pill-link"
          href={voiceCapture.objectUrl}
          download="sonolect-capture.webm"
          title={t("recorder.listenDownload")}
        >
          ↓
        </a>
      ) : null}
      {isDone ? (
        <button
          className="pill-btn pill-btn-ghost"
          onClick={resetVoiceCapture}
          type="button"
          title={t("recorder.close")}
        >
          ✕
        </button>
      ) : null}
      <button
        className="pill-btn pill-btn-primary"
        disabled={isProcessing}
        onClick={toggleRecording}
        type="button"
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
  const commands: Array<{
    label: string;
    hint: string;
    action: () => void;
  }> = [
    {
      label: t("palette.newCapture"),
      hint: t("palette.newCaptureHint"),
      action: () => useDesktopStore.getState().toggleRecording(),
    },
    {
      label: "Copy polished dictation",
      hint: "Clipboard fallback for the app you were using",
      action: () => void useDesktopStore.getState().insertPolishedDictation(),
    },
    {
      label: "Apply polished preview",
      hint: "Replace raw transcript with cleaned text",
      action: () => useDesktopStore.getState().applyPolishedPreview(),
    },
    {
      label: "Open first-run setup",
      hint: "Mic, shortcuts, Whisper, privacy",
      action: () => setActiveView("onboarding"),
    },
    {
      label: "Open dictionary",
      hint: "Names, products, custom spelling",
      action: () => setActiveView("dictionary"),
    },
    {
      label: "Open snippets",
      hint: "Voice shortcuts and expansions",
      action: () => setActiveView("snippets"),
    },
    {
      label: t("palette.openHistory"),
      hint: t("palette.openHistoryHint"),
      action: () => {
        setActiveView("home");
        clearActiveSession();
      },
    },
    {
      label: t("palette.privacySettings"),
      hint: t("palette.privacySettingsHint"),
      action: () => setActiveView("settings"),
    },
  ];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = commands.filter((cmd) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(q) || cmd.hint.toLowerCase().includes(q)
    );
  });

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
        <div className="palette-input">
          <span className="palette-prefix">⌘K</span>
          <input
            ref={inputRef}
            className="palette-search"
            type="text"
            placeholder={t("palette.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="command-list">
          {filtered.length === 0 ? (
            <p className="palette-no-results">{t("palette.noResults")}</p>
          ) : (
            filtered.map((command) => (
              <button
                key={command.label}
                onClick={() => {
                  command.action();
                  setCommandOpen(false);
                }}
                type="button"
              >
                <span>{command.label}</span>
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
