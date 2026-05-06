import React, { useState, useMemo } from "react";
import type { Snippet } from "./wisprWorkflow";
import {
  searchSnippets,
  importSnippets,
  exportSnippets,
} from "./snippetCrud";

export type SnippetViewProps = {
  snippets: Snippet[];
  onAdd: (trigger: string, body: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Omit<Snippet, "id">>) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export function SnippetView({
  snippets,
  onAdd,
  onRemove,
  onUpdate,
  searchQuery,
  onSearchChange,
}: SnippetViewProps) {
  const [trigger, setTrigger] = useState("");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTrigger, setEditTrigger] = useState("");
  const [editBody, setEditBody] = useState("");

  const filtered = useMemo(
    () => searchSnippets(snippets, searchQuery),
    [snippets, searchQuery],
  );

  function handleAdd() {
    if (!trigger.trim() || !body.trim()) return;
    onAdd(trigger, body);
    setTrigger("");
    setBody("");
  }

  function startEdit(snippet: Snippet) {
    setEditingId(snippet.id);
    setEditTrigger(snippet.trigger);
    setEditBody(snippet.body);
  }

  function commitEdit(id: string) {
    onUpdate(id, { trigger: editTrigger, body: editBody });
    setEditingId(null);
  }

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const csv = reader.result as string;
        const imported = importSnippets(csv);
        for (const s of imported) {
          onAdd(s.trigger, s.body);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleExport() {
    const csv = exportSnippets(snippets);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sonolect-snippets.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="glass-card management-panel">
      <p className="section-title">Snippet library</p>
      <h3>Expand voice shortcuts while dictating</h3>
      <p>
        Say or type a trigger like /sig and Sonolect expands it in the polished
        preview.
      </p>

      <input
        className="search-input"
        type="text"
        placeholder="Search snippets…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search snippets"
      />

      <div className="form-grid two">
        <label>
          <span>Trigger</span>
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="/sig"
          />
        </label>
        <label>
          <span>Expansion</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Best, Ismail"
            rows={2}
          />
        </label>
      </div>
      <button
        className="primary-button compact"
        onClick={handleAdd}
        type="button"
      >
        Add snippet
      </button>

      <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
        <button
          className="ghost-button"
          onClick={handleImport}
          type="button"
        >
          Import CSV
        </button>
        <button
          className="ghost-button"
          onClick={handleExport}
          disabled={snippets.length === 0}
          type="button"
        >
          Export CSV
        </button>
        <span className="editor-meta">
          {snippets.length} {snippets.length === 1 ? "snippet" : "snippets"}
        </span>
      </div>

      <div className="preference-list">
        {filtered.length === 0 ? (
          <p className="editor-meta">
            {snippets.length === 0
              ? "No snippets yet."
              : "No snippets match your search."}
          </p>
        ) : null}
        {filtered.map((snippet) => (
          <article className="preference-row" key={snippet.id}>
            {editingId === snippet.id ? (
              <div style={{ flex: 1 }}>
                <div className="form-grid two">
                  <input
                    value={editTrigger}
                    onChange={(e) => setEditTrigger(e.target.value)}
                    aria-label="Edit trigger"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    aria-label="Edit body"
                    rows={2}
                  />
                </div>
                <div className="inline-actions">
                  <button
                    className="ghost-button"
                    onClick={() => commitEdit(snippet.id)}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => setEditingId(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  onClick={() => startEdit(snippet)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startEdit(snippet);
                  }}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                >
                  <strong>{snippet.trigger}</strong>
                  <p className="editor-meta" style={{ maxWidth: "24ch", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {snippet.body}
                  </p>
                </div>
                <button
                  aria-label={`Remove snippet ${snippet.trigger}`}
                  className="ghost-button"
                  onClick={() => onRemove(snippet.id)}
                  type="button"
                >
                  Remove
                </button>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
