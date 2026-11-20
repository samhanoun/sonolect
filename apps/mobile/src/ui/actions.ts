import * as Clipboard from "expo-clipboard";
import { Alert, Linking, Platform, Share } from "react-native";

import type { Strings } from "../i18n";
import { EXPORT_FILE_TYPES, noteFileName } from "../library";
import { shareTarget, type ShareTarget } from "../shareTarget";

/**
 * Copy and share for the Capture and Library screens. A failure is said
 * out loud instead of swallowed (data-14); dismissing the share sheet is
 * not a failure.
 */

/** Settings > Sonolect; react-native-web has no app settings to open. */
export function openAppSettings(): void {
  if (typeof Linking.openSettings !== "function") return;
  void Linking.openSettings().catch(() => undefined);
}

/** Tells the user an action failed: an alert, or the browser's on web. */
export function showFailure(message: string): void {
  if (Platform.OS === "web") {
    // react-native-web's Alert does nothing.
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message);
    }
    return;
  }
  Alert.alert(message);
}

/** Copies text; false, after telling the user, when it could not. */
export async function copyText(text: string, t: Strings): Promise<boolean> {
  try {
    // Web resolves false when the browser refuses; phones always true.
    if (await Clipboard.setStringAsync(text)) return true;
  } catch {
    // Reported below.
  }
  showFailure(t.capture.copyFailed);
  return false;
}

/** The browser's share dialog rejects with AbortError when dismissed. */
export function isShareDismissal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Saves text as a file from a browser (web only). */
export function downloadInBrowser(
  content: string,
  name: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has the data by then; the address is no longer needed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * What a note's Share button does here: open the share sheet, or, in a
 * browser without one, save the note as a text file (its label then says
 * Download).
 */
export function currentShareTarget(): ShareTarget {
  return shareTarget(
    Platform.OS,
    typeof navigator === "undefined" ? undefined : navigator,
  );
}

/**
 * Shares a note's text; false when it could not. In a browser without a
 * share dialog the note is saved as a text file named after createdAt.
 */
export async function shareText(
  text: string,
  t: Strings,
  createdAt?: string,
): Promise<boolean> {
  if (currentShareTarget() === "download") {
    try {
      const date = createdAt ? new Date(createdAt) : new Date();
      downloadInBrowser(
        text,
        noteFileName(Number.isNaN(date.getTime()) ? new Date() : date),
        EXPORT_FILE_TYPES.text.mimeType,
      );
      return true;
    } catch {
      showFailure(t.capture.downloadFailed);
      return false;
    }
  }
  try {
    await Share.share({ message: text });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(t.capture.shareFailed);
    return false;
  }
}
