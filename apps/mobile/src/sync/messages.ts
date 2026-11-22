import { PairingError, isSyncError } from "@sonolect/sync-core";

import type { Strings } from "../i18n";
import type { SyncView } from "./controller";

/**
 * What the Sync section says, in plain words: the README's table of errors
 * and what to tell the user (packages/sync-core/README.md).
 */

/** Why a pasted or scanned code was refused. */
export function pairingErrorText(t: Strings, error: unknown): string {
  if (!(error instanceof PairingError)) return t.sync.pairingErrors.invalid;
  switch (error.code) {
    case "invalid":
      return t.sync.pairingErrors.invalid;
    case "version":
      return t.sync.pairingErrors.version;
    case "typo":
      return t.sync.pairingErrors.typo;
    default:
      // length, character
      return t.sync.pairingErrors.length;
  }
}

/**
 * The lines under the Sync heading: what sync is doing, then what went
 * wrong or why it waits. A rate limit says nothing.
 */
export function syncStatusLines(
  t: Strings,
  view: SyncView,
  formatTime: (ms: number) => string,
): { status: string | null; problem: string | null } {
  const problem = view.problem
    ? t.sync.problems[view.problem]
    : view.paused
      ? t.sync.paused[view.paused]
      : null;
  if (view.status !== "on") return { status: null, problem };
  const status = view.syncing
    ? t.sync.syncing
    : view.lastSyncAt !== undefined
      ? t.sync.lastSync(formatTime(view.lastSyncAt))
      : t.sync.never;
  return { status, problem };
}

/** Why turning sync on or joining failed. */
export function actionErrorText(t: Strings, error: unknown): string {
  if (!isSyncError(error)) return t.sync.problems.server;
  switch (error.kind) {
    case "network":
      return t.sync.problems.network;
    case "unauthorized":
      return t.sync.problems.unauthorized;
    case "gone":
      return t.sync.problems.deleted;
    case "tooLarge":
      return t.sync.problems.tooLarge;
    default:
      // server, rateLimited
      return t.sync.problems.server;
  }
}
