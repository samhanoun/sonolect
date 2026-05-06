import React from "react";
import type { RecordingState } from "./recordingStateMachine";
import { formatDuration } from "./recordingStateMachine";

// ── Persistence key for draggable position ─────────────────────────
export const POSITION_STORAGE_KEY = "sonolect.floatingRecorderPosition";

export type FloatingRecorderPosition = { x: number; y: number };

export function loadPosition(): FloatingRecorderPosition {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return { x: 16, y: 16 };
    const parsed = JSON.parse(raw) as Partial<FloatingRecorderPosition>;
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // Corrupt or unavailable – fall back.
  }
  return { x: 16, y: 16 };
}

export function savePosition(pos: FloatingRecorderPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // Quota exceeded or unavailable – silently ignore.
  }
}

// ── Waveform bar helpers ───────────────────────────────────────────
export const DEFAULT_WAVEFORM_BAR_COUNT = 24;

export function waveformBarHeights(
  peaks: number[],
  minHeight = 2,
  maxHeight = 32,
): number[] {
  return peaks.map(
    (peak) => minHeight + Math.round(peak * (maxHeight - minHeight)),
  );
}

// ── Recording state label mapping ──────────────────────────────────
export function recordingStateLabel(state: RecordingState): string {
  const labels: Record<RecordingState, string> = {
    idle: "Ready",
    countdown: "Starting…",
    recording: "Recording",
    processing: "Processing…",
    previewing: "Preview",
    inserting: "Inserting…",
    done: "Done",
    error: "Error",
  };
  return labels[state];
}

// ── Props type for the overlay component ───────────────────────────
export type FloatingRecorderProps = {
  recordingState: RecordingState;
  durationMs: number;
  waveformPeaks: number[];
  polishedPreview: string | null;
  minimized: boolean;
  onCancel: () => void;
  onFinish: () => void;
  onInsert: () => void;
  onMinimize: () => void;
};

// ── React overlay component ────────────────────────────────────────
export function FloatingRecorderOverlay({
  recordingState,
  durationMs,
  waveformPeaks,
  polishedPreview,
  minimized,
  onCancel,
  onFinish,
  onInsert,
  onMinimize,
}: FloatingRecorderProps) {
  const label = recordingStateLabel(recordingState);
  const timer = formatDuration(durationMs);
  const barHeights = waveformBarHeights(waveformPeaks);

  if (minimized) {
    return (
      <div
        className="floating-recorder floating-recorder--pill"
        role="status"
        aria-label="Floating recorder (minimized)"
        aria-live="polite"
        onClick={onMinimize}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onMinimize();
          }
        }}
        tabIndex={0}
      >
        <span className="floating-recorder__status-dot" aria-hidden="true" />
        <span className="floating-recorder__timer">{timer}</span>
      </div>
    );
  }

  return (
    <div
      className="floating-recorder floating-recorder--expanded"
      role="region"
      aria-label="Floating recorder"
    >
      <div className="floating-recorder__header">
        <span className="floating-recorder__label" aria-live="polite">{label}</span>
        <span className="floating-recorder__timer" aria-live="off">{timer}</span>
        <button
          className="floating-recorder__btn floating-recorder__btn--minimize"
          aria-label="Minimize recorder"
          onClick={onMinimize}
        >
          &ndash;
        </button>
      </div>

      {recordingState === "recording" && (
        <div
          className="floating-recorder__waveform"
          role="img"
          aria-label="Waveform visualization"
        >
          {barHeights.map((height, index) => (
            <span
              key={index}
              className="floating-recorder__waveform-bar"
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
      )}

      {recordingState === "previewing" && polishedPreview !== null && (
        <div className="floating-recorder__preview" aria-label="Polished preview">
          {polishedPreview}
        </div>
      )}

      <div className="floating-recorder__actions">
        {(recordingState === "recording" ||
          recordingState === "countdown" ||
          recordingState === "processing") && (
          <>
            <button
              className="floating-recorder__btn floating-recorder__btn--cancel"
              aria-label="Cancel recording"
              onClick={onCancel}
            >
              ✕
            </button>
            {recordingState === "recording" && (
              <button
                className="floating-recorder__btn floating-recorder__btn--finish"
                aria-label="Finish recording"
                onClick={onFinish}
              >
                ✓
              </button>
            )}
          </>
        )}
        {recordingState === "previewing" && (
          <>
            <button
              className="floating-recorder__btn floating-recorder__btn--cancel"
              aria-label="Cancel recording"
              onClick={onCancel}
            >
              ✕
            </button>
            <button
              className="floating-recorder__btn floating-recorder__btn--insert"
              aria-label="Insert text"
              onClick={onInsert}
            >
              Insert
            </button>
          </>
        )}
      </div>
    </div>
  );
}
