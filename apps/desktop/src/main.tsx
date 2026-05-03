import React, { useEffect, useMemo } from "react";
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
import "./styles.css";

type PrivacyLevel = "local" | "cloud";
type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "completed"
  | "error";
type ViewId = "today" | "history" | "agents" | "settings";

type VoiceCaptureResult = VoiceCaptureMetadata & {
  objectUrl: string;
  completedAt: string;
  api: TranscriptJobResult;
};

type TranscriptSession = TranscriptHistoryRow;

type AgentAction = {
  id: string;
  titleKey: LocaleKeys;
  descriptionKey: LocaleKeys;
  app: string;
  tone: "violet" | "cyan" | "amber";
};

type DesktopState = {
  commandOpen: boolean;
  recordingState: RecordingState;
  activeView: ViewId;
  privacyLevel: PrivacyLevel;
  activeSessionId: string;
  transcript: string;
  transcriptHistory: TranscriptSession[];
  transcriptHistorySource: "api" | "offline";
  transcriptHistoryLoading: boolean;
  transcriptHistoryError: string | undefined;
  voiceCapture: VoiceCaptureResult | undefined;
  voiceError: string | undefined;
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  sttLanguage: string;
  setSttLanguage: (lang: string) => void;
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
  setTranscript: (value: string) => void;
};

const API_URL = import.meta.env.VITE_SONOLECT_API_URL?.trim();
const AUTH_CONFIG = resolveDesktopAuthConfig();
const API_TOKEN = AUTH_CONFIG.token;
const sessions: TranscriptSession[] = offlineTranscriptHistory;

const agentActions: AgentAction[] = [
  {
    id: "notion",
    titleKey: "agents.notion.title",
    descriptionKey: "agents.notion.description",
    app: "Notion",
    tone: "violet",
  },
  {
    id: "linear",
    titleKey: "agents.linear.title",
    descriptionKey: "agents.linear.description",
    app: "Linear",
    tone: "cyan",
  },
  {
    id: "mail",
    titleKey: "agents.mail.title",
    descriptionKey: "agents.mail.description",
    app: "Gmail",
    tone: "amber",
  },
];

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

function stopActiveStream() {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
}

