import type { Hlc } from "@sonolect/sync-core";

import type { TranscriptTurn } from "../domain";

/**
 * Local changes to notes, as sync sees them (store.ts). Pure, for tests.
 *
 * Every local create, edit, refine and pin stores a new HLC with the note
 * (sync-core's stamp), so the change wins over the version it replaced on
 * every device. Builds without a sync server never stamp.
 */

/** sync-core's stamp: a new HLC later than `previous`; null when this build has no sync. */
export type Stamp = ((previous?: Hlc) => Hlc) | null;

/** The note as changed here, with its new HLC. */
export function stampTurn(turn: TranscriptTurn, stamp: Stamp): TranscriptTurn {
  return stamp ? { ...turn, hlc: stamp(turn.hlc) } : turn;
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
