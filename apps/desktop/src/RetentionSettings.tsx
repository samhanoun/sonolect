import React, { useState, useMemo } from "react";
import type { TranscriptHistoryRow } from "./transcriptHistory";
import {
  getRetentionStats,
  type RetentionPolicy,
} from "./retentionControls";

export type RetentionSettingsProps = {
  history: TranscriptHistoryRow[];
  policy: RetentionPolicy;
  onPolicyChange: (policy: RetentionPolicy) => void;
  onPurge: () => void;
};

export function RetentionSettings({
  history,
  policy,
  onPolicyChange,
  onPurge,
}: RetentionSettingsProps) {
  const [confirmPurge, setConfirmPurge] = useState(false);

  const stats = useMemo(
    () => getRetentionStats(history, policy),
    [history, policy],
  );

  function handleMaxAgeDays(value: string) {
    const days = parseInt(value, 10);
    if (Number.isNaN(days) || days < 1) return;
    onPolicyChange({ ...policy, maxAgeDays: Math.min(days, 3650) });
  }

  function handleMaxItems(value: string) {
    const items = parseInt(value, 10);
    if (Number.isNaN(items) || items < 1) return;
    onPolicyChange({ ...policy, maxItems: Math.min(items, 100_000) });
  }

  function handleAutoDelete(checked: boolean) {
    onPolicyChange({ ...policy, autoDeleteEnabled: checked });
  }

  function handlePurge() {
    if (!confirmPurge) {
      setConfirmPurge(true);
      return;
    }
    onPurge();
    setConfirmPurge(false);
  }

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div className="section-title">Data Retention</div>
      <p>
        Control how long transcript history is kept and how many items are
        stored.
      </p>

      <div className="stats-grid" style={{ marginTop: "0.75rem" }}>
        <div className="stat-item">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total items</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.withinPolicy}</span>
          <span className="stat-label">Within policy</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.expiring}</span>
          <span className="stat-label">Expiring soon</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.expired}</span>
          <span className="stat-label">Expired</span>
        </div>
      </div>

      <div className="form-grid two" style={{ marginTop: "1rem" }}>
        <label>
          <span>Max age (days)</span>
          <input
            type="number"
            min="1"
            max="3650"
            value={policy.maxAgeDays}
            onChange={(e) => handleMaxAgeDays(e.target.value)}
          />
        </label>
        <label>
          <span>Max items</span>
          <input
            type="number"
            min="1"
            max="100000"
            value={policy.maxItems}
            onChange={(e) => handleMaxItems(e.target.value)}
          />
        </label>
      </div>

      <label
        className="preference-row check-row"
        style={{ marginTop: "0.75rem" }}
      >
        <input
          type="checkbox"
          checked={policy.autoDeleteEnabled}
          onChange={(e) => handleAutoDelete(e.target.checked)}
        />
        <div>
          <strong>Auto-delete</strong>
          <p className="editor-meta">
            Automatically remove expired transcripts when the app starts.
          </p>
        </div>
      </label>

      <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
        <button
          className={
            confirmPurge ? "primary-button compact" : "ghost-button"
          }
          onClick={handlePurge}
          type="button"
        >
          {confirmPurge ? "Confirm purge" : "Purge now"}
        </button>
        {confirmPurge ? (
          <button
            className="ghost-button"
            onClick={() => setConfirmPurge(false)}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        {stats.expired > 0 ? (
          <span className="editor-meta">
            {stats.expired} expired {stats.expired === 1 ? "item" : "items"}{" "}
            can be purged
          </span>
        ) : null}
      </div>
    </div>
  );
}
