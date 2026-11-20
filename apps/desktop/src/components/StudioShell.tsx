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
import { useT, type LocaleKeys } from "../i18n";
import { isTauriRuntime } from "../desktopNative";
import { formatTimestamp } from "../lib/format";
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

type NavigationGroup = "workspace" | "personalize";
const navigation: {
  id: ViewId;
  label: LocaleKeys;
  Icon: typeof Mic;
  group: NavigationGroup;
}[] = [
  {
    id: "home",
    label: "studio.nav.home",
    Icon: LayoutDashboard,
    group: "workspace",
  },
  {
    id: "transcribe",
    label: "studio.nav.transcribe",
    Icon: AudioLines,
    group: "workspace",
  },
  {
    id: "speech",
    label: "studio.nav.speech",
    Icon: Volume2,
    group: "workspace",
  },
  {
    id: "library",
    label: "studio.nav.library",
    Icon: Folder,
    group: "workspace",
  },
  {
    id: "dictionary",
    label: "studio.nav.dictionary",
    Icon: BookOpen,
    group: "personalize",
  },
  {
    id: "snippets",
    label: "studio.nav.snippets",
    Icon: Quote,
    group: "personalize",
  },
  {
    id: "models",
    label: "studio.nav.models",
    Icon: SlidersHorizontal,
    group: "personalize",
  },
  {
    id: "settings",
    label: "studio.nav.settings",
    Icon: Settings2,
    group: "personalize",
  },
];
const navigationGroups: { id: NavigationGroup; label: LocaleKeys }[] = [
  { id: "workspace", label: "studio.group.workspace" },
  { id: "personalize", label: "studio.group.personalize" },
];
function QuickNavigation() {
  const { commandOpen, setCommandOpen, setActiveView } = useDesktopStore();
  const t = useT();
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const needle = query.trim().toLocaleLowerCase(t.locale);
  const matches = navigation.filter((item) =>
    t(item.label).toLocaleLowerCase(t.locale).includes(needle),
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
      aria-label={t("studio.quickNav.label")}
      ref={dialog}
      className="studio-command"
      onCancel={() => setCommandOpen(false)}
    >
      <div>
        <Search size={19} />
        <input
          aria-label={t("studio.quickNav.find")}
          placeholder={t("studio.quickNav.placeholder")}
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
          aria-label={t("studio.quickNav.close")}
          onClick={() => setCommandOpen(false)}
        >
          <X size={17} />
        </button>
      </div>
      <nav>
        {matches.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => go(id)}>
            <Icon size={18} />
            {t(label)}
            <span>↵</span>
          </button>
        ))}
        {!matches.length && (
          <p className="studio-command-empty">
            {t("studio.quickNav.empty", { query })}
          </p>
        )}
      </nav>
    </dialog>
  );
}
/** How long the current recording has run, ticking once a second. */
function useElapsedMs(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return elapsed;
}

/** The end of the live text: the dock has room for a line or two. */
function liveTail(text: string, max = 120) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const tail = trimmed.slice(-max);
  // Start at a word, not in the middle of one.
  return `…${tail.slice(tail.indexOf(" ") + 1)}`;
}

function RecordingDock() {
  const {
    recordingState,
    voiceError,
    liveTranscript,
    toggleRecording,
    resetVoiceCapture,
    captureSource,
    dictationSource,
  } = useDesktopStore();
  const t = useT();
  // Only a recording started here can take the computer's sound.
  const listening =
    captureSource === "system" && dictationSource === "app" && isTauriRuntime()
      ? "studio.dock.recordingSystem"
      : "studio.dock.listening";
  const elapsed = useElapsedMs(recordingState === "recording");
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
          ? `${t(listening)} ${formatTimestamp(elapsed)}`
          : processing
            ? t("studio.dock.processing")
            : recordingState === "error"
              ? t("studio.dock.error")
              : t("studio.dock.ready")}
        {voiceError && <small>{t.message(voiceError)}</small>}
        {liveTranscript && (recordingState === "recording" || processing) && (
          // Not announced: the dock is a status region and this changes
          // every few seconds. The finished transcript is what gets read.
          <small className="studio-dock-live" aria-hidden="true">
            {liveTail(liveTranscript)}
          </small>
        )}
      </span>
      <button
        onClick={
          recordingState === "recording"
            ? () => toggleRecording()
            : resetVoiceCapture
        }
        disabled={processing}
      >
        {recordingState === "recording"
          ? t("studio.dock.stop")
          : t("studio.dock.dismiss")}
      </button>
    </div>
  );
}
/**
 * Short notices from anywhere in the app: a failed shortcut registration,
 * a microphone that was replaced by the default one. The region is always
 * there, so a screen reader announces a notice when one appears.
 */
function StudioNotices() {
  const toasts = useDesktopStore((state) => state.toasts);
  const t = useT();
  return (
    <div className="studio-notices" role="status">
      {toasts.map((toast) => (
        <p key={toast.id}>{t.message(toast.message)}</p>
      ))}
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
  const t = useT();
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
          <small>{t("studio.brand.tagline")}</small>
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
          {recordingState === "recording"
            ? t("studio.dictation.stop")
            : t("studio.dictation.new")}
          <kbd>Ctrl ⇧ M</kbd>
        </button>
        {navigationGroups.map((group) => (
          <div className="studio-nav-group" key={group.id}>
            <p>{t(group.label)}</p>
            <nav aria-label={t(group.label)}>
              {navigation
                .filter((item) => item.group === group.id)
                .map(({ id, label, Icon }) => (
                  <button
                    className={activeView === id ? "active" : ""}
                    key={id}
                    onClick={() => setActiveView(id)}
                  >
                    <Icon size={18} />
                    {t(label)}
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
              {privacyLevel === "local"
                ? t("studio.mode.localProcessing")
                : t("studio.mode.cloud")}
            </span>
            <p>
              {privacyLevel === "local"
                ? t("studio.mode.localHint")
                : t("studio.mode.cloudHint")}
            </p>
          </div>
          <p className="studio-version">
            {t("studio.version")} <span>v0.1</span>
          </p>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <div>
            {t("studio.group.workspace")} <span>/</span>
            <strong>
              {t(
                navigation.find((item) => item.id === activeView)?.label ??
                  "studio.nav.settings",
              )}
            </strong>
          </div>
          <div className="studio-topbar-actions">
            <label className="studio-mode-control">
              <ShieldCheck size={16} />
              <select
                aria-label={t("studio.mode.label")}
                value={privacyLevel}
                onChange={(event) =>
                  setPrivacyLevel(event.target.value as "local" | "cloud")
                }
              >
                <option value="local">{t("studio.mode.local")}</option>
                <option value="cloud">{t("studio.mode.cloud")}</option>
              </select>
            </label>
            <button
              className="studio-search-button"
              onClick={() => setCommandOpen(true)}
              aria-label={t("studio.topbar.search")}
            >
              <Search size={17} />
              <kbd>Ctrl K</kbd>
            </button>
          </div>
        </header>
        {pages[activeView] || pages.home}
      </main>
      <RecordingDock />
      <StudioNotices />
      <QuickNavigation />
    </div>
  );
}
