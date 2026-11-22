import {
  type LocalNoteSummary,
  type NoteStore,
  localMatches,
} from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";
import type { NoteWrite } from "../storageCore";
import { placeNotes } from "./edits";
import { noteToTurn, parseCompanion, turnToNote } from "./noteMapping";

/**
 * sync-core's NoteStore over the phone's notes: the engine reads the notes
 * the app shows and writes remote changes through the app's storage.
 *
 * A remote change is written to storage first, then shown, and only if
 * the notes did not change meanwhile. A save the app started during the
 * write comes after it and writes the notes the app shows, so a note the
 * user edited keeps the user's version; the engine then tries again on its
 * next run.
 */
export interface SyncNotesHost {
  /**
   * The notes that sync: what the phone shows, or none while history is
   * off. A new array whenever a note changes, never changed in place.
   */
  notes(): readonly TranscriptTurn[];
  /** A note's companion value (storageCore SYNC_COMPANION_PREFIX). */
  readCompanion(id: string): Promise<string | null>;
  /** Writes notes with their companions, and removes notes (storageCore NoteStore.apply). */
  write(change: {
    put?: readonly NoteWrite[];
    remove?: readonly string[];
  }): Promise<void>;
  /** Shows written notes, and stops showing removed ones. */
  show(change: {
    put?: readonly TranscriptTurn[];
    remove?: readonly string[];
  }): void;
  /** Bumped when the notes are wiped: a write started before a wipe is not shown. */
  generation(): number;
  now(): number;
}

/** The notes changed or were wiped while sync wrote one: the engine tries again on its next run. */
export class NotesChangedError extends Error {
  constructor() {
    super("the notes changed while sync was writing");
    this.name = "NotesChangedError";
  }
}

export function createSyncNoteStore(host: SyncNotesHost): NoteStore {
  let indexed: {
    notes: readonly TranscriptTurn[];
    byId: Map<string, TranscriptTurn>;
  } | null = null;
  /** The note with this id (the store's history is replaced, never changed in place). */
  const find = (id: string): TranscriptTurn | undefined => {
    const notes = host.notes();
    if (indexed?.notes !== notes)
      indexed = { notes, byId: new Map(notes.map((turn) => [turn.id, turn])) };
    return indexed.byId.get(id);
  };

  return {
    async list(): Promise<LocalNoteSummary[]> {
      return host.notes().map((turn) => {
        const created = Date.parse(turn.createdAt);
        return {
          id: turn.id,
          hlc: turn.hlc,
          createdAtMs: Number.isFinite(created) ? created : 0,
        };
      });
    },

    async read(id) {
      if (!find(id)) return undefined;
      const companion = parseCompanion(await host.readCompanion(id));
      const turn = find(id);
      if (!turn) return undefined;
      return { note: turnToNote(turn, companion), hlc: turn.hlc };
    },

    async applyRemote(change) {
      const shown = host.notes();
      const before = find(change.id);
      if (!localMatches(before, change.expected)) return false;
      const generation = host.generation();
      let written: TranscriptTurn | null = null;
      if (change.note === null) {
        await host.write({ remove: [change.id] });
      } else {
        const { turn, companion } = noteToTurn(
          change.id,
          change.note,
          change.hlc,
          host.now(),
          before,
        );
        await host.write({ put: [{ note: turn, companion }] });
        written = turn;
      }
      // Changed or wiped while writing: what the app shows stays, and its
      // save (queued after this write) puts it back in storage.
      if (host.notes() !== shown || host.generation() !== generation)
        return false;
      host.show(written ? { put: [written] } : { remove: [change.id] });
      return true;
    },

    async saveConflictCopy(id, note, hlc) {
      const shown = host.notes();
      const generation = host.generation();
      const { turn, companion } = noteToTurn(
        id,
        note,
        hlc,
        host.now(),
        find(id),
      );
      await host.write({ put: [{ note: turn, companion }] });
      // A save queued meanwhile removes the copy again: the next run saves it.
      if (host.notes() !== shown || host.generation() !== generation)
        throw new NotesChangedError();
      host.show({ put: [turn] });
    },
  };
}

/** What the app shows, as the sync host needs it (store.ts). */
export interface AppNotes {
  /** The notes, newest first. */
  history: readonly TranscriptTurn[];
  /** The latest capture, shown on the Capture screen. */
  latest?: TranscriptTurn | undefined;
  /** False while history is off or some notes could not be read: nothing syncs. */
  writable: boolean;
}

export interface NotesHostOptions {
  read(): AppNotes;
  update(patch: {
    history: TranscriptTurn[];
    latest?: TranscriptTurn | undefined;
  }): void;
  /** storageCore NoteStore.apply. */
  apply(change: {
    put?: readonly NoteWrite[];
    remove?: readonly string[];
  }): Promise<void>;
  readCompanion(id: string): Promise<string | null>;
  generation(): number;
  now(): number;
  /** Notes another device deleted: a read-aloud of one stops. */
  onRemoved?(ids: readonly string[]): void;
}

const NO_NOTES: readonly TranscriptTurn[] = [];

/** The SyncNotesHost of the app's store. */
export function createNotesHost(options: NotesHostOptions): SyncNotesHost {
  return {
    notes: () => {
      const state = options.read();
      return state.writable ? state.history : NO_NOTES;
    },
    readCompanion: (id) => options.readCompanion(id),
    async write(change) {
      if (!options.read().writable) throw new NotesChangedError();
      await options.apply(change);
    },
    show({ put = [], remove = [] }) {
      const { history, latest } = options.read();
      const replaced = latest && put.find((turn) => turn.id === latest.id);
      const gone = latest !== undefined && remove.includes(latest.id);
      options.update({
        history: placeNotes(history, put, remove),
        ...(replaced
          ? { latest: replaced }
          : gone
            ? { latest: undefined }
            : {}),
      });
      if (remove.length > 0) options.onRemoved?.(remove);
    },
    generation: () => options.generation(),
    now: () => options.now(),
  };
}
