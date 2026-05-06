import React, { useState, useMemo } from "react";
import type { TranscriptHistoryRow } from "./transcriptHistory";
import { getRetentionStats, type RetentionPolicy } from "./retentionControls";
import { useT } from "./i18n";

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
  const t = useT();
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
    <div style={{ marginTop: "1.5rem" }} aria-labelledby="retention-heading">
      <div className="section-title" id="retention-heading">
        {t("retention.title")}
      </div>
      <p>{t("retention.description")}</p>

      <div
        className="stats-grid"
        role="group"
        aria-label={t("retention.title")}
        style={{ marginTop: "0.75rem" }}
      >
        <div className="stat-item">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">{t("retention.totalItems")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.withinPolicy}</span>
          <span className="stat-label">{t("retention.withinPolicy")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.expiring}</span>
          <span className="stat-label">{t("retention.expiringSoon")}</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.expired}</span>
          <span className="stat-label">{t("retention.expired")}</span>
        </div>
      </div>

      <div className="form-grid two" style={{ marginTop: "1rem" }}>
        <label>
          <span>{t("retention.maxAgeDays")}</span>
          <input
            type="number"
            min="1"
            max="3650"
            value={policy.maxAgeDays}
            onChange={(e) => handleMaxAgeDays(e.target.value)}
          />
        </label>
        <label>
          <span>{t("retention.maxItems")}</span>
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
          <strong>{t("retention.autoDelete")}</strong>
          <p className="editor-meta">{t("retention.autoDeleteDescription")}</p>
        </div>
      </label>

      <div className="inline-actions" style={{ marginTop: "0.75rem" }}>
        <button
          className={confirmPurge ? "primary-button compact" : "ghost-button"}
          onClick={handlePurge}
          type="button"
          aria-label={
            confirmPurge ? t("retention.confirmPurge") : t("retention.purgeNow")
          }
        >
          {confirmPurge ? t("retention.confirmPurge") : t("retention.purgeNow")}
        </button>
        {confirmPurge ? (
          <button
            className="ghost-button"
            onClick={() => setConfirmPurge(false)}
            type="button"
          >
            {t("retention.cancel")}
          </button>
        ) : null}
        {stats.expired > 0 ? (
          <span className="editor-meta" role="status" aria-live="polite">
            {stats.expired}{" "}
            {stats.expired === 1
              ? t("retention.expiredItemsSingular")
              : t("retention.expiredItemsPlural")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
