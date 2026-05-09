/**
 * Real-time meeting controller — ties streaming STT, VAD, and meeting
 * session management into a cohesive lifecycle.
 *
 * All functions are pure.  Side-effectful audio capture and Whisper
 * invocation live in the integration layer.
 */

import {
  type MeetingConfig,
  type MeetingSession,
  DEFAULT_MEETING_CONFIG,
  createMeetingSession,
  startMeeting,
  pauseMeeting,
  resumeMeeting,
  endMeeting,
  addSegmentToMeeting,
  getMeetingTranscriptText,
} from "./meetingMode";

import {
  type StreamConfig,
  type StreamingState,
  type FinalTranscript,
  DEFAULT_STREAM_CONFIG,
  createStreamingState,
} from "./streamingTranscription";

// ── Types ───────────────────────────────────────────────────────────

export type RealtimeMeetingConfig = {
  title: string;
  language: string;
  streamConfig?: Partial<
    Omit<StreamConfig, "onPartialResult" | "onFinalResult">
  >;
  meetingConfig?: Partial<MeetingConfig>;
};

export type RealtimeMeetingStats = {
  wordsPerMinute: number;
  totalWords: number;
  latencyMs: number;
};

export type RealtimeMeetingState = {
  meeting: MeetingSession;
  streaming: StreamingState;
  liveTranscript: FinalTranscript[];
  isActive: boolean;
  startedAt: string;
  stats: RealtimeMeetingStats;
};

// ── Factory ─────────────────────────────────────────────────────────

export function createRealtimeMeeting(
  config: RealtimeMeetingConfig,
): RealtimeMeetingState {
  const meetingSession = startMeeting(
    createMeetingSession({
      ...DEFAULT_MEETING_CONFIG,
      title: config.title,
      language: config.language,
      ...(config.meetingConfig ?? {}),
    }),
  );

  const streamingState = createStreamingState();

  return {
    meeting: meetingSession,
    streaming: { ...streamingState, isStreaming: true },
    liveTranscript: [],
    isActive: true,
    startedAt: meetingSession.startedAt,
    stats: {
      wordsPerMinute: 0,
      totalWords: 0,
      latencyMs: 0,
    },
  };
}

// ── Result handling ─────────────────────────────────────────────────

/**
 * Incorporate a finalized transcript result into the meeting state.
 * Updates the meeting session segments, live transcript, and stats.
 */
export function handleStreamResult(
  state: RealtimeMeetingState,
  result: FinalTranscript,
): RealtimeMeetingState {
  const segmentId = `rt-seg-${state.liveTranscript.length + 1}`;
  const segment = {
    id: segmentId,
    text: result.text,
    startMs: result.startMs,
    endMs: result.endMs,
    ...(result.speaker ? { speaker: result.speaker } : {}),
  };

  const updatedMeeting = addSegmentToMeeting(state.meeting, segment);
  const liveTranscript = [...state.liveTranscript, result];
  const totalWords = countTotalWords(liveTranscript);
  const latencyMs = result.endMs - result.startMs;

  return {
    ...state,
    meeting: updatedMeeting,
    liveTranscript,
    stats: {
      totalWords,
      wordsPerMinute: computeWpmFromTranscripts(liveTranscript),
      latencyMs,
    },
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────

export function pauseRealtimeMeeting(
  state: RealtimeMeetingState,
): RealtimeMeetingState {
  return {
    ...state,
    meeting: pauseMeeting(state.meeting),
    streaming: { ...state.streaming, isStreaming: false },
    isActive: false,
  };
}

export function resumeRealtimeMeeting(
  state: RealtimeMeetingState,
): RealtimeMeetingState {
  return {
    ...state,
    meeting: resumeMeeting(state.meeting),
    streaming: { ...state.streaming, isStreaming: true },
    isActive: true,
  };
}

export function endRealtimeMeeting(
  state: RealtimeMeetingState,
): RealtimeMeetingState {
  const finalMeeting = endMeeting(state.meeting);
  const totalWords = countTotalWords(state.liveTranscript);

  return {
    ...state,
    meeting: finalMeeting,
    streaming: { ...state.streaming, isStreaming: false },
    isActive: false,
    stats: {
      totalWords,
      wordsPerMinute: computeWpmFromTranscripts(state.liveTranscript),
      latencyMs: state.stats.latencyMs,
    },
  };
}

// ── Stats ───────────────────────────────────────────────────────────

/**
 * Compute words-per-minute from the current meeting state.
 */
export function computeWpm(state: RealtimeMeetingState): number {
  return computeWpmFromTranscripts(state.liveTranscript);
}

function computeWpmFromTranscripts(transcripts: FinalTranscript[]): number {
  if (transcripts.length === 0) return 0;

  const totalWords = countTotalWords(transcripts);
  const firstStart = Math.min(...transcripts.map((t) => t.startMs));
  const lastEnd = Math.max(...transcripts.map((t) => t.endMs));
  const durationMinutes = (lastEnd - firstStart) / 60_000;

  if (durationMinutes <= 0) return 0;
  return Math.round(totalWords / durationMinutes);
}

function countTotalWords(transcripts: FinalTranscript[]): number {
  return transcripts.reduce((sum, t) => {
    const words = t.text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return sum + words.length;
  }, 0);
}

// ── Transcript access ───────────────────────────────────────────────

/**
 * Get the concatenated transcript text from the realtime meeting.
 */
export function getRealtimeTranscriptText(state: RealtimeMeetingState): string {
  return state.liveTranscript
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join("\n\n");
}
