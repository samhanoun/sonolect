/**
 * Streaming STT engine — process audio in overlapping windows while
 * recording continues, using VAD to skip silence and deduplicating
 * overlapping results.
 *
 * All functions are pure and testable.  The integration layer feeds
 * Float32Array audio chunks and forwards "transcribe" actions to the
 * actual Whisper backend.
 */

import {
  type VadConfig,
  type VadState,
  DEFAULT_VAD_CONFIG,
  createVadState,
  processVadFrame,
} from "./vad";

// ── Types ───────────────────────────────────────────────────────────

export type StreamConfig = {
  /** Window size in milliseconds. */
  windowSizeMs: number;
  /** Overlap between consecutive windows in milliseconds. */
  overlapMs: number;
  /** Language hint ("auto" for auto-detect). */
  language: string;
  /** Whether VAD gating is enabled. */
  vadEnabled: boolean;
  /** Called with intermediate (partial) results. */
  onPartialResult: (result: PartialTranscript) => void;
  /** Called with finalized results. */
  onFinalResult: (result: FinalTranscript) => void;
};

export type PartialTranscript = {
  text: string;
  isFinal: false;
  windowIndex: number;
  timestampMs: number;
  confidence: number;
};

export type FinalTranscript = {
  text: string;
  isFinal: true;
  windowIndex: number;
  startMs: number;
  endMs: number;
  speaker?: string;
  language?: string;
};

export type AudioChunkBuffer = {
  samples: Float32Array;
  timestampMs: number;
  durationMs: number;
};

export type StreamingState = {
  isStreaming: boolean;
  windowIndex: number;
  lastProcessedMs: number;
  buffer: AudioChunkBuffer[];
  partialResults: PartialTranscript[];
  vadState: VadState;
};

export type WindowAction = "transcribe" | "skip" | "wait";

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_STREAM_CONFIG: Omit<
  StreamConfig,
  "onPartialResult" | "onFinalResult"
> = {
  windowSizeMs: 5000,
  overlapMs: 500,
  language: "auto",
  vadEnabled: true,
};

// ── State factory ───────────────────────────────────────────────────

export function createStreamingState(): StreamingState {
  return {
    isStreaming: false,
    windowIndex: 0,
    lastProcessedMs: 0,
    buffer: [],
    partialResults: [],
    vadState: createVadState(),
  };
}

// ── Core processing ─────────────────────────────────────────────────

/**
 * Compute total buffered duration in milliseconds.
 */
export function getBufferedDurationMs(buffer: AudioChunkBuffer[]): number {
  return buffer.reduce((sum, chunk) => sum + chunk.durationMs, 0);
}

/**
 * Process one incoming audio chunk.  Returns an updated state and an
 * action the caller should perform:
 *
 * - "wait"       — window not yet full, keep buffering
 * - "skip"       — VAD detected silence, discard the window
 * - "transcribe" — window is ready to send to the STT backend
 */
export function processStreamWindow(
  state: StreamingState,
  audioChunk: Float32Array,
  timestampMs: number,
  config: StreamConfig,
): { state: StreamingState; action: WindowAction } {
  const chunkDurationMs =
    audioChunk.length > 0 ? (audioChunk.length / 16000) * 1000 : 0;

  const newBuffer: AudioChunkBuffer[] = [
    ...state.buffer,
    { samples: audioChunk, timestampMs, durationMs: chunkDurationMs },
  ];

  // Run VAD on incoming chunk
  const vadConfig: VadConfig = {
    ...DEFAULT_VAD_CONFIG,
    energyThreshold: DEFAULT_VAD_CONFIG.energyThreshold,
  };
  const { state: newVadState } = processVadFrame(
    state.vadState,
    audioChunk,
    vadConfig,
  );

  const bufferedMs = getBufferedDurationMs(newBuffer);

  // Not enough audio yet — keep buffering
  if (bufferedMs < config.windowSizeMs) {
    return {
      state: {
        ...state,
        isStreaming: true,
        buffer: newBuffer,
        vadState: newVadState,
      },
      action: "wait",
    };
  }

  // Window is full — decide whether to transcribe or skip
  if (config.vadEnabled && !newVadState.isSpeaking) {
    // Silence: discard the window but keep the overlap portion
    const overlapBuffer = trimBufferToOverlap(newBuffer, config.overlapMs);
    return {
      state: {
        ...state,
        isStreaming: true,
        windowIndex: state.windowIndex + 1,
        lastProcessedMs: timestampMs + chunkDurationMs,
        buffer: overlapBuffer,
        vadState: newVadState,
      },
      action: "skip",
    };
  }

  // Speech detected (or VAD disabled): emit the window for transcription
  const overlapBuffer = trimBufferToOverlap(newBuffer, config.overlapMs);
  return {
    state: {
      ...state,
      isStreaming: true,
      windowIndex: state.windowIndex + 1,
      lastProcessedMs: timestampMs + chunkDurationMs,
      buffer: overlapBuffer,
      vadState: newVadState,
    },
    action: "transcribe",
  };
}

