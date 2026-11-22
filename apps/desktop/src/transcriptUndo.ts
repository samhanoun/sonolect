import type { TranscriptSegment } from "./segmentEditor";

/** A saved recording at one version (the store's `OpenedVersion`). */
export type SnapshotVersion = {
  id: string;
  hlc: { t: number; c: number; d: string } | null;
};

export type TranscriptUndoSnapshot = {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  selectedSegmentIds: string[];
  /**
   * The version of the saved recording the editor had opened, which a save
   * of this text compares with. Undo and redo bring it back with the text,
   * but it does not make a step of its own.
   */
  openedVersion?: SnapshotVersion | null;
};

export type TranscriptUndoStack = {
  push: (snapshot: TranscriptUndoSnapshot) => void;
  reset: (snapshot: TranscriptUndoSnapshot) => void;
  /** Changes every snapshot, past, present and future, with `change`. */
  rewrite: (
    change: (snapshot: TranscriptUndoSnapshot) => TranscriptUndoSnapshot,
  ) => void;
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
      // The same text is no new step, but it may come with a newer version.
      if (snapshotKey(next) === snapshotKey(present)) {
        present = next;
        return;
      }
      past = [...past, present].slice(-Math.max(1, limit));
      present = next;
      future = [];
    },
    reset(snapshot) {
      past = [];
      present = cloneSnapshot(snapshot);
      future = [];
    },
    rewrite(change) {
      const changed = (snapshot: TranscriptUndoSnapshot) =>
        cloneSnapshot(change(cloneSnapshot(snapshot)));
      past = past.map(changed);
      present = changed(present);
      future = future.map(changed);
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
  const { openedVersion } = snapshot;
  return {
    transcript: snapshot.transcript,
    transcriptSegments: snapshot.transcriptSegments.map((segment) => ({
      ...segment,
    })),
    selectedSegmentIds: [...snapshot.selectedSegmentIds],
    ...(openedVersion !== undefined
      ? {
          openedVersion: openedVersion && {
            id: openedVersion.id,
            hlc: openedVersion.hlc && { ...openedVersion.hlc },
          },
        }
      : {}),
  };
}

/** What makes a step: the text and the selection, not the version. */
function snapshotKey(snapshot: TranscriptUndoSnapshot) {
  return JSON.stringify([
    snapshot.transcript,
    snapshot.transcriptSegments,
    snapshot.selectedSegmentIds,
  ]);
}

/** Marks the transcript's own editors, where Ctrl+Z undoes the transcript. */
export const TRANSCRIPT_EDITOR_ATTRIBUTE = "data-transcript-editor";

/** Inputs that take no typing, so they have no undo of their own. */
const UNTYPED_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** The parts of the focused element that decide where undo goes. */
export type UndoTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

/** The parts of a key press that decide what an undo shortcut does. */
export type UndoKeyPress = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey"
> & {
  target: unknown;
};

/**
 * Whether the focused element takes typing, and so undoes its own. A
 * checkbox, a button or a list to pick from does not.
 */
function takesTyping(target: UndoTarget): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  return (
    tag === "input" &&
    !UNTYPED_INPUTS.has((target.type || "text").toLowerCase())
  );
}

/**
 * What an undo or redo shortcut (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, or Cmd on
 * macOS) does to the transcript. Pressed in one of the transcript's editors,
 * or while the transcript is on screen with nothing that takes typing in
 * focus, it undoes or redoes the transcript. Pressed in any other field
 * that takes typing, it does nothing here, so that field undoes its own.
 */
export function transcriptUndoAction(
  event: UndoKeyPress,
  transcriptShown: boolean,
): "undo" | "redo" | undefined {
  if (!event.ctrlKey && !event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  const action =
    key === "z"
      ? event.shiftKey
        ? "redo"
        : "undo"
      : key === "y"
        ? "redo"
        : undefined;
  if (!action) return undefined;
  const target = event.target as UndoTarget | null;
  if (target && takesTyping(target))
    return typeof target.closest === "function" &&
      target.closest(`[${TRANSCRIPT_EDITOR_ATTRIBUTE}]`)
      ? action
      : undefined;
  return transcriptShown ? action : undefined;
}
