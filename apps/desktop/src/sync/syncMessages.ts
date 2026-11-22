/**
 * What sync says to the user, in plain words: each problem, notice and
 * pairing error maps to one sentence of the locale files.
 */
import { PairingError, isSyncError } from "@sonolect/sync-core";

import type { Translator } from "../i18n";
import { localizeNativeMessage } from "../nativeMessages";
import type { SyncNotices, SyncProblem } from "./syncController";

export function syncProblemText(problem: SyncProblem, t: Translator): string {
  switch (problem.kind) {
    case "unauthorized":
      return t("studio.sync.error.unauthorized");
    case "deleted":
      return t("studio.sync.error.deleted");
    case "tooLarge":
      return t("studio.sync.error.tooLarge");
    case "server":
      return t("studio.sync.error.server");
    case "offline":
      return t("studio.sync.error.offline");
    case "device":
      return localizeNativeMessage(problem.detail, t);
  }
}

/** The notices to show, in order. */
export function syncNoticeTexts(notices: SyncNotices, t: Translator): string[] {
  const texts: string[] = [];
  if (notices.quotaExceeded) texts.push(t("studio.sync.notice.quota"));
  if (notices.tooLarge) texts.push(t("studio.sync.error.tooLarge"));
  if (notices.newerSchema) texts.push(t("studio.sync.notice.newerSchema"));
  return texts;
}

/** Why a code could not be used, or why turning sync on or off failed. */
export function syncActionErrorText(error: unknown, t: Translator): string {
  if (error instanceof PairingError) {
    switch (error.code) {
      case "invalid":
        return t("studio.sync.pairing.invalid");
      case "version":
        return t("studio.sync.pairing.version");
      case "typo":
        return t("studio.sync.pairing.typo");
      case "length":
      case "character":
        return t("studio.sync.pairing.length");
    }
  }
  if (isSyncError(error)) {
    switch (error.kind) {
      case "network":
        return t("studio.sync.error.offline");
      case "unauthorized":
        return t("studio.sync.error.unauthorized");
      case "gone":
        return t("studio.sync.error.deleted");
      case "tooLarge":
        return t("studio.sync.error.tooLarge");
      default:
        return t("studio.sync.error.server");
    }
  }
  return localizeNativeMessage(
    error instanceof Error ? error.message : String(error),
    t,
  );
}
