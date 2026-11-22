const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Marks the camera as optional on Android. expo-camera adds the CAMERA
 * permission, and Google Play then takes the app to need a back camera
 * with autofocus, and hides it from devices without one. Sonolect uses the
 * camera only to scan a sync code (Settings, Sync, Scan code), which can
 * also be typed, so it declares both features as not required.
 */
const OPTIONAL_FEATURES = [
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
];

/**
 * The AndroidManifest.xml JSON (as withAndroidManifest reads it) with each
 * OPTIONAL_FEATURES entry declared with android:required="false": an
 * existing entry gets the attribute, a missing one is appended. Other
 * features are left alone. Pure, and running it again changes nothing.
 */
function applyOptionalCamera(manifestJson) {
  const manifest = manifestJson.manifest ?? {};
  const features = (manifest["uses-feature"] ?? []).map((feature) =>
    OPTIONAL_FEATURES.includes(feature.$?.["android:name"])
      ? { ...feature, $: { ...feature.$, "android:required": "false" } }
      : feature,
  );
  const present = new Set(
    features.map((feature) => feature.$?.["android:name"]),
  );
  for (const name of OPTIONAL_FEATURES) {
    if (!present.has(name)) {
      features.push({
        $: { "android:name": name, "android:required": "false" },
      });
    }
  }
  return {
    ...manifestJson,
    manifest: { ...manifest, "uses-feature": features },
  };
}

function withOptionalCamera(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyOptionalCamera(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withOptionalCamera;
module.exports.applyOptionalCamera = applyOptionalCamera;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
