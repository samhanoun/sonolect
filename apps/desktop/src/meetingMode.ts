/**
 * Meeting session management — pure data model for meeting lifecycle.
 *
 * A MeetingSession tracks metadata, state, and accumulated transcript
 * segments for a single recording/meeting session.
 */

import type { TranscriptSegment } from "./segmentEditor";

export type MeetingStatus =
  "idle" | "active" | "paused" | "ending" | "completed";

export type MeetingConfig = {
  title: string;
  language: string;
  speakerCount: number;
  autoSave: boolean;
};

export type MeetingSession = {
  id: string;
  config: MeetingConfig;
  status: MeetingStatus;
  startedAt: string;
  endedAt?: string;
  segments: TranscriptSegment[];
  durationMs: number;
};

export const DEFAULT_MEETING_CONFIG: MeetingConfig = {
  title: "Untitled Meeting",
  language: "auto",
  speakerCount: 1,
  autoSave: true,
};

let meetingCounter = 0;

export function createMeetingSession(
  config: Partial<MeetingConfig> = {},
): MeetingSession {
  meetingCounter += 1;
  const merged: MeetingConfig = { ...DEFAULT_MEETING_CONFIG, ...config };
  return {
    id: `meeting-${meetingCounter}`,
    config: merged,
    status: "idle",
    startedAt: new Date().toISOString(),
    segments: [],
    durationMs: 0,
  };
}

export function startMeeting(session: MeetingSession): MeetingSession {
  if (session.status !== "idle") return session;
  return { ...session, status: "active", startedAt: new Date().toISOString() };
}

export function pauseMeeting(session: MeetingSession): MeetingSession {
  if (session.status !== "active") return session;
  return { ...session, status: "paused" };
}

export function resumeMeeting(session: MeetingSession): MeetingSession {
  if (session.status !== "paused") return session;
  return { ...session, status: "active" };
}

export function endMeeting(session: MeetingSession): MeetingSession {
  if (session.status === "completed" || session.status === "idle")
    return session;
  return {
    ...session,
    status: "completed",
    endedAt: new Date().toISOString(),
  };
}

export function addSegmentToMeeting(
  session: MeetingSession,
  segment: TranscriptSegment,
): MeetingSession {
  return {
    ...session,
    segments: [...session.segments, segment],
    durationMs: Math.max(session.durationMs, segment.endMs),
  };
}

export function getMeetingTranscriptText(session: MeetingSession): string {
  return session.segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}
