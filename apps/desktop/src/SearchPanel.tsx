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

export type SearchPanelProps = {
  history: TranscriptHistoryRow[];
  onSelectResult: (id: string) => void;
};

export function SearchPanel({ history, onSelectResult }: SearchPanelProps) {
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
    <section className="glass-card management-panel">
      <p className="section-title">Search transcripts</p>
      <h3>Find past dictations by content</h3>

      <input
        className="search-input"
        type="text"
        placeholder="Search transcripts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search transcripts"
        autoFocus
      />

      <div className="form-grid two" style={{ marginTop: "0.75rem" }}>
        <label>
          <span>From date</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label>
          <span>To date</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
      </div>
      <div className="form-grid two" style={{ marginTop: "0.5rem" }}>
        <label>
          <span>Min duration (minutes)</span>
          <input
            type="number"
            min="0"
            value={minDurationMin}
            onChange={(e) => setMinDurationMin(e.target.value)}
            placeholder="0"
          />
        </label>
        <label>
          <span>Sort by</span>
          <select
            className="ghost-button"
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "relevance" | "date" | "duration")
            }
          >
            <option value="relevance">Relevance</option>
            <option value="date">Date</option>
            <option value="duration">Duration</option>
          </select>
        </label>
      </div>

      <div className="preference-list" style={{ marginTop: "1rem" }}>
        {hasQuery && searchResults.length === 0 ? (
          <p className="editor-meta">No results for "{query}".</p>
        ) : null}
        {!hasQuery ? (
          <p className="editor-meta">
            Type a search query to find matching transcripts.
          </p>
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
              {result.matchCount} {result.matchCount === 1 ? "match" : "matches"}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
