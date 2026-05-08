/**
 * MeetingView — UI component for live meeting transcription with system
 * audio capture, real-time transcript feed, and export controls.
 *
 * Dark glass theme, consistent with other Sonolect desktop views.
 */

import React, { useCallback, useMemo, useState } from "react";
import type { MeetingSession } from "./meetingMode";
import { formatMeetingDuration, getMeetingSpeakers } from "./meetingMode";
import type { MeetingExportFormat } from "./meetingExport";
import {
  exportMeetingNotes,
  exportMeetingTranscript,
  exportMeetingSrt,
  exportMeetingSummary,
  getMeetingStats,
} from "./meetingExport";
import type { SystemAudioStatus } from "./systemAudioCapture";
import { assignSpeakerColors } from "./speakerDiarization";
import type { SpeakerProfile } from "./speakerDiarization";
import { useT } from "./i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeetingViewProps = {
  activeMeeting: MeetingSession | null;
  meetingHistory: MeetingSession[];
  systemAudioStatus: SystemAudioStatus | null;
  onStartMeeting: (title: string) => void;
  onPauseMeeting: () => void;
  onResumeMeeting: () => void;
  onEndMeeting: () => void;
  onSelectMeeting: (id: string) => void;
  onExport: (format: MeetingExportFormat, content: string) => void;
};

// ---------------------------------------------------------------------------
// Speaker color assignment
// ---------------------------------------------------------------------------

const SPEAKER_COLORS = [
  "#4A90D9",
  "#E57373",
  "#81C784",
  "#FFB74D",
  "#BA68C8",
  "#4DD0E1",
  "#F06292",
  "#AED581",
];

function getSpeakerColor(speaker: string, allSpeakers: string[]): string {
  const index = allSpeakers.indexOf(speaker);
  return SPEAKER_COLORS[
    (index >= 0 ? index : 0) % SPEAKER_COLORS.length
  ] as string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SystemAudioIndicator({
  status,
}: {
  status: SystemAudioStatus | null;
}) {
  const t = useT();

  if (!status) {
    return (
      <div className="glass-card system-audio-status" data-status="checking">
        <span className="status-dot" />
        <span>{t("meeting.audioChecking")}</span>
      </div>
    );
  }

  return (
    <div
      className="glass-card system-audio-status"
      data-status={status.available ? "available" : "unavailable"}
      role="status"
      aria-label={
        status.available
          ? t("meeting.audioAvailable")
          : t("meeting.audioUnavailable")
      }
    >
      <span
        className="status-dot"
        style={{
          backgroundColor: status.available ? "#81C784" : "#E57373",
        }}
      />
      <span>
        {status.available
          ? `${t("meeting.audioAvailable")} (${status.method})`
          : t("meeting.audioUnavailable")}
      </span>
      {!status.available && (
        <p className="setup-hint">{status.setupInstructions}</p>
      )}
    </div>
  );
}

function MeetingStartForm({
  onStart,
  disabled,
}: {
  onStart: (title: string) => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState("");
  const t = useT();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const meetingTitle = title.trim() || "Untitled Meeting";
      onStart(meetingTitle);
      setTitle("");
    },
    [title, onStart],
  );

  return (
    <form className="meeting-start-form" onSubmit={handleSubmit}>
      <input
        type="text"
        className="glass-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("meeting.titlePlaceholder")}
        aria-label={t("meeting.titleLabel")}
      />
      <button
        type="submit"
        className="meeting-start-btn"
        disabled={disabled}
        aria-label={t("meeting.startMeeting")}
      >
        {t("meeting.startMeeting")}
      </button>
    </form>
  );
}

