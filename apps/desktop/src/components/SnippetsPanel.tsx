import { useState, type FormEvent } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { useDesktopStore } from "../store/appStore";

/**
 * Text snippets / voice shortcuts panel, ported from the Sonolect UI prototype
 * and bound to the desktop Zustand store ({ trigger, body }).
 */
export default function SnippetsPanel() {
  const snippets = useDesktopStore((state) => state.snippets);
  const addSnippet = useDesktopStore((state) => state.addSnippet);
  const removeSnippet = useDesktopStore((state) => state.removeSnippet);
  const [trigger, setTrigger] = useState("");
  const [body, setBody] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleAddNewSnippet = (event: FormEvent) => {
    event.preventDefault();
    if (!trigger.trim() || !body.trim()) {
      setErrorMsg("Please fill out both properties.");
      return;
    }
    const alreadyExists = snippets.some(
      (entry) => entry.trigger.toLowerCase() === trigger.trim().toLowerCase(),
    );
    if (alreadyExists) {
      setErrorMsg(`"${trigger}" trigger is already registered.`);
      return;
    }

    addSnippet(trigger.trim(), body.trim());
    setTrigger("");
    setBody("");
    setErrorMsg("");
  };

  return (
    <div
      className="flex-1 p-10 bg-[#0A0A0A] text-[#F0F0F0] flex flex-col h-full overflow-y-auto artistic-aura"
      id="snippets-panel"
    >
      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div
        className="mb-10 pb-6 border-b border-white/5 relative z-10"
        id="snippets-header"
      >
        <h2 className="text-3xl font-light text-white tracking-tight">
          Text{" "}
          <span className="text-slate-500 italic font-serif">
            Shortcuts &amp; Snippets
          </span>
        </h2>
        <p className="text-[11px] uppercase tracking-widest text-slate-500 mt-1.5">
          Save blocks of templated messages. Speaking the trigger phrase expands
          the entire formatted text block at once.
        </p>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10"
        id="snippets-grid"
      >
        <div
          className="lg:col-span-1 bg-[#0C0C0C] border border-white/5 rounded-2xl p-6 h-fit space-y-5"
          id="snippets-add-form"
        >
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            Add Voice Shortcut
          </h3>
          <form onSubmit={handleAddNewSnippet} className="space-y-5">
            <div>
              <label
                htmlFor="trigger-input"
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2"
              >
                Shortcut Trigger Phrase
              </label>
              <input
                type="text"
                id="trigger-input"
                value={trigger}
                onChange={(event) => setTrigger(event.target.value)}
                placeholder="e.g. insert bug template"
                className="w-full bg-[#0E0E0E] border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 transition-all font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="body-input"
                className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2"
              >
                Expanded Content Body
              </label>
              <textarea
                id="body-input"
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write the full formatted text block..."
                className="w-full bg-[#0E0E0E] border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
              />
            </div>

            {errorMsg && (
              <p
                className="text-[10px] font-medium text-red-400"
                id="snippets-error"
              >
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              id="submit-snippet-entry"
              className="w-full py-3 bg-white hover:bg-slate-200 text-black font-bold text-[10px] uppercase tracking-widest rounded-xl shadow transition-all flex items-center justify-center space-x-2"
            >
              <Plus className="w-4 h-4 text-black" />
              <span>Register Shortcut</span>
            </button>
          </form>
        </div>

        <div
          className="lg:col-span-2 flex flex-col space-y-5"
          id="snippets-list-container"
        >
          <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400">
            Active Shortcuts
          </h3>

          {snippets.length === 0 ? (
            <div
              className="bg-[#0E0E0E]/40 border border-dashed border-white/5 rounded-2xl p-16 text-center flex-1 flex flex-col items-center justify-center"
              id="snippets-empty"
            >
              <FileText className="w-10 h-10 text-slate-800 mb-3" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                No Snippets Registered
              </p>
              <p className="text-[11px] text-slate-500 italic font-serif mt-2">
                Trigger blocks configured on the left are instantly
                auto-expanded during your speak actions.
              </p>
            </div>
          ) : (
            <div className="space-y-5" id="snippets-list">
              {snippets.map((snip) => (
                <div
                  key={snip.id}
                  id={`snippets-card-${snip.id}`}
                  className="bg-[#0E0E0E] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all duration-300 flex items-start justify-between text-left"
                >
                  <div
                    className="min-w-0 flex-1 pr-6"
                    id={`snippet-meta-${snip.id}`}
                  >
                    <div className="flex items-center space-x-2.5 mb-3">
                      <span className="text-[9px] uppercase tracking-[0.2em] text-cyan-400 bg-cyan-950/20 border border-cyan-900/40 px-3 py-1 rounded font-bold">
                        {snip.trigger}
                      </span>
                    </div>
                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed bg-[#060606] p-4 rounded-xl border border-white/5">
                      {snip.body}
                    </pre>
                  </div>
                  <button
                    id={`snip-delete-btn-${snip.id}`}
                    onClick={() => removeSnippet(snip.id)}
                    className="p-1 px-3 border border-white/5 hover:border-red-900/40 text-slate-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-all"
                    type="button"
                    aria-label={`Remove snippet ${snip.trigger}`}
                  >
                    <Trash2 className="w-4 h-4" />
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
