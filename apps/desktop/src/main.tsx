import React, { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import type { SonolectMode } from "@sonolect/types";
import "./styles.css";

type PrivacyLevel = "local" | "cloud";
type RecordingState = "idle" | "recording" | "processing";
type ViewId = "today" | "history" | "agents" | "settings";

type TranscriptSession = {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  duration: string;
  mode: SonolectMode;
  status: "draft" | "synced" | "actioned";
};

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
  setCommandOpen: (open: boolean) => void;
  toggleRecording: () => void;
  finishProcessing: () => void;
  setActiveView: (view: ViewId) => void;
  setPrivacyLevel: (level: PrivacyLevel) => void;
  setActiveSession: (sessionId: string, transcript: string) => void;
  setTranscript: (value: string) => void;
};

const sessions: TranscriptSession[] = [
  {
    id: "session-1",
    title: "Préparer la démo investisseurs",
    preview:
      "Résumer la traction, clarifier le positionnement voix-first, puis créer un mail de suivi.",
    timestamp: "Aujourd’hui · 09:42",
    duration: "2m 18s",
    mode: "summarize",
    status: "actioned",
  },
  {
    id: "session-2",
    title: "Réponse client urgente",
    preview:
      "Transformer mes notes en réponse concise, rassurante et professionnelle.",
    timestamp: "Hier · 18:07",
    duration: "48s",
    mode: "reply",
    status: "synced",
  },
  {
    id: "session-3",
    title: "Idées roadmap desktop",
    preview:
      "Palette de commandes, overlay micro, mode confidentiel et actions agentiques.",
    timestamp: "Lun. · 14:16",
    duration: "3m 04s",
    mode: "task_creation",
    status: "draft",
  },
];

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

const useDesktopStore = create<DesktopState>((set) => ({
  commandOpen: false,
  recordingState: "idle",
  activeView: "today",
  privacyLevel: "local",
  activeSessionId: sessions[0]?.id ?? "session-1",
  transcript: initialTranscript,
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleRecording: () =>
    set((state) => ({
      recordingState:
        state.recordingState === "recording" ? "processing" : "recording",
    })),
  finishProcessing: () => set({ recordingState: "idle" }),
  setActiveView: (view) => set({ activeView: view }),
  setPrivacyLevel: (level) => set({ privacyLevel: level }),
  setActiveSession: (sessionId, transcript) =>
    set({ activeSessionId: sessionId, transcript }),
  setTranscript: (value) => set({ transcript: value }),
}));

function App() {
  const commandOpen = useDesktopStore((state) => state.commandOpen);
  const recordingState = useDesktopStore((state) => state.recordingState);
  const setCommandOpen = useDesktopStore((state) => state.setCommandOpen);
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);
  const finishProcessing = useDesktopStore((state) => state.finishProcessing);

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

  useEffect(() => {
    if (recordingState !== "processing") return;
    const timer = window.setTimeout(finishProcessing, 1200);
    return () => window.clearTimeout(timer);
  }, [finishProcessing, recordingState]);

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
  const setActiveView = useDesktopStore((state) => state.setActiveView);
  const setActiveSession = useDesktopStore((state) => state.setActiveSession);

  const navItems: Array<{ id: ViewId; label: string; count?: number }> = [
    { id: "today", label: "Aujourd’hui", count: 4 },
    { id: "history", label: "Historique", count: 28 },
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
        <div className="section-title">Dernières dictées</div>
        {sessions.map((session) => (
          <button
            className={
              activeSessionId === session.id
                ? "history-card selected"
                : "history-card"
            }
            key={session.id}
            onClick={() => {
              setActiveView("history");
              setActiveSession(
                session.id,
                `${session.preview}\n\nAction proposée : ${session.title}.`,
              );
            }}
            type="button"
          >
            <span className="history-title">{session.title}</span>
            <span className="history-meta">
              {session.timestamp} · {session.duration}
            </span>
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
          {privacyLevel === "local" ? "Local-first" : "Cloud assisté"}
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
  const setTranscript = useDesktopStore((state) => state.setTranscript);
  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript],
  );

  return (
    <section className="editor-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Transcription éditable</p>
          <h3>Brief vocal enrichi</h3>
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
  const toggleRecording = useDesktopStore((state) => state.toggleRecording);

  if (recordingState === "idle") return null;

  return (
    <div
      className="recorder-overlay"
      role="dialog"
      aria-label="Enregistreur vocal Sonolect"
    >
      <div className="recorder-card">
        <div className="mic-orb" />
        <div>
          <p className="eyebrow">
            {recordingState === "recording" ? "Écoute active" : "Traitement"}
          </p>
          <h3>
            {recordingState === "recording"
              ? "Parlez, Sonolect structure vos idées"
              : "Transcription en cours…"}
          </h3>
        </div>
        <Waveform active={recordingState === "recording"} />
        <button
          className="primary-button"
          onClick={toggleRecording}
          type="button"
        >
          {recordingState === "recording" ? "Terminer la capture" : "Reprendre"}
        </button>
      </div>
    </div>
  );
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
