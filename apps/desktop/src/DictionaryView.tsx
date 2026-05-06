import React, { useState, useMemo } from "react";
import type { DictionaryEntry } from "./wisprWorkflow";
import {
  searchDictionary,
  importDictionary,
  exportDictionary,
} from "./dictionaryCrud";

export type DictionaryViewProps = {
  entries: DictionaryEntry[];
  onAdd: (spoken: string, replacement: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    updates: Partial<Omit<DictionaryEntry, "id">>,
  ) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export function DictionaryView({
  entries,
  onAdd,
  onRemove,
  onUpdate,
  searchQuery,
  onSearchChange,
}: DictionaryViewProps) {
  const [spoken, setSpoken] = useState("");
  const [replacement, setReplacement] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSpoken, setEditSpoken] = useState("");
  const [editReplacement, setEditReplacement] = useState("");

  const filtered = useMemo(
    () => searchDictionary(entries, searchQuery),
    [entries, searchQuery],
  );

  function handleAdd() {
    if (!spoken.trim() || !replacement.trim()) return;
    onAdd(spoken, replacement);
    setSpoken("");
    setReplacement("");
  }

  function startEdit(entry: DictionaryEntry) {
    setEditingId(entry.id);
    setEditSpoken(entry.spoken);
    setEditReplacement(entry.replacement);
  }

  function commitEdit(id: string) {
    onUpdate(id, { spoken: editSpoken, replacement: editReplacement });
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
        const imported = importDictionary(csv);
        for (const entry of imported) {
          onAdd(entry.spoken, entry.replacement);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function handleExport() {
    const csv = exportDictionary(entries);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sonolect-dictionary.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <section className="glass-card management-panel">
      <p className="section-title">Personal dictionary</p>
      <h3>Teach Sonolect names, products, and spellings</h3>
      <p>
        These replacements are applied during the Wispr-style polished preview
        before you copy text into another app.
      </p>

      <input
        className="search-input"
        type="text"
        placeholder="Search dictionary entries…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search dictionary"
      />

      <div className="form-grid two">
        <label>
          <span>When I say</span>
          <input
            value={spoken}
            onChange={(e) => setSpoken(e.target.value)}
            placeholder="open claw"
          />
        </label>
        <label>
          <span>Write</span>
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="OpenClaw"
          />
        </label>
      </div>
      <button
        className="primary-button compact"
        onClick={handleAdd}
        type="button"
      >
        Add dictionary entry
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
          disabled={entries.length === 0}
          type="button"
        >
          Export CSV
        </button>
        <span className="editor-meta">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="preference-list">
        {filtered.length === 0 ? (
          <p className="editor-meta">
            {entries.length === 0
              ? "No dictionary entries yet."
              : "No entries match your search."}
          </p>
        ) : null}
        {filtered.map((entry) => (
          <article className="preference-row" key={entry.id}>
            {editingId === entry.id ? (
              <div className="form-grid two" style={{ flex: 1 }}>
                <input
                  value={editSpoken}
                  onChange={(e) => setEditSpoken(e.target.value)}
                  aria-label="Edit spoken form"
                />
                <input
                  value={editReplacement}
                  onChange={(e) => setEditReplacement(e.target.value)}
                  aria-label="Edit replacement"
                />
                <button
                  className="ghost-button"
                  onClick={() => commitEdit(entry.id)}
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
            ) : (
              <>
                <div
                  onClick={() => startEdit(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startEdit(entry);
                  }}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                >
                  <strong>{entry.spoken}</strong>
                  <p>{entry.replacement}</p>
                </div>
                <button
                  aria-label={`Remove dictionary entry ${entry.spoken}`}
                  className="ghost-button"
                  onClick={() => onRemove(entry.id)}
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
