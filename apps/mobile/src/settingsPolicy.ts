import type { CompanionSettings } from "./domain";
import { keepsHistory } from "./domain";
import type { Strings } from "./i18n";

type HistorySettings = Pick<CompanionSettings, "saveHistory" | "privacyLevel">;

/** A settings change that deletes the notes saved on the phone. */
export interface HistoryOffConfirmation {
  /** ephemeral: the privacy level goes to Ephemeral; historyOff: Save history goes off. */
  kind: "historyOff" | "ephemeral";
  /** The notes the screen knows of. */
  count: number;
  /**
   * Some saved notes could not be read (storageDegraded), so `count` is not
   * the number that will be deleted.
   */
  notesUnread?: true;
}

/**
 * Turning Save history off or choosing Ephemeral deletes every saved note
 * (store.updateSettings). Returns what to ask before such a change, or null
 * when nothing saved would be lost (data-4, ux-7).
 */
export function historyOffConfirmation(
  previous: HistorySettings,
  next: HistorySettings,
  noteCount: number,
  notesUnread = false,
): HistoryOffConfirmation | null {
  if (!keepsHistory(previous) || keepsHistory(next)) return null;
  if (noteCount <= 0 && !notesUnread) return null;
  const kind =
    next.privacyLevel === "ephemeral" && previous.privacyLevel !== "ephemeral"
      ? "ephemeral"
      : "historyOff";
  return notesUnread
    ? { kind, count: noteCount, notesUnread: true }
    : { kind, count: noteCount };
}

/**
 * The confirmation question. With notes that could not be read, the count
 * is unknown, so the question names no number.
 */
export function historyOffTitle(
  t: Strings,
  confirmation: HistoryOffConfirmation,
): string {
  if (confirmation.notesUnread) return t.errorBoundary.deleteNotesConfirm;
  return confirmation.kind === "ephemeral"
    ? t.settings.ephemeralConfirm(confirmation.count)
    : t.settings.historyOffConfirm(confirmation.count);
}

/**
 * Clear history: null when there is nothing to delete (the button is then
 * disabled), otherwise the question to ask.
 */
export function clearHistoryTitle(
  t: Strings,
  noteCount: number,
  notesUnread = false,
): string | null {
  if (notesUnread) return t.errorBoundary.deleteNotesConfirm;
  return noteCount > 0 ? t.settings.clearHistoryConfirm(noteCount) : null;
}

/** https://, a host, then an optional path, query or fragment; no spaces. */
const HTTPS_URL = /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

/**
 * The value when it is an https:// URL, otherwise null. The app opens the
 * privacy policy only from such a URL (security-5). A pattern rather than
 * `new URL`: React Native's URL never throws.
 */
export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HTTPS_URL.test(trimmed) ? trimmed : null;
}
