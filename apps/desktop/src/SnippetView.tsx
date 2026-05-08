import React, { useState, useMemo } from "react";
import type { Snippet } from "./wisprWorkflow";
import { searchSnippets, importSnippets, exportSnippets } from "./snippetCrud";
import { useT } from "./i18n";

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

  const t = useT();

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
    <section
      className="glass-card management-panel"
      aria-labelledby="snippets-heading"
    >
      <p className="section-title">{t("snippets.sectionTitle")}</p>
      <h3 id="snippets-heading">{t("snippets.subtitle")}</h3>
      <p>{t("snippets.description")}</p>

      <div role="search" aria-label={t("snippets.searchAriaLabel")}>
        <input
          className="search-input"
          type="text"
          placeholder={t("snippets.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label={t("snippets.searchAriaLabel")}
        />
      </div>

      <div className="form-grid two">
        <label>
          <span>{t("snippets.trigger")}</span>
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            placeholder="/sig"
          />
        </label>
        <label>
          <span>{t("snippets.expansion")}</span>
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
        {t("snippets.addSnippet")}
      </button>

      <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
        <button className="ghost-button" onClick={handleImport} type="button">
          {t("snippets.importCsv")}
        </button>
        <button
          className="ghost-button"
          onClick={handleExport}
          disabled={snippets.length === 0}
          type="button"
        >
          {t("snippets.exportCsv")}
        </button>
        <span className="editor-meta">
          {snippets.length}{" "}
          {snippets.length === 1
            ? t("snippets.snippetCountSingular")
            : t("snippets.snippetCountPlural")}
        </span>
      </div>

      <div
        className="preference-list"
        role="list"
        aria-label={t("snippets.sectionTitle")}
      >
        {filtered.length === 0 ? (
          <p className="editor-meta" role="status" aria-live="polite">
            {snippets.length === 0
              ? t("snippets.emptyState")
              : t("snippets.noMatch")}
          </p>
        ) : null}
        {filtered.map((snippet) => (
          <article className="preference-row" key={snippet.id} role="listitem">
            {editingId === snippet.id ? (
              <div style={{ flex: 1 }}>
                <div className="form-grid two">
                  <input
                    value={editTrigger}
                    onChange={(e) => setEditTrigger(e.target.value)}
                    aria-label={t("snippets.editTriggerAriaLabel")}
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    aria-label={t("snippets.editBodyAriaLabel")}
                    rows={2}
                  />
                </div>
                <div className="inline-actions">
                  <button
                    className="ghost-button"
                    onClick={() => commitEdit(snippet.id)}
                    type="button"
                  >
                    {t("snippets.save")}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => setEditingId(null)}
                    type="button"
                  >
                    {t("snippets.cancel")}
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
                  <p
                    className="editor-meta"
                    style={{
                      maxWidth: "24ch",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {snippet.body}
                  </p>
                </div>
                <button
                  aria-label={`${t("snippets.remove")} ${snippet.trigger}`}
                  className="ghost-button"
                  onClick={() => onRemove(snippet.id)}
                  type="button"
                >
                  {t("snippets.remove")}
                </button>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
