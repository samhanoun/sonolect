const fs = require("node:fs");
const path = require("node:path");
const {
  withDangerousMod,
  withGradleProperties,
} = require("expo/config-plugins");

const { setGradleProperty } = require("./withAsyncStorageSize");

/**
 * Removes android.util.Log v, d and i calls from release builds
 * (security-2). expo-speech-recognition logs every partial and final
 * transcript with Log.d, which ends up in logcat and in bug reports. R8
 * drops calls marked -assumenosideeffects; Log.w and Log.e stay.
 *
 * The SDK 58 template already turns R8 on for release builds
 * (android.enableMinifyInReleaseBuilds=true) with
 * proguard-android-optimize.txt, which honours -assumenosideeffects. The
 * plugin sets the property again so the rule cannot silently stop working.
 * The patch of expo-speech-recognition (patches/) also stops it from
 * logging transcript text, for debug builds too.
 */
const MARKER = "# sonolect: strip android.util.Log v/d/i in release";
const RULES = [
  MARKER,
  "-assumenosideeffects class android.util.Log {",
  "    public static int v(...);",
  "    public static int d(...);",
  "    public static int i(...);",
  "}",
].join("\n");
const MINIFY_PROPERTY = "android.enableMinifyInReleaseBuilds";

/**
 * The proguard-rules.pro text with the Log rules appended once. Pure, and
 * running it again changes nothing.
 */
function appendLogStrippingRules(text) {
  if (text.includes(MARKER)) return text;
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}\n${RULES}\n`;
}

/** android/app/proguard-rules.pro with the Log rules. */
async function writeProguardRules(platformProjectRoot) {
  const file = path.join(platformProjectRoot, "app", "proguard-rules.pro");
  let text;
  try {
    text = await fs.promises.readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `withReleaseLogStripping: cannot read ${file}; the Expo Android template changed (${error.message})`,
    );
  }
  const next = appendLogStrippingRules(text);
  if (next !== text) await fs.promises.writeFile(file, next);
}

function withReleaseLogStripping(config) {
  const withMinify = withGradleProperties(config, (modConfig) => {
    modConfig.modResults = setGradleProperty(
      modConfig.modResults,
      MINIFY_PROPERTY,
      "true",
    );
    return modConfig;
  });
  return withDangerousMod(withMinify, [
    "android",
    async (modConfig) => {
      await writeProguardRules(modConfig.modRequest.platformProjectRoot);
      return modConfig;
    },
  ]);
}

module.exports = withReleaseLogStripping;
module.exports.appendLogStrippingRules = appendLogStrippingRules;
module.exports.MARKER = MARKER;
module.exports.RULES = RULES;
module.exports.MINIFY_PROPERTY = MINIFY_PROPERTY;
