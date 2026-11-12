const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const withReleaseSigning = require("./withReleaseSigning");

const { addReleaseSigning, MARKER, SIGNING_BLOCK } = withReleaseSigning;

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

function count(text, part) {
  return text.split(part).length - 1;
}

/** The body of the `if (...) {` that throws in the bundleRelease guard. */
function guardCondition(block) {
  const match = block.match(
    /gradle\.taskGraph\.whenReady \{ graph ->\s*\n(?:\s*\/\/.*\n)*\s*if \((.*)\) \{\s*\n\s*throw new GradleException\('bundleRelease needs the private upload key/,
  );
  assert.ok(match, "the bundleRelease guard is missing");
  return match[1];
}

describe("addReleaseSigning", () => {
  it("appends the block once, after the template", () => {
    const once = addReleaseSigning(TEMPLATE);
    assert.ok(once.startsWith(TEMPLATE));
    assert.equal(count(once, MARKER), 1);
    assert.ok(once.endsWith(SIGNING_BLOCK));
    assert.equal(addReleaseSigning(once), once);
  });

  it("adds a newline when the file has no final newline", () => {
    const text = TEMPLATE.trimEnd();
    assert.equal(addReleaseSigning(text), `${text}\n\n${SIGNING_BLOCK}`);
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
    assert.match(
      SIGNING_BLOCK,
      /if \(project\.findProperty\('sonolectUploadStoreFile'\)\) \{/,
    );
    for (const property of [
      "storeFile file(project.property('sonolectUploadStoreFile'))",
      "storePassword project.property('sonolectUploadStorePassword')",
      "keyAlias project.property('sonolectUploadKeyAlias')",
      "keyPassword project.property('sonolectUploadKeyPassword')",
      "signingConfig signingConfigs.upload",
    ]) {
      assert.ok(SIGNING_BLOCK.includes(property), property);
    }
  });

  it("never refers to the debug keystore", () => {
    assert.doesNotMatch(SIGNING_BLOCK, /debug/i);
    assert.doesNotMatch(SIGNING_BLOCK, /androiddebugkey|'android'/);
  });

  it("fails bundleRelease without the upload key", () => {
    const condition = guardCondition(SIGNING_BLOCK);
    assert.ok(
      condition.includes("!project.findProperty('sonolectUploadStoreFile')"),
    );
    assert.ok(
      condition.includes("graph.allTasks.any { it.name == 'bundleRelease' }"),
    );
    assert.ok(SIGNING_BLOCK.includes("See docs/mobile-release.md."));
  });

  it("skips the bundleRelease guard on EAS Build (EAS_BUILD=true)", () => {
    const condition = guardCondition(SIGNING_BLOCK);
    const clauses = condition.split(" && ");
    assert.equal(clauses.length, 3);
    assert.equal(clauses[0], "System.getenv('EAS_BUILD') != 'true'");
    // The guard has only this one throw, so nothing else can fail EAS builds.
    assert.equal(count(SIGNING_BLOCK, "throw "), 1);
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

  it("edits android/app/build.gradle through the appBuildGradle mod", async () => {
    const config = withReleaseSigning({ name: "Sonolect", slug: "sonolect" });
    const mod = config.mods.android.appBuildGradle;
    const result = await mod({
      modRequest,
      modResults: {
        path: "/project/android/app/build.gradle",
        language: "groovy",
        contents: TEMPLATE,
      },
    });
    assert.equal(result.modResults.contents, addReleaseSigning(TEMPLATE));
  });

  it("refuses a Kotlin build script", async () => {
    const config = withReleaseSigning({ name: "Sonolect", slug: "sonolect" });
    const mod = config.mods.android.appBuildGradle;
    await assert.rejects(
      mod({
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
