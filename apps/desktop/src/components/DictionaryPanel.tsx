import { useState, type FormEvent } from "react";
import { Plus, BookOpen, Trash2, ArrowRight } from "lucide-react";
import { useDesktopStore } from "../store/appStore";

/**
 * Personal dictionary panel, ported from the Sonolect UI prototype and bound to
 * the desktop Zustand store. The store models entries as { spoken, replacement }.
 */
export default function DictionaryPanel() {
  const dictionary = useDesktopStore((state) => state.dictionaryEntries);
  const addDictionaryEntry = useDesktopStore(
    (state) => state.addDictionaryEntry,
  );
  const removeDictionaryEntry = useDesktopStore(
    (state) => state.removeDictionaryEntry,
  );
  const [spoken, setSpoken] = useState("");
  const [written, setWritten] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleAddNewWord = (event: FormEvent) => {
    event.preventDefault();
    if (!spoken.trim() || !written.trim()) {
      setErrorMsg("Please fill out both fields.");
      return;
    }
    const alreadyExists = dictionary.some(
      (entry) => entry.spoken.toLowerCase() === spoken.trim().toLowerCase(),
    );
    if (alreadyExists) {
      setErrorMsg(`"${spoken}" is already mapped in your dictionary.`);
      return;
    }

    addDictionaryEntry(spoken.trim(), written.trim());
    setSpoken("");
    setWritten("");
    setErrorMsg("");
  };

  return (
    <div
      className="flex-1 p-10 bg-[#0A0A0A] text-[#F0F0F0] flex flex-col h-full overflow-y-auto artistic-aura"
      id="dictionary-panel"
    >
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div
        className="mb-10 pb-6 border-b border-white/5 relative z-10"
        id="dictionary-header"
      >
        <h2 className="text-3xl font-light text-white tracking-tight">
          Personal{" "}
          <span className="text-slate-500 italic font-serif">Dictionary</span>
        </h2>
        <p className="text-[11px] uppercase tracking-widest text-slate-500 mt-1.5">
          Add replacements for acronyms, specific jargon, names, or brand items
          to preserve spelling accuracy.
        </p>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10"
        id="dictionary-grid"
      >
        <div
          className="lg:col-span-1 bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 h-fit space-y-5"
          id="dictionary-add-form"
        >
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            Add Spelled-Term Trigger
          </h3>
          <form onSubmit={handleAddNewWord} className="space-y-5">
            <div>
              <label
                htmlFor="spoken-input"
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2"
              >
                How you speak it (spoken)
              </label>
              <input
                type="text"
                id="spoken-input"
                value={spoken}
                onChange={(event) => setSpoken(event.target.value)}
                placeholder="e.g. gcp"
                className="w-full bg-[#0E0E0E] border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 transition-all font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="written-input"
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2"
              >
                How it should write (written)
              </label>
              <input
                type="text"
                id="written-input"
                value={written}
                onChange={(event) => setWritten(event.target.value)}
                placeholder="e.g. Google Cloud Platform"
                className="w-full bg-[#0E0E0E] border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
              />
            </div>

            {errorMsg && (
              <p
                className="text-[10px] font-medium text-red-400"
                id="dictionary-error"
              >
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              id="submit-dictionary-entry"
              className="w-full py-3 bg-white hover:bg-slate-200 text-black font-bold text-[10px] uppercase tracking-widest rounded-xl shadow transition-all flex items-center justify-center space-x-2"
            >
              <Plus className="w-4 h-4 text-black" />
              <span>Add to Dictionary</span>
            </button>
          </form>
        </div>

        <div
          className="lg:col-span-2 flex flex-col space-y-5"
          id="dictionary-list-container"
        >
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            Vocabulary Entries
          </h3>

          {dictionary.length === 0 ? (
            <div
              className="bg-[#0E0E0E]/40 border border-dashed border-white/5 rounded-2xl p-16 text-center flex-1 flex flex-col items-center justify-center"
              id="dictionary-empty"
            >
              <BookOpen className="w-10 h-10 text-slate-800 mb-3" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                Your Dictionary is Empty
              </p>
              <p className="text-[11px] text-slate-500 italic font-serif mt-2">
                New words added on the left will always maintain spelling during
                AI Polishing.
              </p>
            </div>
          ) : (
            <div
              className="bg-[#0C0C0C]/80 border border-white/5 rounded-2xl overflow-hidden divide-y divide-white/5"
              id="dictionary-table"
            >
              {dictionary.map((entry) => (
                <div
                  key={entry.id}
                  id={`dictionary-row-${entry.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors duration-300 text-left"
                >
                  <div
                    className="flex items-center space-x-4 flex-1 pr-4 min-w-0"
                    id={`dict-entry-meta-${entry.id}`}
                  >
                    <span className="font-mono text-xs text-slate-300 truncate bg-[#0E0E0E] px-3 py-1.5 border border-white/5 rounded-lg">
                      "{entry.spoken}"
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-700 flex-shrink-0" />
                    <span className="text-xs font-semibold text-white truncate">
                      {entry.replacement}
                    </span>
                  </div>
                  <button
                    id={`dict-delete-btn-${entry.id}`}
                    onClick={() => removeDictionaryEntry(entry.id)}
                    className="p-1 px-3 border border-white/5 hover:border-red-900/40 text-slate-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-all"
                    type="button"
                    aria-label={`Remove dictionary entry ${entry.spoken}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
