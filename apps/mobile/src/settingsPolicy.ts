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

/** A deletion confirmation: a short question, then what it deletes. */
export interface ConfirmPrompt {
  /**
   * Kept short: react-native's Android Alert shows at most two lines of
   * its title and cuts the rest (alert_title_layout.xml is singleLine with
   * ellipsize end, and DialogTitle.onMeasure only raises maxLines to 2).
   */
  title: string;
  /** Shown in full on every platform: the count goes here. */
  message: string;
}

/**
 * What the confirmation deletes. With notes that could not be read, the
 * count is unknown, so the message names no number.
 */
function deletionMessage(
  t: Strings,
  count: number,
  notesUnread: boolean,
): string {
  return notesUnread
    ? t.errorBoundary.deleteNotesMessage
    : t.settings.deleteNotesMessage(count);
}

/** The confirmation to show for a HistoryOffConfirmation. */
export function historyOffPrompt(
  t: Strings,
  confirmation: HistoryOffConfirmation,
): ConfirmPrompt {
  return {
    title:
      confirmation.kind === "ephemeral"
        ? t.settings.ephemeralTitle
        : t.settings.historyOffTitle,
    message: deletionMessage(
      t,
      confirmation.count,
      confirmation.notesUnread === true,
    ),
  };
}

/**
 * Clear history: null when there is nothing to delete (the button is then
 * disabled), otherwise the confirmation to show.
 */
export function clearHistoryPrompt(
  t: Strings,
  noteCount: number,
  notesUnread = false,
): ConfirmPrompt | null {
  if (noteCount <= 0 && !notesUnread) return null;
  return {
    title: t.settings.clearHistoryTitle,
    message: deletionMessage(t, noteCount, notesUnread),
  };
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
