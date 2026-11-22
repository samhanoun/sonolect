import { Redirect } from "expo-router";

/**
 * A link to a path the app doesn't have (sonolect://note/123, a typo) opens
 * Capture instead of expo-router's developer "Unmatched Route" screen. So
 * does sonolect://sync/join: no screen reads a sync key from a link, the
 * code is scanned or typed in Settings.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
