import type { TranscriptSegment } from "./segmentEditor";

export type TranscriptUndoSnapshot = {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  selectedSegmentIds: string[];
};

export type TranscriptUndoStack = {
  push: (snapshot: TranscriptUndoSnapshot) => void;
  reset: (snapshot: TranscriptUndoSnapshot) => void;
  undo: () => TranscriptUndoSnapshot | null;
  redo: () => TranscriptUndoSnapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  current: () => TranscriptUndoSnapshot;
};

const DEFAULT_LIMIT = 100;

export function createTranscriptUndoStack(
  initialSnapshot: TranscriptUndoSnapshot,
  limit = DEFAULT_LIMIT,
): TranscriptUndoStack {
  let past: TranscriptUndoSnapshot[] = [];
  let present = cloneSnapshot(initialSnapshot);
  let future: TranscriptUndoSnapshot[] = [];

  return {
    push(snapshot) {
      const next = cloneSnapshot(snapshot);
      if (snapshotKey(next) === snapshotKey(present)) return;
      past = [...past, present].slice(-Math.max(1, limit));
      present = next;
      future = [];
    },
    reset(snapshot) {
      past = [];
      present = cloneSnapshot(snapshot);
      future = [];
    },
    undo() {
      const previous = past.at(-1);
      if (!previous) return null;
      past = past.slice(0, -1);
      future = [present, ...future];
      present = cloneSnapshot(previous);
      return cloneSnapshot(present);
    },
    redo() {
      const next = future[0];
      if (!next) return null;
      future = future.slice(1);
      past = [...past, present].slice(-Math.max(1, limit));
      present = cloneSnapshot(next);
      return cloneSnapshot(present);
    },
    canUndo() {
      return past.length > 0;
    },
    canRedo() {
      return future.length > 0;
    },
    current() {
      return cloneSnapshot(present);
    },
  };
}

function cloneSnapshot(
  snapshot: TranscriptUndoSnapshot,
): TranscriptUndoSnapshot {
  return {
    transcript: snapshot.transcript,
    transcriptSegments: snapshot.transcriptSegments.map((segment) => ({
      ...segment,
    })),
    selectedSegmentIds: [...snapshot.selectedSegmentIds],
  };
}

function snapshotKey(snapshot: TranscriptUndoSnapshot) {
  return JSON.stringify(snapshot);
}
