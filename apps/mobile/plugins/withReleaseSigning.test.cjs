const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { resolveReleaseConfig } = require("../config/release.cjs");
const withReleaseSigning = require("./withReleaseSigning");

const {
  addReleaseSigning,
  isReleasePrebuild,
  signingBlock,
  MARKER,
  END_MARKER,
} = withReleaseSigning;

// The parts of android/app/build.gradle (SDK 58 template) the plugin relies on.
const TEMPLATE = `android {
    defaultConfig {
        applicationId 'com.sonolect.app'
        versionCode 1
        versionName "0.2.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;

const POLICY = "https://example.org/sonolect/privacy";
const UPLOAD_KEY_MESSAGE = "bundleRelease needs the private upload key";
const PREBUILD_MESSAGE = "bundleRelease needs a release prebuild";

function count(text, part) {
  return text.split(part).length - 1;
}

/** The condition of the `if (...) {` in the whenReady guard that throws `message`. */
function guardCondition(block, message) {
  const whenReady = block.indexOf("gradle.taskGraph.whenReady { graph ->");
  assert.notEqual(whenReady, -1, "the bundleRelease guard is missing");
  const match = block
    .slice(whenReady)
    .match(
      new RegExp(
        `\\n\\s*if \\((.*)\\) \\{\\s*\\n\\s*throw new GradleException\\('${message}`,
      ),
    );
  assert.ok(match, `the guard that throws "${message}" is missing`);
  return match[1];
}