function LiveTranscriptFeed({ session }: { session: MeetingSession }) {
  const speakers = getMeetingSpeakers(session);

  return (
    <div
      className="live-transcript-feed"
      role="log"
      aria-live="polite"
      aria-label="Live transcript"
    >
      {session.segments.length === 0 ? (
        <p className="transcript-empty">Waiting for speech...</p>
      ) : (
        session.segments.map((segment) => (
          <div key={segment.id} className="transcript-line">
            {segment.speaker && (
              <span
                className="speaker-label"
                style={{
                  color: getSpeakerColor(segment.speaker, speakers),
                }}
              >
                {segment.speaker}:
              </span>
            )}
            <span className="segment-text">{segment.text}</span>
            <span className="segment-time">
              {formatTimestamp(segment.startMs)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function MeetingControls({
  session,
  onPause,
  onResume,
  onEnd,
}: {
  session: MeetingSession;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const t = useT();

  return (
    <div
      className="meeting-controls"
      role="toolbar"
      aria-label="Meeting controls"
    >
      {session.status === "active" ? (
        <button
          className="control-btn pause"
          onClick={onPause}
          type="button"
          aria-label={t("meeting.pause")}
        >
          {t("meeting.pause")}
        </button>
      ) : session.status === "paused" ? (
        <button
          className="control-btn resume"
          onClick={onResume}
          type="button"
          aria-label={t("meeting.resume")}
        >
          {t("meeting.resume")}
        </button>
      ) : null}
      {session.status !== "ended" && (
        <button
          className="control-btn end"
          onClick={onEnd}
          type="button"
          aria-label={t("meeting.endMeeting")}
        >
          {t("meeting.endMeeting")}
        </button>
      )}
    </div>
  );
}

function MeetingSummaryPanel({
  session,
  onExport,
}: {
  session: MeetingSession;
  onExport: (format: MeetingExportFormat, content: string) => void;
}) {
  const t = useT();
  const stats = getMeetingStats(session);

  const exportFormats: Array<{
    format: MeetingExportFormat;
    labelKey: string;
    generate: () => string;
  }> = [
    {
      format: "meeting-notes",
      labelKey: "meeting.exportNotes",
      generate: () => exportMeetingNotes(session),
    },
    {
      format: "transcript",
      labelKey: "meeting.exportTranscript",
      generate: () => exportMeetingTranscript(session),
    },
    {
      format: "srt",
      labelKey: "meeting.exportSrt",
      generate: () => exportMeetingSrt(session),
    },
    {
      format: "summary",
      labelKey: "meeting.exportSummary",
      generate: () => exportMeetingSummary(session),
    },
  ];

  return (
    <div className="glass-card meeting-summary">
      <h3>{t("meeting.summaryTitle")}</h3>
      <div className="meeting-stats">
        <span>
          {stats.duration} | {stats.wordCount} {t("editor.wordCount")} |{" "}
          {stats.speakerCount} {t("meeting.speakers")}
        </span>
      </div>
      <div className="export-actions">
        {exportFormats.map(({ format, labelKey, generate }) => (
          <button
            key={format}
            className="export-btn"
            type="button"
            onClick={() => onExport(format, generate())}
            aria-label={t(labelKey as Parameters<typeof t>[0])}
          >
            {t(labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>
    </div>
  );
}

function MeetingHistoryList({
  history,
  onSelect,
}: {
  history: MeetingSession[];
  onSelect: (id: string) => void;
}) {
  const t = useT();

  if (history.length === 0) {
    return <p className="meeting-empty">{t("meeting.noHistory")}</p>;
  }

  return (
    <div className="meeting-history-list">
      <h3>{t("meeting.historyTitle")}</h3>
      {history.map((meeting) => (
        <button
          key={meeting.id}
          className="glass-card meeting-history-card"
          type="button"
          onClick={() => onSelect(meeting.id)}
          aria-label={`${meeting.title} - ${formatMeetingDuration(meeting.totalDurationMs)}`}
        >
          <span className="meeting-title">{meeting.title}</span>
          <span className="meeting-meta">
            {meeting.startedAt} |{" "}
            {formatMeetingDuration(meeting.totalDurationMs)}
          </span>
          <span className="meeting-status">{meeting.status}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MeetingView({
  activeMeeting,
  meetingHistory,
  systemAudioStatus,
  onStartMeeting,
  onPauseMeeting,
  onResumeMeeting,
  onEndMeeting,
  onSelectMeeting,
  onExport,
}: MeetingViewProps) {
  const t = useT();

  return (
    <div className="meeting-view" aria-label={t("meeting.ariaLabel")}>
      <div className="glass-card meeting-header">
        <h2>{t("meeting.sectionTitle")}</h2>
        <p className="subtitle">{t("meeting.subtitle")}</p>
      </div>

      <SystemAudioIndicator status={systemAudioStatus} />

      {activeMeeting && activeMeeting.status !== "ended" ? (
        <div className="meeting-active-panel">
          <div className="glass-card meeting-info">
            <h3>{activeMeeting.title}</h3>
            <div className="recording-timer">
              <span className="record-dot-live" aria-hidden="true" />
              <span>
                {formatMeetingDuration(activeMeeting.totalDurationMs)}
              </span>
              <span className="meeting-status-badge">
                {activeMeeting.status === "active"
                  ? t("meeting.recording")
                  : t("meeting.paused")}
              </span>
            </div>
          </div>

          <LiveTranscriptFeed session={activeMeeting} />

          <MeetingControls
            session={activeMeeting}
            onPause={onPauseMeeting}
            onResume={onResumeMeeting}
            onEnd={onEndMeeting}
          />
        </div>
      ) : activeMeeting && activeMeeting.status === "ended" ? (
        <div className="meeting-ended-panel">
          <MeetingSummaryPanel session={activeMeeting} onExport={onExport} />
        </div>
      ) : (
        <div className="meeting-idle-panel">
          <MeetingStartForm
            onStart={onStartMeeting}
            disabled={
              systemAudioStatus !== null && !systemAudioStatus.available
            }
          />
        </div>
      )}

      <MeetingHistoryList history={meetingHistory} onSelect={onSelectMeeting} />
    </div>
  );
}
