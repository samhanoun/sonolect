import type { MeetingSession } from "./meetingMode";
import { formatMeetingDuration, getMeetingSpeakers } from "./meetingMode";
import { summarizeLocally } from "./aiSummary";
import { segmentsToText } from "./segmentEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeetingExportFormat =
  | "meeting-notes"
  | "transcript"
  | "srt"
  | "summary";

export type MeetingStats = {
  duration: string;
  wordCount: number;
  speakerCount: number;
  segmentCount: number;
  averageSegmentLength: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSrtTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Export: Meeting Notes
// ---------------------------------------------------------------------------

export function exportMeetingNotes(session: MeetingSession): string {
  const parts: string[] = [];

  parts.push(`# ${session.title}`);
  parts.push("");
  parts.push(`**Date:** ${session.startedAt}`);

  if (session.participants.length > 0) {
    parts.push(`**Participants:** ${session.participants.join(", ")}`);
  }

  const duration = session.totalDurationMs;
  if (duration > 0) {
    parts.push(`**Duration:** ${formatMeetingDuration(duration)}`);
  }

  parts.push("");
  parts.push("## Timeline");
  parts.push("");

  for (const seg of session.segments) {
    const ts = formatTimestamp(seg.startMs);
    const speaker = seg.speaker ? `**${seg.speaker}:** ` : "";
    parts.push(`[${ts}] ${speaker}${seg.text}`);
  }

  // Extract action items from the transcript
  const transcript = segmentsToText(session.segments);
  const summary = summarizeLocally({
    transcript,
    segments: session.segments,
    style: "action-items",
  });

  if (summary.actionItems.length > 0) {
    parts.push("");
    parts.push("## Action Items");
    parts.push("");
    for (const item of summary.actionItems) {
      let line = `- [${item.priority.toUpperCase()}] ${item.text}`;
      if (item.assignee) line += ` (${item.assignee})`;
      parts.push(line);
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Export: Plain Transcript
// ---------------------------------------------------------------------------

export function exportMeetingTranscript(session: MeetingSession): string {
  return session.segments
    .map((seg) => {
      const ts = formatTimestamp(seg.startMs);
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      return `[${ts}] ${speaker}${seg.text}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Export: SRT
// ---------------------------------------------------------------------------

export function exportMeetingSrt(session: MeetingSession): string {
  return session.segments
    .map((seg, index) => {
      const start = formatSrtTimestamp(seg.startMs);
      const end = formatSrtTimestamp(seg.endMs);
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      return `${index + 1}\n${start} --> ${end}\n${speaker}${seg.text}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Export: Summary
// ---------------------------------------------------------------------------

export function exportMeetingSummary(session: MeetingSession): string {
  const transcript = segmentsToText(session.segments);
  const result = summarizeLocally({
    transcript,
    segments: session.segments,
    style: "meeting-notes",
  });
  return result.summary;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getMeetingStats(session: MeetingSession): MeetingStats {
  const transcript = segmentsToText(session.segments);
  const wordCount = countWords(transcript);
  const speakers = getMeetingSpeakers(session);
  const segmentCount = session.segments.length;

  const totalWords = session.segments.reduce(
    (sum, seg) => sum + countWords(seg.text),
    0,
  );
  const averageSegmentLength =
    segmentCount > 0 ? Math.round(totalWords / segmentCount) : 0;

  return {
    duration: formatMeetingDuration(session.totalDurationMs),
    wordCount,
    speakerCount: speakers.length,
    segmentCount,
    averageSegmentLength,
  };
}
