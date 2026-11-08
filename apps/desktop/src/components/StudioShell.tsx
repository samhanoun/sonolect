import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  BookOpen,
  Command,
  FileAudio,
  Folder,
  LayoutDashboard,
  Mic,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  Quote,
  X,
} from "lucide-react";
import { useDesktopStore, type ViewId } from "../store/appStore";
import { useProviderStore, setProviderMode } from "../providerSettings";
import StudioModels from "./StudioModels";
import {
  StudioOverview,
  StudioTranscribe,
  StudioSpeech,
  StudioLibrary,
  StudioVocabulary,
  StudioSettings,
  useSavedCaptures,
} from "./StudioWorkbench";
import "../studio.css";
import "../studio-night.css";

const navigation: {
  id: ViewId;
  label: string;
  Icon: typeof Mic;
  group: string;
}[] = [
  { id: "home", label: "Overview", Icon: LayoutDashboard, group: "Workspace" },
  {
    id: "transcribe",
    label: "Transcribe",
    Icon: AudioLines,
    group: "Workspace",
  },
  { id: "speech", label: "Text to speech", Icon: Volume2, group: "Workspace" },
  { id: "library", label: "Library", Icon: Folder, group: "Workspace" },
  {
    id: "dictionary",
    label: "Dictionary",
    Icon: BookOpen,
    group: "Personalize",
  },
  { id: "snippets", label: "Snippets", Icon: Quote, group: "Personalize" },
  {
    id: "models",
    label: "Models & voices",
    Icon: SlidersHorizontal,
    group: "Personalize",
  },
  { id: "settings", label: "Settings", Icon: Settings2, group: "Personalize" },
];
function QuickNavigation() {
  const { commandOpen, setCommandOpen, setActiveView } = useDesktopStore();
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const matches = navigation.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const go = (id: ViewId) => {
    setActiveView(id);
    setCommandOpen(false);
  };
  useEffect(() => {
    if (commandOpen) {
      setQuery("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [commandOpen]);
  return (
    <dialog
      aria-label="Quick navigation"
      ref={dialog}
      className="studio-command"
      onCancel={() => setCommandOpen(false)}
    >
      <div>
        <Search size={19} />
        <input
          aria-label="Find a page"
          placeholder="Where would you like to go?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              go(matches[0].id);
            }
          }}
        />
        <button
          className="studio-icon-button"
          aria-label="Close navigation"
          onClick={() => setCommandOpen(false)}
        >
          <X size={17} />
        </button>
      </div>
      <nav>
        {matches.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => go(id)}>
            <Icon size={18} />
            {label}
            <span>↵</span>
          </button>
        ))}
        {!matches.length && (
          <p className="studio-command-empty">No page matches “{query}”.</p>
        )}
      </nav>
    </dialog>
  );
}
function RecordingDock() {
  const { recordingState, voiceError, toggleRecording, resetVoiceCapture } =
    useDesktopStore();
  if (recordingState === "idle") return null;
  const processing =
    recordingState === "uploading" ||
    recordingState === "requesting-permission";
  return (
    <div className="studio-recording-dock" role="status">
      <span
        className={`studio-live-dot ${recordingState === "recording" ? "live" : ""}`}
      />
      <AudioLines size={24} />
      <span>
        {recordingState === "recording"
          ? "Listening…"
          : processing
            ? "Processing…"
            : recordingState === "error"
              ? "Recording needs attention"
              : "Your words are ready"}
        {voiceError && <small>{voiceError}</small>}
      </span>
      <button
        onClick={
          recordingState === "recording" ? toggleRecording : resetVoiceCapture
        }
        disabled={processing}
      >
        {recordingState === "recording" ? "Stop" : "Dismiss"}
      </button>
    </div>
  );
}
export default function StudioShell() {
  const {
    activeView,
    setActiveView,
    privacyLevel,
    setPrivacyLevel,
    setCommandOpen,
    toggleRecording,
    recordingState,
  } = useDesktopStore();
  const { captures, refresh, error } = useSavedCaptures();
  const refreshKeyStatus = useProviderStore((s) => s.refreshKeyStatus);
  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);
  useEffect(() => {
    void setProviderMode(privacyLevel === "cloud").catch(() => undefined);
  }, [privacyLevel]);
  const pages: Partial<Record<ViewId, React.ReactNode>> = {
    home: <StudioOverview captures={captures} />,
    transcribe: <StudioTranscribe onSaved={refresh} />,
    speech: <StudioSpeech />,
    library: (
      <StudioLibrary captures={captures} refresh={refresh} error={error} />
    ),
    dictionary: <StudioVocabulary />,
    snippets: <StudioVocabulary snippets />,
    models: <StudioModels />,
    settings: <StudioSettings />,
    onboarding: <StudioSettings />,
  };
  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <div className="studio-brand">
          sonolect<span>.</span>
          <small>Voice workspace</small>
        </div>
        <button
          className="studio-new-recording"
          onClick={() => {
            setActiveView("transcribe");
            toggleRecording();
          }}
          disabled={recordingState === "uploading"}
        >
          <Mic size={18} />
          {recordingState === "recording" ? "Stop dictation" : "New dictation"}
          <kbd>Ctrl ⇧ M</kbd>
        </button>
        {["Workspace", "Personalize"].map((group) => (
          <div className="studio-nav-group" key={group}>
            <p>{group}</p>
            <nav aria-label={group}>
              {navigation
                .filter((item) => item.group === group)
                .map(({ id, label, Icon }) => (
                  <button
                    className={activeView === id ? "active" : ""}
                    key={id}
                    onClick={() => setActiveView(id)}
                  >
                    <Icon size={18} />
                    {label}
                    {activeView === id && <span>•</span>}
                  </button>
                ))}
            </nav>
          </div>
        ))}
        <div className="studio-sidebar-bottom">
          <div className="studio-sidebar-policy">
            <span>
              <i />
              {privacyLevel === "local" ? "Local processing" : "Cloud enabled"}
            </span>
            <p>
              {privacyLevel === "local"
                ? "Your recordings stay on this device unless you choose online processing."
                : "Online requests use your selected provider and API key."}
            </p>
          </div>
          <p className="studio-version">
            Windows workspace <span>v0.1</span>
          </p>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <div>
            Workspace <span>/</span>
            <strong>
              {navigation.find((item) => item.id === activeView)?.label ||
                "Settings"}
            </strong>
          </div>
          <div className="studio-topbar-actions">
            <label className="studio-mode-control">
              <ShieldCheck size={16} />
              <select
                aria-label="Processing mode"
                value={privacyLevel}
                onChange={(event) =>
                  setPrivacyLevel(event.target.value as "local" | "cloud")
                }
              >
                <option value="local">Local only</option>
                <option value="cloud">Cloud enabled</option>
              </select>
            </label>
            <button
              className="studio-search-button"
              onClick={() => setCommandOpen(true)}
              aria-label="Search pages"
            >
              <Search size={17} />
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>
        {pages[activeView] || pages.home}
      </main>
      <RecordingDock />
      <QuickNavigation />
    </div>
  );
}
