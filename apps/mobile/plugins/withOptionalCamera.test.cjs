const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const withOptionalCamera = require("./withOptionalCamera");

const { applyOptionalCamera, OPTIONAL_FEATURES } = withOptionalCamera;

const feature = (name, required) => ({
  $: {
    "android:name": name,
    ...(required === undefined ? {} : { "android:required": required }),
  },
});

/** The part of an SDK 58 AndroidManifest.xml this plugin touches. */
const BASE = {
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    "uses-permission": [
      { $: { "android:name": "android.permission.RECORD_AUDIO" } },
      { $: { "android:name": "android.permission.CAMERA" } },
    ],
    application: [{ $: { "android:name": ".MainApplication" } }],
  },
};

describe("applyOptionalCamera", () => {
  it("declares the back camera and autofocus as not required", () => {
    assert.deepEqual(OPTIONAL_FEATURES, [
      "android.hardware.camera",
      "android.hardware.camera.autofocus",
    ]);
    const result = applyOptionalCamera(BASE);
    assert.deepEqual(result.manifest["uses-feature"], [
      feature("android.hardware.camera", "false"),
      feature("android.hardware.camera.autofocus", "false"),
    ]);
    // Permissions and the application are left as they were.
    assert.deepEqual(
      result.manifest["uses-permission"],
      BASE.manifest["uses-permission"],
    );
    assert.deepEqual(result.manifest.application, BASE.manifest.application);
  });

  it("turns a required camera into an optional one, keeping other features", () => {
    const required = structuredClone(BASE);
    required.manifest["uses-feature"] = [
      feature("android.hardware.camera", "true"),
      feature("android.hardware.microphone", "false"),
    ];
    assert.deepEqual(applyOptionalCamera(required).manifest["uses-feature"], [
      feature("android.hardware.camera", "false"),
      feature("android.hardware.microphone", "false"),
      feature("android.hardware.camera.autofocus", "false"),
    ]);
  });

  it("is idempotent and leaves its input alone", () => {
    const before = structuredClone(BASE);
    const once = applyOptionalCamera(BASE);
    assert.deepEqual(applyOptionalCamera(once), once);
    assert.deepEqual(BASE, before);
  });
});
