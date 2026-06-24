import { useEffect, useRef, useState } from "react";
import { useDesktopStore } from "../store/appStore";

/** Ctrl+K command palette, ported to the migrated Tailwind design. */
export default function CommandPalette() {
  const setCommandOpen = useDesktopStore((s) => s.setCommandOpen);
  const setActiveView = useDesktopStore((s) => s.setActiveView);
  const clearActiveSession = useDesktopStore((s) => s.clearActiveSession);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands: Array<{ label: string; hint: string; action: () => void }> = [
    {
      label: "New voice capture",
      hint: "Start or stop dictation",
      action: () => useDesktopStore.getState().toggleRecording(),
    },
    {
      label: "Copy polished dictation",
      hint: "Clipboard fallback for the active app",
      action: () => void useDesktopStore.getState().insertPolishedDictation(),
    },
    {
      label: "Apply polished preview",
      hint: "Replace the raw transcript with cleaned text",
      action: () => useDesktopStore.getState().applyPolishedPreview(),
    },
    {
      label: "Open history",
      hint: "Recent dictations",
      action: () => {
        setActiveView("home");
        clearActiveSession();
      },
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
      label: "First-run setup",
      hint: "Mic, shortcuts, Whisper, privacy",
      action: () => setActiveView("onboarding"),
    },
    {
      label: "Open settings",
      hint: "Privacy, language, engine",
      action: () => setActiveView("settings"),
    },
  ];

  const q = search.trim().toLowerCase();
  const filtered = q
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q),
      )
    : commands;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => setCommandOpen(false)}
    >
      <section
        className="w-full max-w-xl bg-[#0C0C0C] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <span className="text-[10px] font-mono text-slate-500 border border-white/10 rounded px-1.5 py-0.5">
            ⌘K
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search commands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No matching commands
            </p>
          ) : (
            filtered.map((command) => (
              <button
                key={command.label}
                type="button"
                onClick={() => {
                  command.action();
                  setCommandOpen(false);
                }}
                className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-sm text-white">{command.label}</span>
                <span className="text-[11px] text-slate-500">
                  {command.hint}
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
