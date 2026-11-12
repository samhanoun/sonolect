/**
 * Release settings for the Expo config (app.config.js). Pure: it reads only
 * the config and the environment it is given.
 *
 * SONOLECT_PRIVACY_POLICY_URL is the hosted privacy policy that Settings and
 * the onboarding card link to (security-5, App Review 5.1.1(i), Google Play
 * User Data policy). Development and CI builds may leave it unset: the app
 * then shows no link. A release build without it fails here, so a store
 * build can never ship without the link or with a placeholder.
 *
 * SONOLECT_BUILD_NUMBER is the build number of a local release archive
 * (ios-10, android-3): it sets ios.buildNumber (CFBundleVersion) and
 * android.versionCode. EAS builds use remote versioning (eas.json) instead,
 * so only a local release build (SONOLECT_RELEASE=1 outside EAS) requires
 * it. See docs/mobile-release.md.
 */

const POLICY_URL_VAR = "SONOLECT_PRIVACY_POLICY_URL";
const BUILD_NUMBER_VAR = "SONOLECT_BUILD_NUMBER";
/** The largest versionCode Google Play accepts. */
const MAX_BUILD_NUMBER = 2100000000;

const MESSAGES = {
  invalidUrl: `${POLICY_URL_VAR} must be an https:// URL`,
  missingUrl: `${POLICY_URL_VAR} is required for release builds (App Review 5.1.1(i), Google Play User Data policy). See docs/mobile-release.md.`,
  invalidBuildNumber: `${BUILD_NUMBER_VAR} must be a whole number from 1 to ${MAX_BUILD_NUMBER}`,
  missingBuildNumber: `Set ${BUILD_NUMBER_VAR} for local release builds (EAS builds use remote versioning)`,
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
 * The build number from the environment, or null when unset. Throws when it
 * is not a whole number from 1 to MAX_BUILD_NUMBER, and when a local release
 * build (SONOLECT_RELEASE=1, not on an EAS builder) has none.
 */
function buildNumberFrom(env) {
  const raw = (env[BUILD_NUMBER_VAR] ?? "").trim();
  if (raw) {
    if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > MAX_BUILD_NUMBER) {
      throw new Error(MESSAGES.invalidBuildNumber);
    }
    return Number(raw);
  }
  if (env.SONOLECT_RELEASE === "1" && env.EAS_BUILD !== "true") {
    throw new Error(MESSAGES.missingBuildNumber);
  }
  return null;
}

/**
 * The Expo config with `extra.privacyPolicyUrl` from the environment, and
 * ios.buildNumber and android.versionCode from SONOLECT_BUILD_NUMBER when it
 * is set. When the URL is unset the key is left out rather than set to null:
 * @expo/config 58 turns a null in a dynamic config into {}
 * (serializeAndEvaluate). The app reads a missing key as no policy link. A
 * value in app.json is dropped, so the environment is the only source.
 */
function resolveReleaseConfig(config, env) {
  const privacyPolicyUrl = privacyPolicyUrlFrom(env);
  const buildNumber = buildNumberFrom(env);
  const { privacyPolicyUrl: _static, ...extra } = config.extra ?? {};
  const versions =
    buildNumber === null
      ? {}
      : {
          ios: { ...config.ios, buildNumber: String(buildNumber) },
          android: { ...config.android, versionCode: buildNumber },
        };
  return {
    ...config,
    ...versions,
    extra: privacyPolicyUrl ? { ...extra, privacyPolicyUrl } : extra,
  };
}

module.exports = {
  BUILD_NUMBER_VAR,
  MAX_BUILD_NUMBER,
  MESSAGES,
  POLICY_URL_VAR,
  buildNumberFrom,
  isReleaseBuild,
  privacyPolicyUrlFrom,
  resolveReleaseConfig,
};
