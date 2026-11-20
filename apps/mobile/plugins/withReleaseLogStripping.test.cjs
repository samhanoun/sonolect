const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const withReleaseLogStripping = require("./withReleaseLogStripping");

const { appendLogStrippingRules, MARKER, RULES, MINIFY_PROPERTY } =
  withReleaseLogStripping;

// android/app/proguard-rules.pro as the SDK 58 template writes it.
const TEMPLATE = `# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:
`;

const MOD_REQUEST = {
  platform: "android",
  projectRoot: "/project",
  platformProjectRoot: "/project/android",
  introspect: false,
};

function count(text, part) {
  return text.split(part).length - 1;
}

describe("appendLogStrippingRules", () => {
  it("appends the rule once and keeps the existing rules", () => {
    const once = appendLogStrippingRules(TEMPLATE);
    assert.ok(once.startsWith(TEMPLATE));
    assert.equal(count(once, MARKER), 1);
    assert.equal(count(once, "-assumenosideeffects class android.util.Log"), 1);
    assert.ok(once.endsWith(`${RULES}\n`));
    assert.equal(appendLogStrippingRules(once), once);
  });

  it("strips v, d and i, and keeps w and e", () => {
    for (const level of ["v", "d", "i"]) {
      assert.ok(RULES.includes(`public static int ${level}(...);`), level);
    }
    for (const level of ["w", "e", "wtf"]) {
      assert.ok(!RULES.includes(`int ${level}(`), level);
    }
  });

  it("handles an empty file and a file without a final newline", () => {
    assert.equal(appendLogStrippingRules(""), `\n${RULES}\n`);
    assert.equal(
      appendLogStrippingRules("-keep class a.B"),
      `-keep class a.B\n\n${RULES}\n`,
    );
  });
});

describe("withReleaseLogStripping", () => {
  it("turns R8 on for release builds in gradle.properties", async () => {
    const config = withReleaseLogStripping({ name: "Sonolect", slug: "s" });
    const mod = config.mods.android.gradleProperties;
    for (const before of [
      [{ type: "property", key: MINIFY_PROPERTY, value: "false" }],
      [{ type: "property", key: "newArchEnabled", value: "true" }],
    ]) {
      const result = await mod({
        modRequest: { ...MOD_REQUEST, modName: "gradleProperties" },
        modResults: structuredClone(before),
      });
      const minify = result.modResults.filter(
        (item) => item.type === "property" && item.key === MINIFY_PROPERTY,
      );
      assert.deepEqual(minify, [
        { type: "property", key: MINIFY_PROPERTY, value: "true" },
      ]);
    }
  });

  it("writes the rule into android/app/proguard-rules.pro", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sonolect-proguard-"));
    try {
      const platformProjectRoot = path.join(root, "android");
      const file = path.join(platformProjectRoot, "app", "proguard-rules.pro");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, TEMPLATE);
      const config = withReleaseLogStripping({ name: "Sonolect", slug: "s" });
      const mod = config.mods.android.dangerous;
      const modRequest = {
        ...MOD_REQUEST,
        modName: "dangerous",
        projectRoot: root,
        platformProjectRoot,
      };
      await mod({ modRequest, modResults: {} });
      await mod({ modRequest, modResults: {} });
      assert.equal(
        fs.readFileSync(file, "utf8"),
        appendLogStrippingRules(TEMPLATE),
      );

      fs.rmSync(file);
      await assert.rejects(mod({ modRequest, modResults: {} }), {
        message:
          /cannot read .*proguard-rules\.pro; the Expo Android template changed/,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