const useDesktopStore = create<DesktopState>((set, get) => ({
  commandOpen: false,
  recordingState: "idle",
  activeView: "today",
  privacyLevel: "local",
  activeSessionId: sessions[0]?.id ?? "session-1",
  transcript: "",
  transcriptHistory: sessions,
  transcriptHistorySource: "offline",
  transcriptHistoryLoading: false,
  transcriptHistoryError: undefined,
  voiceCapture: undefined,
  voiceError: undefined,
  locale: useI18nStore.getState().locale,
  setLocale: (locale) => {
    useI18nStore.getState().setLocale(locale);
    set({ locale });
  },
  sttLanguage: "auto",
  setSttLanguage: (lang) => set({ sttLanguage: lang }),
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
            const capture: VoiceCaptureResult = {
              ...metadata,
              objectUrl,
              completedAt: new Date().toISOString(),
              api,
            };
            const fallbackTranscript =
              api.status === "offline"
                ? `\n\n[${formatDuration(metadata.durationMs)} · ${metadata.mimeType} · ${Math.round(metadata.sizeBytes / 1024)} KB]`
                : `\n\n[Job ${api.jobId ?? "pending"} · ${formatDuration(metadata.durationMs)}]`;
            set((state) => ({
              recordingState: "completed",
              voiceCapture: capture,
              voiceError: undefined,
              transcript: `${state.transcript}${api.transcript ? `\n\n${api.transcript}` : fallbackTranscript}`,
            }));
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
  setPrivacyLevel: (level) => set({ privacyLevel: level }),
  loadTranscriptHistory: async () => {
    set({ transcriptHistoryLoading: true, transcriptHistoryError: undefined });
    try {
      const history = await fetchTranscriptHistory({
        apiUrl: API_URL,
        token: API_TOKEN,
      });
      const activeSession = history.items[0];
      set((state) => ({
        transcriptHistory: history.items,
        transcriptHistorySource: history.source,
        transcriptHistoryLoading: false,
        transcriptHistoryError: undefined,
        activeSessionId: activeSession?.id ?? state.activeSessionId,
        transcript: activeSession?.transcript ?? state.transcript,
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
      set({ activeSessionId: fallback.id, transcript: fallback.transcript });
    }
    try {
      const detail = await fetchTranscriptDetail(sessionId, {
        apiUrl: API_URL,
        token: API_TOKEN,
      });
      if (detail) {
        set((state) => ({
          activeSessionId: detail.id,
          transcript: detail.transcript,
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
  setActiveSession: (sessionId, transcript) =>
    set({ activeSessionId: sessionId, transcript }),
  setTranscript: (value) => set({ transcript: value }),
}));

function App() {
  const commandOpen = useDesktopStore((state) => state.commandOpen);
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const loadTranscriptHistory = useDesktopStore(
    (state) => state.loadTranscriptHistory,
  );
  const t = useT();

  // Set initial transcript based on locale
  useEffect(() => {
    const store = useDesktopStore.getState();
    if (!store.transcript) {
      store.setTranscript(t("initialTranscript"));
    }
  }, [t]);

  useEffect(() => {
    void loadTranscriptHistory();
  }, [loadTranscriptHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        toggleRecording();
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setCommandOpen, toggleRecording]);

  return (
    <main className="desktop-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="signal-rings" aria-hidden="true" />
      <Sidebar />
      <section className="workspace" aria-label={t("workspace.ariaLabel")}>
        <TopBar />
        <div className="workspace-grid">
          <TranscriptEditor />
          <RightRail />
        </div>
      </section>
      <VoiceRecorderOverlay />
      {commandOpen ? <CommandPalette /> : null}
    </main>
  );
}

function Sidebar() {
  const activeView = useDesktopStore((state) => state.activeView);
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
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
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const selectTranscriptSession = useDesktopStore(
    (state) => state.selectTranscriptSession,
  );
  const t = useT();

  const navItems: Array<{ id: ViewId; labelKey: LocaleKeys; count?: number }> =
    [
      { id: "today", labelKey: "nav.today", count: transcriptHistory.length },
      {
        id: "history",
        labelKey: "nav.history",
        count: transcriptHistory.length,
      },
      { id: "agents", labelKey: "nav.agents" },
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
        <kbd>⌘⇧M</kbd>
      </button>

      <nav className="nav-list" aria-label="Navigation principale">
        {navItems.map((item) => (
          <button
            className={activeView === item.id ? "nav-item active" : "nav-item"}
            key={item.id}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            <span>{t(item.labelKey)}</span>
            {typeof item.count === "number" ? (
              <span className="pill">{item.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

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
              setActiveView("history");
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
    </aside>
  );
}

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

function TranscriptEditor() {
  const transcript = useDesktopStore((state) => state.transcript);
  const activeSessionId = useDesktopStore((state) => state.activeSessionId);
  const transcriptHistory = useDesktopStore((state) => state.transcriptHistory);
  const setTranscript = useDesktopStore((state) => state.setTranscript);
  const t = useT();
  const activeSession = transcriptHistory.find(
    (session) => session.id === activeSessionId,
  );
  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript],
  );

  return (
    <section className="editor-panel">
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
        <div className="mode-switcher" aria-label="Modes de transformation">
          <button className="mode active" type="button">
            {t("editor.modeSummary")}
          </button>
          <button className="mode" type="button">
            {t("editor.modeEmail")}
          </button>
          <button className="mode" type="button">
            {t("editor.modeTicket")}
          </button>
        </div>
      </div>

      <div className="voice-command-strip" aria-label="Statut du flux vocal">
        <span className="neural-orb" aria-hidden="true" />
        <div>
          <strong>{t("editor.voiceCanvas")}</strong>
          <small>{t("editor.voiceCanvasSubtitle")}</small>
        </div>
        <span className="latency-chip">38 ms</span>
      </div>

      <div className="hologram-frame">
        <textarea
          aria-label={t("editor.textareaLabel")}
          className="transcript-input"
          onChange={(event) => setTranscript(event.target.value)}
          spellCheck="true"
          value={transcript}
        />
      </div>

      <footer className="editor-footer">
        <span>
          {wordCount} {t("editor.wordCount")}
        </span>
        <span>{t("editor.language")}</span>
        <button className="primary-button" type="button">
          {t("editor.transformCta")}
        </button>
      </footer>
    </section>
  );
}

function RightRail() {
  return (
    <aside className="right-rail">
      <SettingsPrivacy />
      <AgentActions />
    </aside>
  );
}

function SettingsPrivacy() {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  const setPrivacyLevel = useDesktopStore((state) => state.setPrivacyLevel);
  const t = useT();

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
        >
          {t("privacy.local")}
        </button>
        <button
          className={privacyLevel === "cloud" ? "active" : ""}
          onClick={() => setPrivacyLevel("cloud")}
          type="button"
        >
          {t("privacy.cloud")}
        </button>
      </div>
      <ul className="check-list">
        <li>{t("privacy.autoDelete")}</li>
        <li>{t("privacy.maskNames")}</li>
        <li>{t("privacy.exportTextOnly")}</li>
      </ul>
    </section>
  );
}

function AgentActions() {
  const t = useT();

  return (
    <section className="glass-card action-stack">
      <div className="section-title">{t("agents.title")}</div>
      {agentActions.map((action) => (
        <article className={`agent-card ${action.tone}`} key={action.id}>
          <div>
            <span className="app-badge">{action.app}</span>
            <h4>{t(action.titleKey)}</h4>
            <p>{t(action.descriptionKey)}</p>
          </div>
          <button type="button">{t("agents.preview")}</button>
        </article>
      ))}
    </section>
  );
}

function VoiceRecorderOverlay() {
  const recordingState = useDesktopStore((state) => state.recordingState);
  const voiceCapture = useDesktopStore((state) => state.voiceCapture);
  const voiceError = useDesktopStore((state) => state.voiceError);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const resetVoiceCapture = useDesktopStore((state) => state.resetVoiceCapture);
  const t = useT();

  if (recordingState === "idle") return null;

  const isRecording = recordingState === "recording";
  const copy = voiceStateCopy(recordingState, t, voiceCapture, voiceError);

  return (
    <div
      className="recorder-overlay"
      role="dialog"
      aria-label={t("recorder.ariaLabel")}
    >
      <div className="recorder-card">
        <div className={isRecording ? "mic-orb active" : "mic-orb"} />
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3>{copy.title}</h3>
        </div>
        <Waveform active={isRecording} />
        <p className="recorder-status">{copy.detail}</p>
        {voiceCapture ? (
          <div className="capture-meta">
            <span>{formatDuration(voiceCapture.durationMs)}</span>
            <span>{voiceCapture.mimeType}</span>
            <span>
              {Math.round(voiceCapture.sizeBytes / 1024)} {t("recorder.kb")}
            </span>
            <a href={voiceCapture.objectUrl} download="sonolect-capture.webm">
              {t("recorder.listenDownload")}
            </a>
          </div>
        ) : null}
        <div className="recorder-actions">
          {recordingState === "completed" || recordingState === "error" ? (
            <button
              className="ghost-button"
              onClick={resetVoiceCapture}
              type="button"
            >
              {t("recorder.close")}
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={
              recordingState === "requesting-permission" ||
              recordingState === "uploading"
            }
            onClick={toggleRecording}
            type="button"
          >
            {isRecording ? t("recorder.stopCapture") : t("recorder.newCapture")}
          </button>
        </div>
      </div>
    </div>
  );
}

function voiceStateCopy(
  state: RecordingState,
  t: (key: LocaleKeys) => string,
  capture?: VoiceCaptureResult,
  error?: string,
) {
  switch (state) {
    case "requesting-permission":
      return {
        eyebrow: t("voice.permission.eyebrow"),
        title: t("voice.permission.title"),
        detail: t("voice.permission.detail"),
      };
    case "recording":
      return {
        eyebrow: t("voice.recording.eyebrow"),
        title: t("voice.recording.title"),
        detail: t("voice.recording.detail"),
      };
    case "uploading":
      return {
        eyebrow: t("voice.uploading.eyebrow"),
        title: t("voice.uploading.title"),
        detail: isVoiceApiConfigured()
          ? t("voice.uploading.detailConfigured")
          : t("voice.uploading.detailOffline"),
      };
    case "completed":
      return {
        eyebrow:
          capture?.api.status === "offline"
            ? t("voice.completed.eyebrowOffline")
            : t("voice.completed.eyebrow"),
        title:
          capture?.api.status === "offline"
            ? t("voice.completed.titleOffline")
            : t("voice.completed.title"),
        detail: capture?.api.message ?? t("voice.completed.detailFallback"),
      };
    case "error":
      return {
        eyebrow: t("voice.error.eyebrow"),
        title: t("voice.error.title"),
        detail: error ?? t("voice.error.detailFallback"),
      };
    default:
      return {
        eyebrow: t("voice.default.eyebrow"),
        title: t("voice.default.title"),
        detail: t("voice.default.detail"),
      };
  }
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={active ? "waveform active" : "waveform"} aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} style={{ animationDelay: `${index * 45}ms` }} />
      ))}
    </div>
  );
}

function CommandPalette() {
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const t = useT();
  const commands: Array<{
    labelKey: LocaleKeys;
    hintKey: LocaleKeys;
    action: () => void;
  }> = [
    {
      labelKey: "palette.newCapture",
      hintKey: "palette.newCaptureHint",
      action: () => useDesktopStore.getState().toggleRecording(),
    },
    {
      labelKey: "palette.openHistory",
      hintKey: "palette.openHistoryHint",
      action: () => setActiveView("history"),
    },
    {
      labelKey: "palette.agentCenter",
      hintKey: "palette.agentCenterHint",
      action: () => setActiveView("agents"),
    },
    {
      labelKey: "palette.privacySettings",
      hintKey: "palette.privacySettingsHint",
      action: () => setActiveView("settings"),
    },
  ];

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
          ⌘K&nbsp;&nbsp; {t("palette.prompt")}
        </div>
        <div className="command-list">
          {commands.map((command) => (
            <button
              key={command.labelKey}
              onClick={() => {
                command.action();
                setCommandOpen(false);
              }}
              type="button"
            >
              <span>{t(command.labelKey)}</span>
              <small>{t(command.hintKey)}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
