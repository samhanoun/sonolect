import { checkSyncServerUrl } from "@sonolect/sync-core";

import type {
  CompanionSettings,
  RefinementMode,
  TranscriptTurn,
} from "./domain";
import { REFINEMENT_MODES } from "./domain";
import type { MobileLocalApiConfig } from "./localApi";
import { resolveMobileLocalApiConfig } from "./localApi";

/**
 * Phone-only switch. While it is false the app never talks to a Sonolect
 * API: sync, Rewrite and Reply through the API, audio upload and the Settings
 * API section are hidden, and a stored API URL or EXPO_PUBLIC_SONOLECT_API_URL
 * is ignored. The API code stays compiled and tested. Work through "Before
 * turning the API back on" in README.md before setting it to true.
 *
 * Typed as `boolean`, not as a literal, so TypeScript keeps checking the code
 * on both sides of the switch.
 */
export const API_FEATURES_ENABLED: boolean = false;

/**
 * End-to-end encrypted sync between the user's own devices (packages/
 * sync-core) goes through the sync server fixed at build time by
 * EXPO_PUBLIC_SONOLECT_SYNC_URL (config/release.cjs fails a build with a bad
 * one). Without a valid URL, and on web, sync is invisible and the app makes
 * no sync request. It does not depend on API_FEATURES_ENABLED: the sync
 * server only stores ciphertext, and the plaintext API sync stays off.
 *
 * `platform` is Platform.OS (Expo inlines it as process.env.EXPO_OS, which
 * keeps this module free of react-native for the Node tests). `dev` is a
 * development build, which may use plain http to this machine or, from the
 * Android emulator, to its host.
 */
export function syncServerUrlFor(
  raw: string | undefined,
  build: { dev: boolean; platform: string | undefined },
): string | null {
  if (build.platform === "web") return null;
  const check = checkSyncServerUrl(raw, { allowLocalHttp: build.dev });
  return check.ok ? check.url : null;
}

/** The sync server of this build, or null: then the app has no sync. */
export const SYNC_URL: string | null = syncServerUrlFor(
  // Read as written: Expo replaces these expressions when it bundles.
  process.env.EXPO_PUBLIC_SONOLECT_SYNC_URL,
  {
    dev: typeof __DEV__ !== "undefined" && __DEV__,
    platform: process.env.EXPO_OS,
  },
);

/** Refinement modes that need a model on the Sonolect API. */
export const API_ONLY_MODES = [
  "rewrite",
  "reply",
] as const satisfies readonly RefinementMode[];

type ApiSettings = Pick<
  CompanionSettings,
  "cloudSyncEnabled" | "localApiUrl" | "privacyLevel" | "saveHistory"
>;

/** The settings the app acts on: no sync and no API URL while the API is off. */
export function effectiveSettingsFor(
  enabled: boolean,
  settings: CompanionSettings,
): CompanionSettings {
  if (enabled) return settings;
  return { ...settings, cloudSyncEnabled: false, localApiUrl: undefined };
}

/**
 * The single way to reach the Sonolect API. While the API is off it returns
 * an empty config, so every caller sees no apiUrl and takes the local path.
 */
export function apiConfigFor(
  enabled: boolean,
  settings: ApiSettings,
  apiToken?: string,
): MobileLocalApiConfig {
  if (!enabled) return {};
  return resolveMobileLocalApiConfig({ ...settings, apiToken });
}

/**
 * Refinement modes offered after a capture, in display order. Rewrite and
 * Reply also appear once the user has set up online editing with their own
 * key (onlineRefine.ts); each use still asks before sending.
 */
export function availableRefinementModesFor(
  enabled: boolean,
  onlineEditingReady = false,
): readonly RefinementMode[] {
  if (enabled || onlineEditingReady) return REFINEMENT_MODES;
  const apiOnly: readonly RefinementMode[] = API_ONLY_MODES;
  return REFINEMENT_MODES.filter((mode) => !apiOnly.includes(mode));
}

/**
 * Moves data written by a build with the API into the phone-only build: sync
 * off, no API URL, and queued notes become local. Nothing else is touched.
 * `changed` is false when there was nothing to move, so a second run is a
 * no-op.
 */
export function phoneOnlyMigration(
  settings: CompanionSettings,
  history: TranscriptTurn[],
): {
  settings: CompanionSettings;
  history: TranscriptTurn[];
  changed: boolean;
} {
  const settingsChanged =
    settings.cloudSyncEnabled || settings.localApiUrl !== undefined;
  const historyChanged = history.some((turn) => turn.syncState === "queued");

  let nextSettings = settings;
  if (settingsChanged) {
    nextSettings = { ...settings, cloudSyncEnabled: false };
    delete nextSettings.localApiUrl;
  }
  const nextHistory = historyChanged
    ? history.map((turn): TranscriptTurn =>
        turn.syncState === "queued" ? { ...turn, syncState: "local" } : turn,
      )
    : history;

  return {
    settings: nextSettings,
    history: nextHistory,
    changed: settingsChanged || historyChanged,
  };
}

/** The helpers above, bound to API_FEATURES_ENABLED, for app code. */
export function effectiveSettings(
  settings: CompanionSettings,
): CompanionSettings {
  return effectiveSettingsFor(API_FEATURES_ENABLED, settings);
}

export function apiConfig(
  settings: ApiSettings,
  apiToken?: string,
): MobileLocalApiConfig {
  return apiConfigFor(API_FEATURES_ENABLED, settings, apiToken);
}

export function availableRefinementModes(
  onlineEditingReady = false,
): readonly RefinementMode[] {
  return availableRefinementModesFor(API_FEATURES_ENABLED, onlineEditingReady);
}
