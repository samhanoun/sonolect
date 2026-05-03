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
  title: string;
  description: string;
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
    title: "Créer une note Notion",
    description:
      "Publie le compte-rendu structuré avec décisions, risques et prochaines étapes.",
    app: "Notion",
    tone: "violet",
  },
  {
    id: "linear",
    title: "Ouvrir 3 tickets Linear",
    description:
      "Découpe la transcription en issues avec priorités, labels et responsables proposés.",
    app: "Linear",
    tone: "cyan",
  },
  {
    id: "mail",
    title: "Rédiger un email premium",
    description:
      "Convertit le brouillon vocal en message clair, chaleureux et prêt à envoyer.",
    app: "Gmail",
    tone: "amber",
  },
];

const initialTranscript = `Objectif : préparer une démonstration Sonolect desktop premium.\n\nMettre l’accent sur une expérience voix-first : raccourci global, overlay micro immédiat, transcription éditable, puis actions agentiques.\n\nTon souhaité : français professionnel, direct, élégant. Prochaine action : générer un brief investisseur et trois tickets Linear.`;

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
  transcript: initialTranscript,
  transcriptHistory: sessions,
  transcriptHistorySource: "offline",
  transcriptHistoryLoading: false,
  transcriptHistoryError: undefined,
  voiceCapture: undefined,
  voiceError: undefined,
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
        voiceError:
          "La capture micro n’est pas disponible dans cet environnement.",
      });
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      set({
        recordingState: "error",
        voiceError: "MediaRecorder n’est pas supporté par ce runtime desktop.",
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
          voiceError: "Erreur pendant l’enregistrement audio.",
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
                ? `\n\n[Capture vocale locale] ${formatDuration(metadata.durationMs)} · ${metadata.mimeType} · ${Math.round(metadata.sizeBytes / 1024)} Ko. Backend non configuré (VITE_SONOLECT_API_URL).`
                : `\n\n[Capture vocale envoyée] Job ${api.jobId ?? "en attente"} · ${formatDuration(metadata.durationMs)}.`;
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
                error instanceof Error
                  ? error.message
                  : "Impossible d’envoyer la capture au backend.",
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
          error instanceof Error
            ? error.message
            : "Permission micro refusée ou indisponible.",
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
          error instanceof Error
            ? error.message
            : "Impossible de charger l’historique des transcriptions.",
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
          error instanceof Error
            ? error.message
            : "Impossible d’ouvrir le détail de transcription.",
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
      <Sidebar />
      <section className="workspace" aria-label="Espace de travail Sonolect">
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

  const navItems: Array<{ id: ViewId; label: string; count?: number }> = [
    { id: "today", label: "Aujourd’hui", count: transcriptHistory.length },
    { id: "history", label: "Historique", count: transcriptHistory.length },
    { id: "agents", label: "Agents" },
    { id: "settings", label: "Réglages" },
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
        <span className="record-dot" /> Parler maintenant
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
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span className="pill">{item.count}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="history-block">
        <div className="section-title">
          Dernières dictées ·{" "}
          {transcriptHistorySource === "api" ? "API" : "offline"}
        </div>
        {transcriptHistoryLoading ? (
          <p className="history-helper">Chargement de l’historique…</p>
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

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Shell desktop premium</p>
        <h2>Capture vocale → texte → actions</h2>
      </div>
      <div className="topbar-actions">
        <span className="status-chip">
          {privacyLevel === "local" ? "Local-first" : "Cloud assisté"} ·{" "}
          {isVoiceApiConfigured() ? "API prête" : "Offline"}
        </span>
        <button
          className="ghost-button"
          onClick={() => setCommandOpen(true)}
          type="button"
        >
          Rechercher une commande <kbd>⌘K</kbd>
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
          <p className="eyebrow">Transcription éditable</p>
          <h3>{activeSession?.title ?? "Brief vocal enrichi"}</h3>
          {activeSession ? (
            <p className="editor-meta">
              {activeSession.status} · {activeSession.duration} ·{" "}
              {activeSession.metadata}
            </p>
          ) : null}
        </div>
        <div className="mode-switcher" aria-label="Modes de transformation">
          <button className="mode active" type="button">
            Résumé
          </button>
          <button className="mode" type="button">
            Email
          </button>
          <button className="mode" type="button">
            Ticket
          </button>
        </div>
      </div>

      <textarea
        aria-label="Éditeur de transcription"
        className="transcript-input"
        onChange={(event) => setTranscript(event.target.value)}
        spellCheck="true"
        value={transcript}
      />

      <footer className="editor-footer">
        <span>{wordCount} mots</span>
        <span>Langue : Français</span>
        <button className="primary-button" type="button">
          Transformer avec Sonolect
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

  return (
    <section className="glass-card">
      <div className="section-title">Confidentialité</div>
      <h3>Contrôle de la voix</h3>
      <p>
        Choisissez où les captures audio et brouillons de transcription sont
        traités.
      </p>
      <div
        className="privacy-toggle"
        role="group"
        aria-label="Mode de confidentialité"
      >
        <button
          className={privacyLevel === "local" ? "active" : ""}
          onClick={() => setPrivacyLevel("local")}
          type="button"
        >
          Local
        </button>
        <button
          className={privacyLevel === "cloud" ? "active" : ""}
          onClick={() => setPrivacyLevel("cloud")}
          type="button"
        >
          Cloud
        </button>
      </div>
      <ul className="check-list">
        <li>Suppression automatique après 24h</li>
        <li>Masquage des noms propres sensibles</li>
        <li>Export texte uniquement sur demande</li>
      </ul>
    </section>
  );
}

function AgentActions() {
  return (
    <section className="glass-card action-stack">
      <div className="section-title">Actions agentiques</div>
      {agentActions.map((action) => (
        <article className={`agent-card ${action.tone}`} key={action.id}>
          <div>
            <span className="app-badge">{action.app}</span>
            <h4>{action.title}</h4>
            <p>{action.description}</p>
          </div>
          <button type="button">Prévisualiser</button>
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

  if (recordingState === "idle") return null;

  const isRecording = recordingState === "recording";
  const copy = voiceStateCopy(recordingState, voiceCapture, voiceError);

  return (
    <div
      className="recorder-overlay"
      role="dialog"
      aria-label="Enregistreur vocal Sonolect"
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
            <span>{Math.round(voiceCapture.sizeBytes / 1024)} Ko</span>
            <a href={voiceCapture.objectUrl} download="sonolect-capture.webm">
              Écouter / télécharger
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
              Fermer
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
            {isRecording ? "Terminer la capture" : "Nouvelle capture"}
          </button>
        </div>
      </div>
    </div>
  );
}

function voiceStateCopy(
  state: RecordingState,
  capture?: VoiceCaptureResult,
  error?: string,
) {
  switch (state) {
    case "requesting-permission":
      return {
        eyebrow: "Permission micro",
        title: "Autorisez l’accès au microphone",
        detail:
          "Sonolect demande navigator.mediaDevices.getUserMedia({ audio: true }).",
      };
    case "recording":
      return {
        eyebrow: "Écoute active",
        title: "Parlez, Sonolect capture votre voix",
        detail:
          "MediaRecorder collecte les fragments audio localement jusqu’à l’arrêt.",
      };
    case "uploading":
      return {
        eyebrow: "Envoi transcription",
        title: "Préparation du job backend…",
        detail: isVoiceApiConfigured()
          ? "Capture terminée : envoi au endpoint configuré par VITE_SONOLECT_API_URL."
          : "Aucun backend configuré : bascule vers le mode local/offline explicite.",
      };
    case "completed":
      return {
        eyebrow:
          capture?.api.status === "offline" ? "Terminé · offline" : "Terminé",
        title:
          capture?.api.status === "offline"
            ? "Capture locale prête"
            : "Capture envoyée",
        detail:
          capture?.api.message ??
          "Blob audio, durée, type MIME et URL locale ont été créés.",
      };
    case "error":
      return {
        eyebrow: "Erreur capture",
        title: "Impossible de finaliser l’enregistrement",
        detail: error ?? "Une erreur inconnue est survenue.",
      };
    default:
      return {
        eyebrow: "Prêt",
        title: "Capture vocale",
        detail: "Cliquez pour commencer.",
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
  const commands: Array<{ label: string; hint: string; action: () => void }> = [
    {
      label: "Nouvelle capture vocale",
      hint: "Démarrer l’overlay micro",
      action: () => useDesktopStore.getState().toggleRecording(),
    },
    {
      label: "Ouvrir historique",
      hint: "Retrouver une transcription",
      action: () => setActiveView("history"),
    },
    {
      label: "Centre agents",
      hint: "Voir les actions connectées",
      action: () => setActiveView("agents"),
    },
    {
      label: "Réglages confidentialité",
      hint: "Local-first, cloud, rétention",
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
        aria-label="Palette de commandes"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          ⌘K&nbsp;&nbsp; Que voulez-vous faire avec votre voix ?
        </div>
        <div className="command-list">
          {commands.map((command) => (
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
