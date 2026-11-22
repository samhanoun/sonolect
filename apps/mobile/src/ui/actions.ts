import * as Clipboard from "expo-clipboard";
import { Alert, Linking, Platform, Share } from "react-native";

import type { Strings } from "../i18n";
import { EXPORT_FILE_TYPES, noteFileName } from "../library";
import { noteClipboard } from "../noteClipboard";
import {
  afterShareFailure,
  isShareDismissal,
  shareTarget,
  type ShareTarget,
} from "../shareTarget";

export { isShareDismissal };

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

/**
 * Copies a note with its shape (HTML: paragraphs, the Tasks list as a list)
 * and as plain text; false, after telling the user, when it could not. A
 * clipboard that takes no HTML gets the plain text.
 *
 * expo-clipboard 58.0.4 would derive the plain text from the HTML (Android
 * drops list bullets, the web loses line breaks): the web writes both here,
 * and patches/expo-clipboard@58.0.4.patch adds `plainText` on Android and
 * iOS.
 */
export async function copyNote(text: string, t: Strings): Promise<boolean> {
  const { html } = noteClipboard(text);
  if (html) {
    try {
      if (Platform.OS === "web") {
        if (
          typeof ClipboardItem !== "undefined" &&
          typeof navigator !== "undefined" &&
          typeof navigator.clipboard?.write === "function"
        ) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
          return true;
        }
      } else {
        const copied = await Clipboard.setStringAsync(html, {
          inputFormat: Clipboard.StringFormat.HTML,
          plainText: text,
        });
        if (copied) return true;
      }
    } catch {
      // The plain text below.
    }
  }
  return copyText(text, t);
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

/** Saves a note as a text file named after createdAt (web only). */
function downloadNote(text: string, t: Strings, createdAt?: string): boolean {
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

/**
 * Shares a note's text; false when it could not. In a browser without a
 * share dialog, or one that refuses to open it, the note is saved as a
 * text file named after createdAt.
 */
export async function shareText(
  text: string,
  t: Strings,
  createdAt?: string,
): Promise<boolean> {
  if (currentShareTarget() === "download") {
    return downloadNote(text, t, createdAt);
  }
  try {
    await Share.share({ message: text });
    return true;
  } catch (error) {
    switch (afterShareFailure(Platform.OS, error)) {
      case "dismissed":
        return false;
      case "download":
        return downloadNote(text, t, createdAt);
      case "alert":
        showFailure(t.capture.shareFailed);
        return false;
    }
  }
}
