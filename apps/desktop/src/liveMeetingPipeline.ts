import type { MeetingSession } from "./meetingMode";
import {
  createMeetingSession,
  addSegmentToMeeting,
  endMeeting,
} from "./meetingMode";

export interface PipelineConfig {
  chunkDurationMs: number;
  overlapMs: number;
  whisperModel: string;
  language: string;
  maxSpeakers: number;
  gapThresholdMs: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  chunkDurationMs: 10_000,
  overlapMs: 1_000,
  whisperModel: "base",
  language: "en",
  maxSpeakers: 6,
  gapThresholdMs: 2_000,
};

export type PipelineStatus =
  | "idle"
  | "starting"
  | "capturing"
  | "processing"
  | "paused"
  | "stopped"
  | "error";

export interface PipelineState {
  status: PipelineStatus;
  session: MeetingSession | null;
  chunksProcessed: number;
  totalDurationMs: number;
  currentSpeaker: string;
  error?: string;
}

export function createPipelineState(title?: string): PipelineState {
  return {
    status: "idle",
    session: title ? createMeetingSession({ title }) : null,
    chunksProcessed: 0,
    totalDurationMs: 0,
    currentSpeaker: "Speaker 1",
  };
}

export interface AudioChunk {
  samples: Float32Array;
  startMs: number;
  endMs: number;
  index: number;
}

export function sliceAudioIntoChunks(
  samples: Float32Array,
  sampleRate: number,
  chunkDurationMs: number,
  overlapMs: number,
): AudioChunk[] {
  const chunkSamples = Math.floor((chunkDurationMs / 1000) * sampleRate);
  const overlapSamples = Math.floor((overlapMs / 1000) * sampleRate);
  const step = chunkSamples - overlapSamples;
  const chunks: AudioChunk[] = [];

  for (let i = 0, idx = 0; i < samples.length; i += step, idx++) {
    const end = Math.min(i + chunkSamples, samples.length);
    chunks.push({
      samples: samples.slice(i, end),
      startMs: Math.floor((i / sampleRate) * 1000),
      endMs: Math.floor((end / sampleRate) * 1000),
      index: idx,
    });
    if (end >= samples.length) break;
  }

  return chunks;
}

export interface TranscriptionResult {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export function assignSpeakerToChunk(
  result: TranscriptionResult,
  previousEndMs: number,
  currentSpeaker: string,
  gapThresholdMs: number,
): string {
  if (previousEndMs === 0) return "Speaker 1";
  const gap = result.startMs - previousEndMs;
  if (gap > gapThresholdMs) {
    const num = parseInt(currentSpeaker.replace("Speaker ", ""), 10) || 1;
    return `Speaker ${num + 1}`;
  }
  return currentSpeaker;
}

export function processChunkResult(
  state: PipelineState,
  result: TranscriptionResult,
  config: PipelineConfig,
): PipelineState {
  if (!state.session || !result.text.trim()) return state;

  const lastSegment = state.session.segments[state.session.segments.length - 1];
  const previousEndMs = lastSegment?.endMs ?? 0;

  const speaker = assignSpeakerToChunk(
    result,
    previousEndMs,
    state.currentSpeaker,
    config.gapThresholdMs,
  );

  const updatedSession = addSegmentToMeeting(state.session, {
    id: `seg-${state.chunksProcessed}`,
    text: result.text.trim(),
    startMs: result.startMs,
    endMs: result.endMs,
    speaker,
  });

  return {
    ...state,
    status: "capturing",
    session: updatedSession,
    chunksProcessed: state.chunksProcessed + 1,
    totalDurationMs: result.endMs,
    currentSpeaker: speaker,
  };
}

export function finalizePipeline(state: PipelineState): PipelineState {
  if (!state.session) return { ...state, status: "stopped" };
  const session =
    state.session.status === "idle"
      ? {
          ...state.session,
          status: "completed" as const,
          endedAt: new Date().toISOString(),
        }
      : endMeeting(state.session);
  return {
    ...state,
    status: "stopped",
    session,
  };
}

export function getPipelineDurationFormatted(totalMs: number): string {
  const seconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
