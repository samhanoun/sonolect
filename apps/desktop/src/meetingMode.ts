import type { TranscriptSegment } from "./segmentEditor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MeetingConfig = {
  title?: string | undefined;
  participants: string[];
  autoDetectSpeakers: boolean;
  language: string;
  maxDurationMs: number;
};

export type MeetingSession = {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string | undefined;
  participants: string[];
  segments: TranscriptSegment[];
  status: "active" | "paused" | "ended";
  totalDurationMs: number;
};

export type MeetingTranscriptChunk = {
  text: string;
  speaker?: string | undefined;
  startMs: number;
  endMs: number;
  language?: string | undefined;
  isFinal: boolean;
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

let sessionCounter = 0;

export function createMeetingSession(config: MeetingConfig): MeetingSession {
  sessionCounter += 1;
  return {
    id: `meeting-${Date.now()}-${sessionCounter}`,
    title: config.title ?? "Untitled Meeting",
    startedAt: new Date().toISOString(),
    participants: [...config.participants],
    segments: [],
    status: "active",
    totalDurationMs: 0,
  };
}

export function addTranscriptChunk(
  session: MeetingSession,
  chunk: MeetingTranscriptChunk,
): MeetingSession {
  const segment: TranscriptSegment = {
    id: `chunk-${session.segments.length + 1}-${Date.now()}`,
    text: chunk.text,
    startMs: chunk.startMs,
    endMs: chunk.endMs,
    ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
  };

  const segments = [...session.segments, segment];
  const totalDurationMs = computeTotalDuration(segments);

  return { ...session, segments, totalDurationMs };
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
  if (session.status === "ended") return session;
  const totalDurationMs = computeTotalDuration(session.segments);
  return {
    ...session,
    status: "ended",
    endedAt: new Date().toISOString(),
    totalDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

function computeTotalDuration(segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  const firstStart = segments[0]!.startMs;
  const lastEnd = segments[segments.length - 1]!.endMs;
  return Math.max(0, lastEnd - firstStart);
}

export function getMeetingDuration(session: MeetingSession): number {
  return computeTotalDuration(session.segments);
}

export function formatMeetingDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Speaker management
// ---------------------------------------------------------------------------

export function assignSpeakerToChunks(
  session: MeetingSession,
  speakerMap: Record<string, string>,
): MeetingSession {
  const segments = session.segments.map((seg) => {
    const currentSpeaker = seg.speaker ?? "";
    const newSpeaker = speakerMap[currentSpeaker];
    if (newSpeaker !== undefined) {
      return { ...seg, speaker: newSpeaker };
    }
    return seg;
  });

  return { ...session, segments };
}

export function getMeetingSpeakers(session: MeetingSession): string[] {
  const speakers = new Set<string>();
  for (const seg of session.segments) {
    if (seg.speaker) {
      speakers.add(seg.speaker);
    }
  }
  return [...speakers].sort();
}

// ---------------------------------------------------------------------------
// Topic splitting
// ---------------------------------------------------------------------------

export function splitMeetingByTopics(
  session: MeetingSession,
  silenceGapMs: number = 5000,
): MeetingSession[] {
  if (session.segments.length === 0) return [];

  const groups: TranscriptSegment[][] = [];
  let currentGroup: TranscriptSegment[] = [session.segments[0]!];

  for (let i = 1; i < session.segments.length; i++) {
    const prev = session.segments[i - 1]!;
    const curr = session.segments[i]!;
    const gap = curr.startMs - prev.endMs;

    if (gap >= silenceGapMs) {
      groups.push(currentGroup);
      currentGroup = [curr];
    } else {
      currentGroup.push(curr);
    }
  }
  groups.push(currentGroup);

  return groups.map((segments, index) => ({
    id: `${session.id}-topic-${index + 1}`,
    title: `${session.title} - Topic ${index + 1}`,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    participants: session.participants,
    segments,
    status: session.status,
    totalDurationMs: computeTotalDuration(segments),
  }));
}
