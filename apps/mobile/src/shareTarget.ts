/**
 * Where a note's Share button sends it. A phone always has a share sheet.
 * In a browser, react-native-web's Share needs the Web Share API
 * (navigator.share), which most desktop browsers lack; there the button
 * saves the note as a text file instead of failing.
 */
export type ShareTarget = "sheet" | "download";

export function shareTarget(
  platform: string,
  browserNavigator: { share?: unknown } | undefined,
): ShareTarget {
  if (platform !== "web") return "sheet";
  return typeof browserNavigator?.share === "function" ? "sheet" : "download";
}
