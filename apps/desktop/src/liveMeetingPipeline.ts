/**
 * Live meeting transcription pipeline — orchestrates system audio capture,
 * chunked transcription via Whisper, and real-time speaker assignment.
 *
 * Pipeline flow: system audio capture -> chunk splitting -> Whisper transcription
 *                -> speaker assignment -> meeting session updates
 */

import type { VadState } from "./vad";
import { createVadState } from "./vad";
import type { MeetingSession, MeetingTranscriptChunk } from "./meetingMode";
import {
  createMeetingSession,
  addTranscriptChunk,
  pauseMeeting,
  resumeMeeting,
  endMeeting,
} from "./meetingMode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LiveMeetingConfig = {
  chunkDurationMs: number;
  language: string;
  speakerDetection: boolean;
  vadEnabled: boolean;
};

export type LiveChunk = {
  audioPath: string;
  startMs: number;
  endMs: number;
};

export type LiveTranscriptUpdate = {
  text: string;
  speaker?: string | undefined;
  isFinal: boolean;
  timestampMs: number;
};

export type LivePipelineCallbacks = {
  onUpdate: (update: LiveTranscriptUpdate) => void;
  onError: (error: string) => void;
  onSessionUpdate: (session: MeetingSession) => void;
};

export type LivePipelineHandle = {
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  getSession: () => MeetingSession;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CHUNK_DURATION = 10_000; // 10 seconds

export const DEFAULT_LIVE_MEETING_CONFIG: LiveMeetingConfig = {
  chunkDurationMs: DEFAULT_CHUNK_DURATION,
  language: "auto",
  speakerDetection: true,
  vadEnabled: true,
};

// ---------------------------------------------------------------------------
// Chunk splitting
// ---------------------------------------------------------------------------

/**
 * Split a WAV audio file into sequential chunks of the specified duration.
 * In production this would invoke ffmpeg; here we compute the chunk boundaries
 * and return metadata for each chunk.
 */
export function splitAudioIntoChunks(
  audioPath: string,
  chunkDurationMs: number,
  totalDurationMs: number,
): LiveChunk[] {
  if (totalDurationMs <= 0 || chunkDurationMs <= 0) return [];

  const chunks: LiveChunk[] = [];
  let startMs = 0;

  while (startMs < totalDurationMs) {
    const endMs = Math.min(startMs + chunkDurationMs, totalDurationMs);
    const chunkIndex = chunks.length;
    chunks.push({
      audioPath: `${audioPath}.chunk-${chunkIndex}.wav`,
      startMs,
      endMs,
    });
    startMs = endMs;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Chunk transcription
// ---------------------------------------------------------------------------

/**
 * Transcribe a single audio chunk via the Whisper Tauri command.
 * Returns a LiveTranscriptUpdate with the transcribed text.
 *
 * In a real implementation this would invoke the Tauri `transcribe_audio`
 * command. For the pipeline architecture, this is the integration point.
 */
export async function transcribeChunk(
  chunk: LiveChunk,
  language: string,
): Promise<LiveTranscriptUpdate> {
  // Integration point: in production, reads the chunk file, sends to Whisper
  // via Tauri invoke, and returns the result. The actual invocation is:
  //
  //   const result = await invoke("transcribe_audio", {
  //     payload: { audioBytes, mimeType: "audio/wav", durationMs, language }
  //   });
  //
  // For now, return a placeholder that the pipeline test can verify.
  return {
    text: "",
    isFinal: true,
    timestampMs: chunk.startMs,
  };
}

// ---------------------------------------------------------------------------
// Speaker assignment heuristics
// ---------------------------------------------------------------------------

/**
 * Assign a speaker label to a transcript chunk based on silence gaps
 * and previous speaker context.
 *
 * Heuristic: if there is a silence gap longer than 2 seconds between
 * the current chunk and the previous one, assume a speaker change.
 */
export function assignSpeakerToChunk(
  chunk: LiveTranscriptUpdate,
  _vadState: VadState | null,
  previousSpeaker: string | undefined,
  previousEndMs: number,
  silenceThresholdMs: number = 2000,
): string {
  // If no previous speaker, start with Speaker 1
  if (!previousSpeaker) {
    return "Speaker 1";
  }

  // Calculate gap between previous segment end and current chunk
  const gap = chunk.timestampMs - previousEndMs;

  // If the gap exceeds the silence threshold, alternate speaker
  if (gap >= silenceThresholdMs) {
    const currentNumber = parseInt(previousSpeaker.replace("Speaker ", ""), 10);
    if (isNaN(currentNumber)) return "Speaker 1";
    // Alternate between speakers (for 2-speaker meetings)
    const nextNumber = currentNumber >= 2 ? 1 : currentNumber + 1;
    return `Speaker ${nextNumber}`;
  }

  // Same speaker continues
  return previousSpeaker;
}

// ---------------------------------------------------------------------------
// Live transcription pipeline
// ---------------------------------------------------------------------------

/**
 * Build a live transcription pipeline that orchestrates:
 * 1. Audio capture (via systemAudioCapture)
 * 2. Periodic chunk splitting
 * 3. Whisper transcription per chunk
 * 4. Speaker assignment
 * 5. Meeting session updates
 */
export function buildLiveTranscriptionPipeline(
  config: LiveMeetingConfig,
  title: string,
  participants: string[],
  callbacks: LivePipelineCallbacks,
): LivePipelineHandle {
  let session = createMeetingSession({
    title,
    participants,
    autoDetectSpeakers: config.speakerDetection,
    language: config.language,
    maxDurationMs: 4 * 60 * 60 * 1000, // 4 hours max
  });

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let chunkIndex = 0;
  let previousSpeaker: string | undefined;
  let previousEndMs = 0;
  let running = false;
  let vadState: VadState = createVadState();

  function processChunk(chunk: LiveChunk) {
    void transcribeChunk(chunk, config.language)
      .then((update) => {
        if (!update.text.trim()) return;

        // Assign speaker
        const speaker = config.speakerDetection
          ? assignSpeakerToChunk(
              update,
              vadState,
              previousSpeaker,
              previousEndMs,
            )
          : undefined;

        previousSpeaker = speaker;
        previousEndMs = chunk.endMs;

        const finalUpdate: LiveTranscriptUpdate = {
          ...update,
          speaker,
          isFinal: true,
        };

        // Add to meeting session
        const meetingChunk: MeetingTranscriptChunk = {
          text: update.text,
          speaker,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          language: config.language !== "auto" ? config.language : undefined,
          isFinal: true,
        };

        session = addTranscriptChunk(session, meetingChunk);
        callbacks.onUpdate(finalUpdate);
        callbacks.onSessionUpdate(session);
      })
      .catch((error: unknown) => {
        callbacks.onError(
          error instanceof Error ? error.message : "Transcription failed",
        );
      });
  }

  return {
    start() {
      if (running) return;
      running = true;
      vadState = createVadState();
      chunkIndex = 0;
      previousSpeaker = undefined;
      previousEndMs = 0;

      // Periodically create chunks from the growing audio file
      intervalId = setInterval(() => {
        if (!running) return;
        const startMs = chunkIndex * config.chunkDurationMs;
        const endMs = startMs + config.chunkDurationMs;
        const chunk: LiveChunk = {
          audioPath: `capture.chunk-${chunkIndex}.wav`,
          startMs,
          endMs,
        };
        chunkIndex++;
        processChunk(chunk);
      }, config.chunkDurationMs);

      callbacks.onSessionUpdate(session);
    },

    stop() {
      running = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      session = endMeeting(session);
      callbacks.onSessionUpdate(session);
    },

    pause() {
      running = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      session = pauseMeeting(session);
      callbacks.onSessionUpdate(session);
    },

    resume() {
      if (running) return;
      running = true;
      session = resumeMeeting(session);

      intervalId = setInterval(() => {
        if (!running) return;
        const startMs = chunkIndex * config.chunkDurationMs;
        const endMs = startMs + config.chunkDurationMs;
        const chunk: LiveChunk = {
          audioPath: `capture.chunk-${chunkIndex}.wav`,
          startMs,
          endMs,
        };
        chunkIndex++;
        processChunk(chunk);
      }, config.chunkDurationMs);

      callbacks.onSessionUpdate(session);
    },

    getSession() {
      return session;
    },
  };
}