describe("addReleaseSigning", () => {
  it("appends the block once, after the template", () => {
    for (const releasePrebuild of [false, true]) {
      const once = addReleaseSigning(TEMPLATE, { releasePrebuild });
      assert.ok(once.startsWith(TEMPLATE));
      assert.equal(count(once, MARKER), 1);
      assert.equal(count(once, END_MARKER), 1);
      assert.ok(once.endsWith(signingBlock(releasePrebuild)));
      assert.equal(addReleaseSigning(once, { releasePrebuild }), once);
    }
  });

  it("counts a call without the option as no release prebuild", () => {
    assert.equal(
      addReleaseSigning(TEMPLATE),
      addReleaseSigning(TEMPLATE, { releasePrebuild: false }),
    );
  });

  it("adds a newline when the file has no final newline", () => {
    const text = TEMPLATE.trimEnd();
    assert.equal(addReleaseSigning(text), `${text}\n\n${signingBlock(false)}`);
  });

  it("replaces an earlier block, so a prebuild without --clean updates it", () => {
    const development = addReleaseSigning(TEMPLATE, { releasePrebuild: false });
    const release = addReleaseSigning(TEMPLATE, { releasePrebuild: true });
    assert.notEqual(development, release);
    assert.equal(
      addReleaseSigning(development, { releasePrebuild: true }),
      release,
    );
    assert.equal(
      addReleaseSigning(release, { releasePrebuild: false }),
      development,
    );
    // Lines that a later plugin added after the block stay after it.
    const later = "apply from: 'later.gradle'\n";
    const replaced = addReleaseSigning(`${development}${later}`, {
      releasePrebuild: true,
    });
    assert.equal(replaced, `${release}${later}`);
    assert.equal(count(replaced, MARKER), 1);
    assert.equal(count(replaced, END_MARKER), 1);
  });

  it("refuses an earlier block without its end marker", () => {
    const unended = `${TEMPLATE}\n${MARKER}\ngradle.taskGraph.whenReady { graph -> }\n`;
    assert.throws(() => addReleaseSigning(unended, { releasePrebuild: true }), {
      message: /without its end marker\. Run expo prebuild --clean\./,
    });
  });

  it("throws when the template has no signingConfigs or buildTypes", () => {
    const noSigning = TEMPLATE.replace("signingConfigs {", "configs {");
    const noBuildTypes = TEMPLATE.replace("buildTypes {", "types {");
    for (const text of [noSigning, noBuildTypes, "", "android {}\n"]) {
      assert.throws(() => addReleaseSigning(text), {
        message:
          /no signingConfigs or buildTypes block; the Expo Android template changed/,
      });
    }
  });

  it("signs release builds with the upload key from Gradle properties", () => {
    for (const releasePrebuild of [false, true]) {
      const block = signingBlock(releasePrebuild);
      assert.match(
        block,
        /if \(project\.findProperty\('sonolectUploadStoreFile'\)\) \{/,
      );
      for (const property of [
        "storeFile file(project.property('sonolectUploadStoreFile'))",
        "storePassword project.property('sonolectUploadStorePassword')",
        "keyAlias project.property('sonolectUploadKeyAlias')",
        "keyPassword project.property('sonolectUploadKeyPassword')",
        "signingConfig signingConfigs.upload",
      ]) {
        assert.ok(block.includes(property), property);
      }
    }
  });

  it("never refers to the debug keystore", () => {
    for (const releasePrebuild of [false, true]) {
      const block = signingBlock(releasePrebuild);
      assert.doesNotMatch(block, /debug/i);
      assert.doesNotMatch(block, /androiddebugkey|'android'/);
    }
  });

  it("fails bundleRelease without the upload key", () => {
    for (const releasePrebuild of [false, true]) {
      const block = signingBlock(releasePrebuild);
      const condition = guardCondition(block, UPLOAD_KEY_MESSAGE);
      assert.ok(
        condition.includes("!project.findProperty('sonolectUploadStoreFile')"),
      );
      assert.ok(
        condition.includes("graph.allTasks.any { it.name == 'bundleRelease' }"),
      );
      assert.ok(block.includes("See docs/mobile-release.md."));
    }
  });

  it("fails bundleRelease after a prebuild without the release settings", () => {
    assert.match(
      signingBlock(false),
      /\ndef sonolectReleasePrebuild = false\n/,
    );
    assert.match(signingBlock(true), /\ndef sonolectReleasePrebuild = true\n/);
    for (const releasePrebuild of [false, true]) {
      const block = signingBlock(releasePrebuild);
      assert.equal(count(block, "def sonolectReleasePrebuild = "), 1);
      assert.ok(
        block.indexOf("def sonolectReleasePrebuild") <
          block.indexOf("gradle.taskGraph.whenReady"),
      );
      assert.deepEqual(guardCondition(block, PREBUILD_MESSAGE).split(" && "), [
        "!sonolectOnEas",
        "!sonolectReleasePrebuild",
        "graph.allTasks.any { it.name == 'bundleRelease' }",
      ]);
      assert.ok(
        block.includes(
          "throw new GradleException('bundleRelease needs a release prebuild: run expo prebuild with SONOLECT_RELEASE=1, SONOLECT_BUILD_NUMBER and SONOLECT_PRIVACY_POLICY_URL set. See docs/mobile-release.md.')",
        ),
      );
    }
  });

  it("skips both bundleRelease guards on EAS Build (EAS_BUILD=true or 1)", () => {
    for (const releasePrebuild of [false, true]) {
      const block = signingBlock(releasePrebuild);
      // Cloud builders set EAS_BUILD=true, eas build --local sets 1.
      assert.match(
        block,
        /\ndef sonolectOnEas = \['true', '1'\]\.contains\(\(System\.getenv\('EAS_BUILD'\) \?: ''\)\.trim\(\)\.toLowerCase\(\)\)\n/,
      );
      assert.equal(count(block, "System.getenv("), 1);
      assert.ok(
        block.indexOf("def sonolectOnEas") <
          block.indexOf("gradle.taskGraph.whenReady"),
      );
      const clauses = guardCondition(block, UPLOAD_KEY_MESSAGE).split(" && ");
      assert.equal(clauses.length, 3);
      assert.equal(clauses[0], "!sonolectOnEas");
      assert.equal(
        guardCondition(block, PREBUILD_MESSAGE).split(" && ")[0],
        "!sonolectOnEas",
      );
      // The guard has only these two throws, so nothing else can fail EAS builds.
      assert.equal(count(block, "throw "), 2);
    }
  });
});

describe("isReleasePrebuild", () => {
  it("needs both a versionCode and a privacy policy URL", () => {
    assert.equal(
      isReleasePrebuild({
        android: { versionCode: 7 },
        extra: { privacyPolicyUrl: POLICY },
      }),
      true,
    );
    for (const config of [
      {},
      { android: {}, extra: {} },
      { android: { versionCode: 7 } },
      { extra: { privacyPolicyUrl: POLICY } },
      { android: { versionCode: 7 }, extra: { privacyPolicyUrl: "" } },
      { android: { versionCode: 7 }, extra: { privacyPolicyUrl: null } },
      { android: { versionCode: 0 }, extra: { privacyPolicyUrl: POLICY } },
      { android: { versionCode: 1.5 }, extra: { privacyPolicyUrl: POLICY } },
      { android: { versionCode: "7" }, extra: { privacyPolicyUrl: POLICY } },
    ]) {
      assert.equal(isReleasePrebuild(config), false, JSON.stringify(config));
    }
  });

  it("reads the values config/release.cjs sets", () => {
    const app = {
      name: "Sonolect",
      android: { package: "com.sonolect.app" },
      extra: {},
    };
    assert.equal(
      isReleasePrebuild(
        resolveReleaseConfig(app, {
          SONOLECT_RELEASE: "1",
          SONOLECT_BUILD_NUMBER: "7",
          SONOLECT_PRIVACY_POLICY_URL: POLICY,
        }),
      ),
      true,
    );
    // A development prebuild (expo prebuild, expo run:android).
    assert.equal(isReleasePrebuild(resolveReleaseConfig(app, {})), false);
    assert.equal(
      isReleasePrebuild(
        resolveReleaseConfig(app, { SONOLECT_PRIVACY_POLICY_URL: POLICY }),
      ),
      false,
    );
    // EAS production uses remote versioning, so the config has no
    // versionCode; the guard is skipped there through EAS_BUILD instead.
    assert.equal(
      isReleasePrebuild(
        resolveReleaseConfig(app, {
          EAS_BUILD: "true",
          EAS_BUILD_PROFILE: "production",
          SONOLECT_PRIVACY_POLICY_URL: POLICY,
        }),
      ),
      false,
    );
  });
});

describe("withReleaseSigning", () => {
  const modRequest = {
    platform: "android",
    modName: "appBuildGradle",
    projectRoot: "/project",
    platformProjectRoot: "/project/android",
    introspect: false,
  };
  const APP = { name: "Sonolect", slug: "sonolect" };

  it("edits android/app/build.gradle through the appBuildGradle mod", async () => {
    for (const [expoConfig, releasePrebuild] of [
      [APP, false],
      [{ ...APP, android: { versionCode: 7 } }, false],
      [{ ...APP, extra: { privacyPolicyUrl: POLICY } }, false],
      [
        {
          ...APP,
          android: { versionCode: 7 },
          extra: { privacyPolicyUrl: POLICY },
        },
        true,
      ],
    ]) {
      const config = withReleaseSigning({ ...expoConfig });
      const mod = config.mods.android.appBuildGradle;
      const result = await mod({
        ...expoConfig,
        modRequest,
        modResults: {
          path: "/project/android/app/build.gradle",
          language: "groovy",
          contents: TEMPLATE,
        },
      });
      assert.equal(
        result.modResults.contents,
        addReleaseSigning(TEMPLATE, { releasePrebuild }),
      );
      assert.ok(
        result.modResults.contents.includes(
          `\ndef sonolectReleasePrebuild = ${releasePrebuild}\n`,
        ),
        JSON.stringify(expoConfig),
      );
    }
  });

  it("refuses a Kotlin build script", async () => {
    const config = withReleaseSigning({ ...APP });
    const mod = config.mods.android.appBuildGradle;
    await assert.rejects(
      mod({
        ...APP,
        modRequest,
        modResults: {
          path: "/project/android/app/build.gradle.kts",
          language: "kt",
          contents: TEMPLATE,
        },
      }),
      { message: /expected a Groovy android\/app\/build\.gradle, got kt/ },
    );
  });
});
