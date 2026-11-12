const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Release signing with the owner's private upload key, for local Gradle
 * builds (android-3, security-10; route (b) in docs/mobile-release.md).
 *
 * The template signs release builds with the debug keystore that ships with
 * every Expo and React Native template, so anyone can sign an update of
 * com.sonolect.app with it. This plugin appends a block to
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
 * - EAS Build (EAS_BUILD=true on its builders, route (a), recommended)
 *   signs with its own credentials, so the check is skipped there.
 */
const MARKER = "// sonolect-release-signing";

const SIGNING_BLOCK = `${MARKER}
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
gradle.taskGraph.whenReady { graph ->
    // EAS Build signs with the credentials it manages (eas credentials).
    if (System.getenv('EAS_BUILD') != 'true' && !project.findProperty('sonolectUploadStoreFile') && graph.allTasks.any { it.name == 'bundleRelease' }) {
        throw new GradleException('bundleRelease needs the private upload key: set ORG_GRADLE_PROJECT_sonolectUploadStoreFile and the password and alias properties. See docs/mobile-release.md.')
    }
}
`;

/**
 * The app build.gradle text with the release-signing block appended once.
 * Throws when the text has no signingConfigs or buildTypes block, which
 * means the template changed and the signing setup must be checked. Pure,
 * and running it again changes nothing.
 */
function addReleaseSigning(gradleText) {
  if (
    !/\bsigningConfigs\s*\{/.test(gradleText) ||
    !/\bbuildTypes\s*\{/.test(gradleText)
  ) {
    throw new Error(
      "withReleaseSigning: android/app/build.gradle has no signingConfigs or buildTypes block; the Expo Android template changed. Check the release signing in plugins/withReleaseSigning.js.",
    );
  }
  if (gradleText.includes(MARKER)) return gradleText;
  const base = gradleText.endsWith("\n") ? gradleText : `${gradleText}\n`;
  return `${base}\n${SIGNING_BLOCK}`;
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
    );
    return modConfig;
  });
}

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
module.exports.MARKER = MARKER;
module.exports.SIGNING_BLOCK = SIGNING_BLOCK;
