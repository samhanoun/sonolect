import {
  Mic,
  Home,
  Sparkles,
  BookOpen,
  FileText,
  Book,
  Users,
  Settings,
} from "lucide-react";
import { useDesktopStore, type ViewId } from "../store/appStore";

const NAV: Array<{ id: ViewId; label: string; Icon: typeof Home }> = [
  { id: "home", label: "History", Icon: Home },
  { id: "onboarding", label: "Setup", Icon: Sparkles },
  { id: "dictionary", label: "Dictionary", Icon: BookOpen },
  { id: "snippets", label: "Snippets", Icon: FileText },
  { id: "reader", label: "Reader", Icon: Book },
  { id: "team", label: "Team", Icon: Users },
  { id: "settings", label: "Settings", Icon: Settings },
];

/**
 * Primary navigation sidebar in the migrated Tailwind design. Frames every
 * screen and owns the global record action; the history list lives in the main
 * area now, not here.
 */
export default function Sidebar() {
  const activeView = useDesktopStore((s) => s.activeView);
  const setActiveView = useDesktopStore((s) => s.setActiveView);
  const clearActiveSession = useDesktopStore((s) => s.clearActiveSession);
  const toggleRecording = useDesktopStore((s) => s.toggleRecording);
  const recordingState = useDesktopStore((s) => s.recordingState);

  const isRecording = recordingState === "recording";

  return (
    <aside
      className="w-64 shrink-0 h-full flex flex-col bg-[#080808] border-r border-white/5 p-5"
      id="sidebar-aside"
    >
      <div className="flex items-center gap-3 mb-8 px-1" id="brand-header">
        <div
          className="w-9 h-9 rounded-xl bg-white flex items-center justify-center"
          id="brand-logo-container"
        >
          <Mic className="w-4.5 h-4.5 text-black" id="mic-icon" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white" id="brand-title">
            Sonolect
          </p>
          <p
            className="text-[9px] uppercase tracking-[0.2em] text-slate-500"
            id="brand-os"
          >
            Voice OS
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleRecording}
        id="sidebar-record-cta"
        className={`mb-6 flex items-center justify-between gap-2 px-4 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all ${
          isRecording
            ? "bg-red-500 text-white hover:bg-red-600"
            : "bg-white text-black hover:bg-slate-200"
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${isRecording ? "bg-white animate-pulse" : "bg-black"}`}
          />
          {isRecording ? "Stop" : "Record"}
        </span>
        <span className="text-[9px] font-mono opacity-60">Ctrl+Shift+M</span>
      </button>

      <nav className="flex flex-col gap-1" aria-label="Main navigation">
        {NAV.map(({ id, label, Icon }) => {
          const active = activeView === id;
          return (
            <button
              key={id}
              type="button"
              id={`nav-item-${id}`}
              onClick={() => {
                setActiveView(id);
                if (id === "home") clearActiveSession();
              }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                active
                  ? "bg-white/5 border-white/10 text-white"
                  : "border-transparent text-slate-400 hover:text-white hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-5 border-t border-white/5" id="user-section">
        <p className="text-[10px] uppercase tracking-widest text-slate-600">
          Local session
        </p>
      </div>
    </aside>
  );
}
