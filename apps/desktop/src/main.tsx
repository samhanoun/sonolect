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
import { saveSettings, loadSettings, SETTINGS_KEYS } from "./persistence";
import { STT_LANGUAGES } from "./sttLanguages";
import "./styles.css";

type PrivacyLevel = "local" | "cloud";
type RecordingState =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "uploading"
  | "completed"
  | "error";
type ViewId = "today" | "history" | "settings";

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
  activeSessionId: string;
  transcript: string;
  transforming: boolean;
  toasts: Toast[];
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

function stopActiveStream() {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = undefined;
}

const useDesktopStore = create<DesktopState>((set, get) => ({
  commandOpen: false,
  recordingState: "idle",
  activeView: "today",
  privacyLevel:
    (loadSettings(SETTINGS_KEYS.privacyLevel) as PrivacyLevel) || "local",
  activeSessionId: sessions[0]?.id ?? "session-1",
  transcript: "",
  transcriptHistory: sessions,
  transcriptHistorySource: "offline",
  transcriptHistoryLoading: false,
  transcriptHistoryError: undefined,
  voiceCapture: undefined,
  voiceError: undefined,
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
    // Local text transformation
    const cleaned = transcript
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // Split into sentences and capitalize first letter of each
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    // Group into paragraphs (every 3 sentences)
    const paragraphs: string[] = [];
    for (let i = 0; i < sentences.length; i += 3) {
      paragraphs.push(sentences.slice(i, i + 3).join(" "));
    }
    // Generate title from first few words
    const firstWords = cleaned.split(/\s+/).slice(0, 6).join(" ");
    const title = `# ${firstWords}${firstWords.length < cleaned.length ? "…" : ""}`;
    const transformed = `${title}\n\n${paragraphs.join("\n\n")}`;
    set({ transcript: transformed, transforming: false });
    addToast("toast.transformComplete");
  },
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
        </div>
      </section>
      <VoiceRecorderPill />
      {commandOpen ? <CommandPalette /> : null}
      <ToastContainer />
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
  const transforming = useDesktopStore((state) => state.transforming);
  const transformTranscript = useDesktopStore(
    (state) => state.transformTranscript,
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

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(transcript).then(() => {
      addToast("toast.copySuccess");
    });
  }, [transcript, addToast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transcript.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [transcript]);

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
        <button className="ghost-button" onClick={handleCopy} type="button">
          {t("editor.copy")}
        </button>
        <button className="ghost-button" onClick={handleDownload} type="button">
          {t("editor.download")}
        </button>
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

function SettingsPrivacy() {
  const privacyLevel = useDesktopStore((state) => state.privacyLevel);
  const setPrivacyLevel = useDesktopStore((state) => state.setPrivacyLevel);
  const locale = useDesktopStore((state) => state.locale);
  const setLocale = useDesktopStore((state) => state.setLocale);
  const sttLanguage = useDesktopStore((state) => state.sttLanguage);
  const setSttLanguage = useDesktopStore((state) => state.setSttLanguage);
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

      <div className="section-title" style={{ marginTop: "1.5rem" }}>
        Locale
      </div>
      <div className="privacy-toggle" role="group" aria-label="Locale toggle">
        <button
          className={locale === "en" ? "active" : ""}
          onClick={() => setLocale("en")}
          type="button"
        >
          EN
        </button>
        <button
          className={locale === "fr" ? "active" : ""}
          onClick={() => setLocale("fr")}
          type="button"
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
    </section>
  );
}

function VoiceRecorderPill() {
  const recordingState = useDesktopStore((state) => state.recordingState);
  const voiceCapture = useDesktopStore((state) => state.voiceCapture);
  const voiceError = useDesktopStore((state) => state.voiceError);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const resetVoiceCapture = useDesktopStore((state) => state.resetVoiceCapture);
  const addToast = useDesktopStore((state) => state.addToast);
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
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
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
      labelKey: "palette.privacySettings",
      hintKey: "palette.privacySettingsHint",
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
      t(cmd.labelKey).toLowerCase().includes(q) ||
      t(cmd.hintKey).toLowerCase().includes(q)
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
            ))
          )}
        </div>
      </section>
    </div>
  );
}

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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
