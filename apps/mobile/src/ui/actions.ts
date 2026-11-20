import * as Clipboard from "expo-clipboard";
import { Alert, Platform, Share } from "react-native";

import type { Strings } from "../i18n";

/**
 * Copy and share for the Capture and Library screens. A failure is said
 * out loud instead of swallowed (data-14); dismissing the share sheet is
 * not a failure.
 */

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

/** Opens the share sheet with text; false when it could not open. */
export async function shareText(text: string, t: Strings): Promise<boolean> {
  try {
    await Share.share({ message: text });
    return true;
  } catch (error) {
    if (!isShareDismissal(error)) showFailure(t.capture.shareFailed);
    return false;
  }
}
