/**
 * Where a note's Share button sends it. A phone always has a share sheet.
 * In a browser, react-native-web's Share needs the Web Share API
 * (navigator.share), which Firefox, Chrome on Linux and pages served over
 * plain http lack; there the button saves the note as a text file instead
 * of failing.
 */
export type ShareTarget = "sheet" | "download";

export function shareTarget(
  platform: string,
  browserNavigator: { share?: unknown } | undefined,
): ShareTarget {
  if (platform !== "web") return "sheet";
  return typeof browserNavigator?.share === "function" ? "sheet" : "download";
}

const errorName = (error: unknown): unknown =>
  typeof error === "object" && error !== null
    ? (error as { name?: unknown }).name
    : undefined;

/** The share dialog rejects with AbortError when the user dismisses it. */
export function isShareDismissal(error: unknown): boolean {
  return errorName(error) === "AbortError";
}

/**
 * What a share that failed does: nothing when the user dismissed the
 * dialog, or when a dialog is still open, which a second click while it
 * shows meets with InvalidStateError. A browser that has a share dialog
 * may still refuse to open it, with NotAllowedError in a frame without
 * allow="web-share": the note is then saved as a text file, as where there
 * is no dialog. A phone says the share sheet could not open.
 */
export function afterShareFailure(
  platform: string,
  error: unknown,
): "dismissed" | "download" | "alert" {
  if (isShareDismissal(error) || errorName(error) === "InvalidStateError") {
    return "dismissed";
  }
  return platform === "web" ? "download" : "alert";
}
