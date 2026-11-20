const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Release signing with the owner's private upload key, for local Gradle
 * builds (android-3, security-10; route (b) in docs/mobile-release.md).
 *
 * The template signs release builds with the debug keystore that ships with
 * every Expo and React Native template, so anyone can sign an update of
 * com.sonolect.app with it. This plugin adds a block at the end of
 * android/app/build.gradle:
 *
 * - When the Gradle property sonolectUploadStoreFile is set (in CI through
 *   ORG_GRADLE_PROJECT_sonolectUploadStoreFile and the password and alias
 *   properties), release builds are signed with that upload key. The block
 *   comes after the template's android {} block, so it overrides the debug
 *   signing.
 * - Without that property, a store bundle (bundleRelease) fails with a clear
 *   message. The CI test APK (assembleRelease) keeps the debug signing and
 *   stays internal.
 * - A store bundle also fails when android/ comes from a prebuild without
 *   the release settings (isReleasePrebuild): it would have versionCode 1
 *   and no privacy policy link.
 * - EAS Build (route (a), recommended) signs with its own credentials and
 *   sets the version itself, so both checks are skipped there. EAS_BUILD is
 *   true on its build servers and 1 with `eas build --local`.
 */
const MARKER = "// sonolect-release-signing";
const END_MARKER = "// end sonolect-release-signing";

/**
 * Whether the Expo config comes from a release prebuild. config/release.cjs
 * sets android.versionCode from SONOLECT_BUILD_NUMBER and
 * extra.privacyPolicyUrl from SONOLECT_PRIVACY_POLICY_URL, only when they
 * are set (in the shell or in an apps/mobile .env file).
 */
function isReleasePrebuild(config) {
  const versionCode = config.android?.versionCode;
  const url = config.extra?.privacyPolicyUrl;
  return (
    Number.isInteger(versionCode) &&
    versionCode > 0 &&
    typeof url === "string" &&
    url.length > 0
  );
}

/** The Gradle block, with the prebuild's isReleasePrebuild result built in. */
function signingBlock(releasePrebuild) {
  return `${MARKER}
// Added by plugins/withReleaseSigning.js; see docs/mobile-release.md.
if (project.findProperty('sonolectUploadStoreFile')) {
    android {
        signingConfigs {
            upload {
                storeFile file(project.property('sonolectUploadStoreFile'))
                storePassword project.property('sonolectUploadStorePassword')
                keyAlias project.property('sonolectUploadKeyAlias')
                keyPassword project.property('sonolectUploadKeyPassword')
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.upload
            }
        }
    }
}
// EAS Build signs with the credentials it manages (eas credentials) and sets
// the version itself. EAS_BUILD is true on its build servers and 1 with
// eas build --local.
def sonolectOnEas = ['true', '1'].contains((System.getenv('EAS_BUILD') ?: '').trim().toLowerCase())
// Written by expo prebuild: true when the config had android.versionCode and
// extra.privacyPolicyUrl (SONOLECT_BUILD_NUMBER, SONOLECT_PRIVACY_POLICY_URL).
def sonolectReleasePrebuild = ${releasePrebuild ? "true" : "false"}
gradle.taskGraph.whenReady { graph ->
    if (!sonolectOnEas && !project.findProperty('sonolectUploadStoreFile') && graph.allTasks.any { it.name == 'bundleRelease' }) {
        throw new GradleException('bundleRelease needs the private upload key: set ORG_GRADLE_PROJECT_sonolectUploadStoreFile and the password and alias properties. See docs/mobile-release.md.')
    }
    if (!sonolectOnEas && !sonolectReleasePrebuild && graph.allTasks.any { it.name == 'bundleRelease' }) {
        throw new GradleException('bundleRelease needs a release prebuild: run expo prebuild with SONOLECT_RELEASE=1, SONOLECT_BUILD_NUMBER and SONOLECT_PRIVACY_POLICY_URL set. See docs/mobile-release.md.')
    }
}
${END_MARKER}
`;
}

/**
 * The app build.gradle text with the release-signing block appended, or
 * with an earlier block replaced, so that `expo prebuild` without --clean
 * updates the built-in release-prebuild flag. Throws when the text has no
 * signingConfigs or buildTypes block, which means the template changed and
 * the signing setup must be checked, and when an earlier block has no end
 * marker. Pure, and running it again with the same flag changes nothing.
 */
function addReleaseSigning(gradleText, { releasePrebuild = false } = {}) {
  if (
    !/\bsigningConfigs\s*\{/.test(gradleText) ||
    !/\bbuildTypes\s*\{/.test(gradleText)
  ) {
    throw new Error(
      "withReleaseSigning: android/app/build.gradle has no signingConfigs or buildTypes block; the Expo Android template changed. Check the release signing in plugins/withReleaseSigning.js.",
    );
  }
  const block = signingBlock(releasePrebuild);
  const start = gradleText.indexOf(MARKER);
  if (start === -1) {
    const base = gradleText.endsWith("\n") ? gradleText : `${gradleText}\n`;
    return `${base}\n${block}`;
  }
  const end = gradleText.indexOf(END_MARKER, start);
  if (end === -1) {
    throw new Error(
      "withReleaseSigning: android/app/build.gradle has a release-signing block without its end marker. Run expo prebuild --clean.",
    );
  }
  const rest = gradleText.slice(end + END_MARKER.length).replace(/^\n/, "");
  return `${gradleText.slice(0, start)}${block}${rest}`;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error(
        `withReleaseSigning: expected a Groovy android/app/build.gradle, got ${modConfig.modResults.language}; the Expo Android template changed.`,
      );
    }
    modConfig.modResults.contents = addReleaseSigning(
      modConfig.modResults.contents,
      { releasePrebuild: isReleasePrebuild(modConfig) },
    );
    return modConfig;
  });
}

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
module.exports.isReleasePrebuild = isReleasePrebuild;
module.exports.signingBlock = signingBlock;
module.exports.MARKER = MARKER;
module.exports.END_MARKER = END_MARKER;
