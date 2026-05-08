/**
 * Typed navigation helpers for expo-router tab screens.
 *
 * Screen names match the file-based routes under app/(tabs)/.
 */
export const SCREEN_NAMES = {
  Home: "/(tabs)",
  Dictionary: "/(tabs)/dictionary",
  Snippets: "/(tabs)/snippets",
  Search: "/(tabs)/search",
  Settings: "/(tabs)/settings",
} as const;

export type ScreenName = keyof typeof SCREEN_NAMES;
export type ScreenRoute = (typeof SCREEN_NAMES)[ScreenName];

/** Params accepted by each screen (currently none require params). */
export type ScreenParams = {
  Home: undefined;
  Dictionary: undefined;
  Snippets: undefined;
  Search: { query?: string } | undefined;
  Settings: undefined;
};
