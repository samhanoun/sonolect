import React, { useState, useMemo } from "react";
import type { TranscriptHistoryRow } from "./transcriptHistory";
import {
  searchTranscripts,
  filterHistory,
  highlightMatches,
  sortResults,
  type SearchResult,
  type HistoryFilter,
} from "./searchAndFilter";
import { useT } from "./i18n";

export type SearchPanelProps = {
  history: TranscriptHistoryRow[];
  onSelectResult: (id: string) => void;
};

export function SearchPanel({ history, onSelectResult }: SearchPanelProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"relevance" | "date" | "duration">(
    "relevance",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minDurationMin, setMinDurationMin] = useState("");

  const filter: HistoryFilter = useMemo(() => {
    const f: HistoryFilter = {};
    const q = query.trim();
    if (q) f.query = q;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    if (minDurationMin) {
      const parsed = parseInt(minDurationMin, 10);
      if (!Number.isNaN(parsed) && parsed > 0)
        f.minDuration = parsed * 60 * 1000;
    }
    return f;
  }, [query, dateFrom, dateTo, minDurationMin]);

  const filteredHistory = useMemo(
    () => filterHistory(history, filter),
    [history, filter],
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return sortResults(searchTranscripts(filteredHistory, query), sortBy);
  }, [filteredHistory, query, sortBy]);

  const hasQuery = query.trim().length > 0;

  return (
    <section className="glass-card management-panel" aria-labelledby="search-heading">
      <p className="section-title">{t("search.sectionTitle")}</p>
      <h3 id="search-heading">{t("search.subtitle")}</h3>

      <div role="search" aria-label={t("search.ariaLabel")}>
        <input
          className="search-input"
          type="text"
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("search.ariaLabel")}
          autoFocus
        />
      </div>

      <div className="form-grid two" style={{ marginTop: "0.75rem" }}>
        <label>
          <span>{t("search.fromDate")}</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label>
          <span>{t("search.toDate")}</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
      </div>
      <div className="form-grid two" style={{ marginTop: "0.5rem" }}>
        <label>
          <span>{t("search.minDuration")}</span>
          <input
            type="number"
            min="0"
            value={minDurationMin}
            onChange={(e) => setMinDurationMin(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          <span>{t("search.sortBy")}</span>
          <select
            className="ghost-button"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "relevance" | "date" | "duration")
            }
          >
            <option value="relevance">{t("search.sortRelevance")}</option>
            <option value="date">{t("search.sortDate")}</option>
            <option value="duration">{t("search.sortDuration")}</option>
          </select>
        </label>
      </div>

      <div className="preference-list" role="list" aria-label={t("search.sectionTitle")} aria-live="polite" style={{ marginTop: "1rem" }}>
        {hasQuery && searchResults.length === 0 ? (
          <p className="editor-meta" role="status">{t("search.noResults", { query })}</p>
        ) : null}
        {!hasQuery ? (
          <p className="editor-meta">{t("search.prompt")}</p>
        ) : null}
        {searchResults.map((result: SearchResult) => (
          <article
            className="preference-row"
            key={result.id}
            onClick={() => onSelectResult(result.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelectResult(result.id);
            }}
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            aria-label={`${result.title} — ${result.matchCount} ${result.matchCount === 1 ? t("search.matchCountSingular") : t("search.matchCountPlural")}`}
          >
            <div>
              <strong
                dangerouslySetInnerHTML={{
                  __html: highlightMatches(result.title, query)
                    .replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>"),
                }}
              />
              <p
                className="editor-meta"
                dangerouslySetInnerHTML={{
                  __html: highlightMatches(result.snippet, query)
                    .replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>"),
                }}
              />
            </div>
            <span className="editor-meta">
              {result.matchCount} {result.matchCount === 1 ? t("search.matchCountSingular") : t("search.matchCountPlural")}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
