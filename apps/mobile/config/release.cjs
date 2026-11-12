/**
 * Release settings for the Expo config (app.config.js). Pure: it reads only
 * the config and the environment it is given.
 *
 * SONOLECT_PRIVACY_POLICY_URL is the hosted privacy policy that Settings and
 * the onboarding card link to (security-5, App Review 5.1.1(i), Google Play
 * User Data policy). Development and CI builds may leave it unset: the app
 * then shows no link. A release build without it fails here, so a store
 * build can never ship without the link or with a placeholder.
 * See docs/mobile-release.md.
 */

const POLICY_URL_VAR = "SONOLECT_PRIVACY_POLICY_URL";

const MESSAGES = {
  invalidUrl: `${POLICY_URL_VAR} must be an https:// URL`,
  missingUrl: `${POLICY_URL_VAR} is required for release builds (App Review 5.1.1(i), Google Play User Data policy). See docs/mobile-release.md.`,
};

/**
 * A release build: the EAS production profile, or SONOLECT_RELEASE=1 for a
 * release built without EAS. Nothing sets these implicitly.
 */
function isReleaseBuild(env) {
  return env.EAS_BUILD_PROFILE === "production" || env.SONOLECT_RELEASE === "1";
}

/** The policy URL from the environment, or null when unset. Throws when invalid. */
function privacyPolicyUrlFrom(env) {
  const url = (env[POLICY_URL_VAR] ?? "").trim();
  if (url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(MESSAGES.invalidUrl);
    }
    // The app accepts the same URLs (httpsUrlOrNull in src/settingsPolicy.ts):
    // written out as https://host, with no spaces and no user name.
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      !/^https:\/\//i.test(url) ||
      /\s/.test(url) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(MESSAGES.invalidUrl);
    }
    return url;
  }
  if (isReleaseBuild(env)) throw new Error(MESSAGES.missingUrl);
  return null;
}

/**
 * The Expo config with `extra.privacyPolicyUrl` from the environment. When
 * the URL is unset the key is left out rather than set to null: @expo/config
 * 58 turns a null in a dynamic config into {} (serializeAndEvaluate). The
 * app reads a missing key as no policy link. A value in app.json is dropped,
 * so the environment is the only source.
 */
function resolveReleaseConfig(config, env) {
  const privacyPolicyUrl = privacyPolicyUrlFrom(env);
  const { privacyPolicyUrl: _static, ...extra } = config.extra ?? {};
  return {
    ...config,
    extra: privacyPolicyUrl ? { ...extra, privacyPolicyUrl } : extra,
  };
}

module.exports = {
  MESSAGES,
  POLICY_URL_VAR,
  isReleaseBuild,
  privacyPolicyUrlFrom,
  resolveReleaseConfig,
};
