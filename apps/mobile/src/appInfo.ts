import Constants from "expo-constants";
import { Linking } from "react-native";

import { httpsUrlOrNull } from "./settingsPolicy";

/**
 * The hosted privacy policy (security-5): SONOLECT_PRIVACY_POLICY_URL at
 * build time, through app.config.js and config/release.cjs. Null in builds
 * without it, such as development builds: the app then shows no link.
 */
export function privacyPolicyUrl(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== "object" || extra === null) return null;
  return httpsUrlOrNull(
    (extra as { privacyPolicyUrl?: unknown }).privacyPolicyUrl,
  );
}

/** Opens the policy in the browser. A failure leaves the screen as it is. */
export function openPrivacyPolicy(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}
