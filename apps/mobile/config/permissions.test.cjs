const assert = require("node:assert/strict");
const path = require("node:path");
const { before, describe, it } = require("node:test");

/**
 * The permissions the native projects get from app.json and the config
 * plugins, as `expo prebuild` would write them: the mods run in introspect
 * mode (like `expo config --type introspect`), which writes no file.
 * Libraries can still add permissions when Gradle merges their manifests:
 * docs/mobile-release.md says how to check the merged manifest.
 */
const projectRoot = path.join(__dirname, "..");
const appJson = require("../app.json");
const fr = require("../locales/fr.json");

const fromExpo = (name) =>
  require(
    require.resolve(name, {
      paths: [path.dirname(require.resolve("expo/package.json"))],
    }),
  );

const pluginOptions = (name) => {
  const entry = appJson.expo.plugins.find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name,
  );
  assert.ok(entry, `${name} is in app.json`);
  return Array.isArray(entry) ? (entry[1] ?? {}) : {};
};

let mods;

before(async () => {
  // A development config: the release checks (release.cjs) have their own tests.
  for (const name of [
    "EAS_BUILD",
    "EAS_BUILD_PROFILE",
    "SONOLECT_RELEASE",
    "SONOLECT_BUILD_NUMBER",
    "SONOLECT_PRIVACY_POLICY_URL",
    "EXPO_PUBLIC_SONOLECT_SYNC_URL",
  ])
    delete process.env[name];
  const { getPrebuildConfigAsync } = fromExpo("@expo/prebuild-config");
  const { compileModsAsync } = fromExpo("@expo/config-plugins");
  const platforms = ["ios", "android"];
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms });
  const config = await compileModsAsync(exp, {
    projectRoot,
    platforms,
    introspect: true,
    assertMissingModProviders: false,
  });
  mods = config._internal.modResults;
});

describe("the camera, for the sync scanner", () => {
  it("asks for the camera without audio", () => {
    const camera = pluginOptions("expo-camera");
    assert.equal(camera.recordAudioAndroid, false);
    assert.equal(camera.barcodeScannerEnabled, true);
    assert.match(
      camera.cameraPermission,
      /^Sonolect uses the camera only to scan the sync code/,
    );
    // `false` would not turn audio off on iOS: it deletes
    // NSMicrophoneUsageDescription, which dictation needs.
    assert.equal("microphonePermission" in camera, false);
  });

  it("gives Android only CAMERA on top of what dictation needs", () => {
    const manifest = mods.android.manifest.manifest;
    const kept = manifest["uses-permission"]
      .filter((permission) => permission.$["tools:node"] !== "remove")
      .map((permission) => permission.$["android:name"])
      .sort();
    assert.deepEqual(kept, [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.RECORD_AUDIO",
      "android.permission.VIBRATE",
    ]);
  });

  it("leaves the app on Android devices without a back camera", () => {
    const features = mods.android.manifest.manifest["uses-feature"].map(
      (feature) => feature.$,
    );
    assert.deepEqual(features, [
      {
        "android:name": "android.hardware.camera",
        "android:required": "false",
      },
      {
        "android:name": "android.hardware.camera.autofocus",
        "android:required": "false",
      },
    ]);
  });

  it("explains the camera on iOS, in English and French, and keeps the microphone text", () => {
    const plist = mods.ios.infoPlist;
    assert.equal(
      plist.NSCameraUsageDescription,
      pluginOptions("expo-camera").cameraPermission,
    );
    assert.equal(
      plist.NSMicrophoneUsageDescription,
      pluginOptions("expo-speech-recognition").microphonePermission,
    );
    assert.match(
      fr.ios.NSCameraUsageDescription,
      /^Sonolect utilise l'appareil photo uniquement/,
    );
    assert.ok(fr.ios.NSMicrophoneUsageDescription);
  });
});
