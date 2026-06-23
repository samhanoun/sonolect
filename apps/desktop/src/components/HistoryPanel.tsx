import { useMemo, useState } from "react";
import { Search, Clock, Mic } from "lucide-react";
import { useDesktopStore } from "../store/appStore";

function formatTime(updatedAt: string, fallback: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Dictation history (home) screen, ported to the migrated Tailwind design and
 * bound to the desktop store's TranscriptSession history. Clicking an entry
 * opens it in the transcript detail view.
 */
export default function HistoryPanel() {
  const history = useDesktopStore((s) => s.transcriptHistory);
  const source = useDesktopStore((s) => s.transcriptHistorySource);
  const loading = useDesktopStore((s) => s.transcriptHistoryLoading);
  const error = useDesktopStore((s) => s.transcriptHistoryError);
  const selectTranscriptSession = useDesktopStore(
    (s) => s.selectTranscriptSession,
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((item) =>
      [item.title, item.preview, item.transcript]
        .filter(Boolean)
        .some((text) => text.toLowerCase().includes(q)),
    );
  }, [history, query]);

  return (
    <div
      className="flex-1 p-10 bg-[#0A0A0A] text-[#F0F0F0] flex flex-col h-full overflow-y-auto artistic-aura"
      id="history-panel"
    >
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8 pb-6 border-b border-white/5 relative z-10">
        <div>
          <h2 className="text-3xl font-light text-white tracking-tight">
            Dictation{" "}
            <span className="text-slate-500 italic font-serif">History</span>
          </h2>
          <p className="text-[11px] uppercase tracking-widest text-slate-500 mt-1.5">
            Browse and reopen your captured and polished dictation streams
            {source === "api" ? " · synced" : " · offline"}
          </p>
        </div>
      </div>

      <div className="relative mb-8 z-10">
        <Search className="absolute left-4 top-3.5 w-4 h-4 text-slate-600" />
        <input
          type="text"
          id="history-search-input"
          placeholder="Search transcripts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-[#0E0E0E] border border-white/5 rounded-xl pl-11 pr-4 py-3 text-xs focus:outline-none focus:border-white/20 text-[#F0F0F0] placeholder-slate-500 transition-all"
        />
      </div>

      {loading && (
        <p className="text-xs text-slate-500 relative z-10">Loading history…</p>
      )}
      {error && (
        <p className="text-xs text-red-400 relative z-10" role="status">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div
          className="flex-grow flex flex-col items-center justify-center p-16 border border-white/5 bg-[#0E0E0E]/40 rounded-2xl relative z-10"
          id="history-empty"
        >
          <Mic className="w-10 h-10 text-slate-800 mb-4" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            No dictations yet
          </p>
          <p className="text-xs text-slate-500 mt-2 italic font-serif">
            Press the push-to-talk hotkey to capture your first dictation.
          </p>
        </div>
      ) : (
        <div className="space-y-4 relative z-10" id="history-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              id={`history-card-${item.id}`}
              onClick={() => void selectTranscriptSession(item.id)}
              className="w-full text-left bg-[#0E0E0E]/90 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all duration-300"
            >
              <div className="flex items-center space-x-3 mb-3">
                <span className="text-[10px] text-slate-500 font-mono">
                  {formatTime(item.updatedAt, item.timestamp)}
                </span>
                {item.status && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-white/10" />
                    <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 bg-cyan-950/20 border border-cyan-900/40 px-2.5 py-0.5 rounded font-bold">
                      {item.status}
                    </span>
                  </>
                )}
              </div>
              <p className="text-sm text-white leading-relaxed font-sans">
                {item.title}
              </p>
              {item.preview && (
                <p className="text-xs text-slate-400 italic font-serif leading-relaxed mt-1.5">
                  {item.preview}
                </p>
              )}
              <div className="flex items-center space-x-4 text-[10px] text-slate-500 font-mono mt-3">
                <span className="flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{item.duration}</span>
                </span>
                {item.metadata && <span>{item.metadata}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
