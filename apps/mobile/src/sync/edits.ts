import type { Hlc } from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";

/**
 * Local changes to notes, as sync sees them (store.ts). Pure, for tests.
 *
 * Every local create, edit, refine and pin stores a new HLC with the note
 * (sync-core's stamp), so the change wins over the version it replaced on
 * every device. A delete the user makes sends a tombstone; retention and
 * the recovery screen's clear do not. Builds without a sync server never
 * stamp.
 */

/** sync-core's stamp: a new HLC later than `previous`; null when this build has no sync. */
export type Stamp = ((previous?: Hlc) => Hlc) | null;

/** The note as changed here, with its new HLC. */
export function stampTurn(turn: TranscriptTurn, stamp: Stamp): TranscriptTurn {
  return stamp ? { ...turn, hlc: stamp(turn.hlc) } : turn;
}

/** A history change the store saves, with the note as saved. */
export interface NoteEdit {
  history: TranscriptTurn[];
  turn: TranscriptTurn;
}

/** A capture or a typed note: first in the history, with a new HLC. */
export function addNote(
  history: readonly TranscriptTurn[],
  turn: TranscriptTurn,
  stamp: Stamp,
): NoteEdit {
  const stamped = stampTurn(turn, stamp);
  return { history: [stamped, ...history], turn: stamped };
}

/** An edit, a refine or a pin: the note in place, with a new HLC. */
export function changeNote(
  history: readonly TranscriptTurn[],
  turn: TranscriptTurn,
  stamp: Stamp,
): NoteEdit {
  const stamped = stampTurn(turn, stamp);
  return {
    history: history.map((item) => (item.id === stamped.id ? stamped : item)),
    turn: stamped,
  };
}

/**
 * Who a delete is for: "everywhere" for a note's Delete and Settings'
 * Clear history, "here" for the recovery screen's (this phone only).
 */
export type DeleteScope = "everywhere" | "here";

/** A delete for sync to send (sync-core recordDeletes): the note and its HLC. */
export interface Tombstone {
  id: string;
  hlc?: Hlc | undefined;
}

/**
 * Notes the user deletes: the history without them, and the tombstones
 * sync records before they go, so a run that starts meanwhile does not
 * upload them. Retention never comes here: a note past the limit leaves
 * this phone only, and the other devices keep it.
 */
export function deleteNotes(
  history: readonly TranscriptTurn[],
  ids: readonly string[] | "all",
  scope: DeleteScope,
): { history: TranscriptTurn[]; tombstones: Tombstone[] } {
  const gone = ids === "all" ? null : new Set(ids);
  const kept: TranscriptTurn[] = [];
  const removed: TranscriptTurn[] = [];
  for (const turn of history) {
    if (gone === null || gone.has(turn.id)) removed.push(turn);
    else kept.push(turn);
  }
  return {
    history: kept,
    tombstones:
      scope === "everywhere" ? removed.map(({ id, hlc }) => ({ id, hlc })) : [],
  };
}

const dateOf = (turn: TranscriptTurn) => {
  const ms = Date.parse(turn.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * The history (newest first) with `put` shown and `remove` gone. A note
 * already there is replaced where it is; a new one (from another device,
 * or a conflict copy) goes where its date puts it.
 */
export function placeNotes(
  history: readonly TranscriptTurn[],
  put: readonly TranscriptTurn[] = [],
  remove: readonly string[] = [],
): TranscriptTurn[] {
  const removed = new Set(remove);
  const replacing = new Map(put.map((turn) => [turn.id, turn]));
  const next: TranscriptTurn[] = [];
  for (const turn of history) {
    if (removed.has(turn.id) && !replacing.has(turn.id)) continue;
    const replacement = replacing.get(turn.id);
    if (replacement) {
      next.push(replacement);
      replacing.delete(turn.id);
    } else next.push(turn);
  }
  for (const turn of replacing.values()) {
    const date = dateOf(turn);
    const at = next.findIndex((other) => dateOf(other) < date);
    if (at < 0) next.push(turn);
    else next.splice(at, 0, turn);
  }
  return next;
}