/**
 * Keep only the tail of the buffer whose total duration is <= overlapMs.
 */
function trimBufferToOverlap(
  buffer: AudioChunkBuffer[],
  overlapMs: number,
): AudioChunkBuffer[] {
  if (overlapMs <= 0) return [];

  const result: AudioChunkBuffer[] = [];
  let accumulatedMs = 0;

  for (let i = buffer.length - 1; i >= 0; i--) {
    const chunk = buffer[i]!;
    if (accumulatedMs + chunk.durationMs > overlapMs) break;
    accumulatedMs += chunk.durationMs;
    result.unshift(chunk);
  }

  return result;
}

// ── Overlap deduplication ───────────────────────────────────────────

/**
 * Compute a simple word-overlap similarity ratio between two strings.
 * Returns a value between 0 (no overlap) and 1 (identical word sets).
 */
export function computeTextSimilarity(a: string, b: string): number {
  const wordsA = a
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordsB = b
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (wordsA.length === 0 && wordsB.length === 0) return 1;
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Merge a sequence of possibly-overlapping FinalTranscript results.
 * Adjacent results whose trailing/leading words are highly similar are
 * merged to avoid duplicate text in the final output.
 */
export function mergeOverlappingResults(
  results: FinalTranscript[],
): FinalTranscript[] {
  if (results.length === 0) return [];

  const sorted = [...results].sort((a, b) => a.startMs - b.startMs);
  const merged: FinalTranscript[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = sorted[i]!;

    // Check if there is a time overlap
    const isOverlapping = curr.startMs < prev.endMs;

    if (isOverlapping) {
      const prevWords = prev.text.split(/\s+/);
      const currWords = curr.text.split(/\s+/);

      // Find the best overlap point
      const overlapIndex = findBestOverlapIndex(prevWords, currWords);

      if (overlapIndex > 0) {
        // Merge: take prev text + non-overlapping portion of curr
        const mergedText =
          prev.text + " " + currWords.slice(overlapIndex).join(" ");
        const lang = prev.language ?? curr.language;
        merged[merged.length - 1] = {
          ...prev,
          text: mergedText.trim(),
          endMs: Math.max(prev.endMs, curr.endMs),
          ...(lang ? { language: lang } : {}),
        };
      } else {
        // High similarity — likely duplicate, keep the longer one
        const similarity = computeTextSimilarity(prev.text, curr.text);
        if (similarity > 0.7) {
          merged[merged.length - 1] = {
            ...(prev.text.length >= curr.text.length ? prev : curr),
            startMs: Math.min(prev.startMs, curr.startMs),
            endMs: Math.max(prev.endMs, curr.endMs),
          };
        } else {
          merged.push(curr);
        }
      }
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Find how many leading words of `curr` overlap with trailing words of
 * `prev`.  Returns the number of overlapping words from the start of
 * `curr` that should be skipped.
 */
function findBestOverlapIndex(prev: string[], curr: string[]): number {
  const maxCheck = Math.min(prev.length, curr.length, 10);

  for (let overlapLen = maxCheck; overlapLen >= 2; overlapLen--) {
    const prevTail = prev.slice(-overlapLen).map((w) => w.toLowerCase());
    const currHead = curr.slice(0, overlapLen).map((w) => w.toLowerCase());

    let matchCount = 0;
    for (let j = 0; j < overlapLen; j++) {
      if (prevTail[j] === currHead[j]) matchCount++;
    }

    if (matchCount / overlapLen >= 0.8) {
      return overlapLen;
    }
  }

  return 0;
}

// ── Summary ─────────────────────────────────────────────────────────

export type StreamingSummary = {
  totalSegments: number;
  totalDurationMs: number;
  averageLatencyMs: number;
  languagesDetected: string[];
};

/**
 * Build a high-level summary from a list of finalized transcript results.
 */
export function buildStreamingSummary(
  results: FinalTranscript[],
): StreamingSummary {
  if (results.length === 0) {
    return {
      totalSegments: 0,
      totalDurationMs: 0,
      averageLatencyMs: 0,
      languagesDetected: [],
    };
  }

  const totalDurationMs = results.reduce((max, r) => Math.max(max, r.endMs), 0);

  // Average latency = average window duration (endMs - startMs)
  const totalLatency = results.reduce(
    (sum, r) => sum + (r.endMs - r.startMs),
    0,
  );
  const averageLatencyMs = Math.round(totalLatency / results.length);

  const languagesDetected = [
    ...new Set(results.map((r) => r.language).filter(Boolean) as string[]),
  ];

  return {
    totalSegments: results.length,
    totalDurationMs,
    averageLatencyMs,
    languagesDetected,
  };
}
