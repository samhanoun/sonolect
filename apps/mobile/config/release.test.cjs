const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  MAX_BUILD_NUMBER,
  MESSAGES,
  isReleaseBuild,
  resolveReleaseConfig,
} = require("./release.cjs");

const CONFIG = {
  name: "Sonolect",
  slug: "sonolect",
  extra: { supportsRTL: false },
};
const POLICY = "https://example.org/sonolect/privacy";

describe("resolveReleaseConfig", () => {
  it("fails a production EAS build without a policy URL", () => {
    assert.throws(
      () => resolveReleaseConfig(CONFIG, { EAS_BUILD_PROFILE: "production" }),
      { message: MESSAGES.missingUrl },
    );
  });

  it("fails SONOLECT_RELEASE=1 without a policy URL", () => {
    assert.throws(
      () => resolveReleaseConfig(CONFIG, { SONOLECT_RELEASE: "1" }),
      {
        message: MESSAGES.missingUrl,
      },
    );
    assert.throws(
      () =>
        resolveReleaseConfig(CONFIG, {
          SONOLECT_RELEASE: "1",
          SONOLECT_PRIVACY_POLICY_URL: "   ",
        }),
      { message: MESSAGES.missingUrl },
    );
  });

  it("refuses a URL that is not https", () => {
    for (const url of [
      "http://example.org/privacy",
      "not a url",
      "ftp://example.org/privacy",
      "https:example.org/privacy",
      "https://example.org/a b",
      "https://user:secret@example.org/privacy",
    ]) {
      for (const env of [{}, { SONOLECT_RELEASE: "1" }]) {
        assert.throws(
          () =>
            resolveReleaseConfig(CONFIG, {
              ...env,
              SONOLECT_PRIVACY_POLICY_URL: url,
            }),
          { message: MESSAGES.invalidUrl },
          url,
        );
      }
    }
  });

  it("puts an https URL in extra, keeping the other extra values", () => {
    for (const env of [
      { SONOLECT_PRIVACY_POLICY_URL: POLICY },
      // A SONOLECT_RELEASE build on EAS: no SONOLECT_BUILD_NUMBER needed.
      {
        SONOLECT_PRIVACY_POLICY_URL: ` ${POLICY}\n`,
        SONOLECT_RELEASE: "1",
        EAS_BUILD: "true",
      },
      { SONOLECT_PRIVACY_POLICY_URL: POLICY, EAS_BUILD_PROFILE: "production" },
    ]) {
      const resolved = resolveReleaseConfig(CONFIG, env);
      assert.deepEqual(resolved, {
        ...CONFIG,
        extra: { supportsRTL: false, privacyPolicyUrl: POLICY },
      });
    }
  });

  it("leaves the URL out of a development build without one", () => {
    for (const env of [
      {},
      { SONOLECT_PRIVACY_POLICY_URL: "" },
      { EAS_BUILD_PROFILE: "preview" },
      { EAS_BUILD_PROFILE: "development" },
      { SONOLECT_RELEASE: "0" },
      { SONOLECT_RELEASE: "true" },
    ]) {
      assert.deepEqual(resolveReleaseConfig({ name: "Sonolect" }, env), {
        name: "Sonolect",
        extra: {},
      });
      const resolved = resolveReleaseConfig(CONFIG, env);
      assert.deepEqual(resolved, CONFIG);
      // The app reads no key as no link (src/appInfo.ts).
      assert.equal(resolved.extra.privacyPolicyUrl ?? null, null);
    }
  });

  it("takes the URL only from the environment", () => {
    const withStatic = {
      ...CONFIG,
      extra: { ...CONFIG.extra, privacyPolicyUrl: POLICY },
    };
    assert.deepEqual(resolveReleaseConfig(withStatic, {}), CONFIG);
    assert.throws(
      () => resolveReleaseConfig(withStatic, { SONOLECT_RELEASE: "1" }),
      { message: MESSAGES.missingUrl },
    );
  });

  it("does not change the config it is given", () => {
    const config = { name: "Sonolect", extra: { a: 1 } };
    resolveReleaseConfig(config, { SONOLECT_PRIVACY_POLICY_URL: POLICY });
    assert.deepEqual(config, { name: "Sonolect", extra: { a: 1 } });
  });
});

describe("SONOLECT_BUILD_NUMBER", () => {
  const APP = {
    name: "Sonolect",
    ios: { bundleIdentifier: "com.sonolect.app", supportsTablet: true },
    android: { package: "com.sonolect.app", allowBackup: false },
    extra: {},
  };

  it("sets ios.buildNumber and android.versionCode", () => {
    for (const raw of ["7", " 7\n"]) {
      assert.deepEqual(
        resolveReleaseConfig(APP, { SONOLECT_BUILD_NUMBER: raw }),
        {
          ...APP,
          ios: { ...APP.ios, buildNumber: "7" },
          android: { ...APP.android, versionCode: 7 },
        },
        JSON.stringify(raw),
      );
    }
    const largest = resolveReleaseConfig(
      { name: "Sonolect" },
      { SONOLECT_BUILD_NUMBER: String(MAX_BUILD_NUMBER) },
    );
    assert.equal(largest.ios.buildNumber, "2100000000");
    assert.equal(largest.android.versionCode, 2100000000);
  });

  it("refuses a value that is not a whole number from 1", () => {
    for (const raw of [
      "0",
      "-1",
      "abc",
      "1.5",
      "7a",
      "1e3",
      "07",
      "0x10",
      String(MAX_BUILD_NUMBER + 1),
    ]) {
      for (const env of [{}, { EAS_BUILD: "true" }]) {
        assert.throws(
          () =>
            resolveReleaseConfig(APP, { ...env, SONOLECT_BUILD_NUMBER: raw }),
          { message: MESSAGES.invalidBuildNumber },
          raw,
        );
      }
    }
  });

  it("leaves the versions alone when unset", () => {
    for (const env of [
      {},
      { SONOLECT_BUILD_NUMBER: "" },
      { SONOLECT_BUILD_NUMBER: "  " },
      {
        EAS_BUILD: "true",
        SONOLECT_RELEASE: "1",
        SONOLECT_PRIVACY_POLICY_URL: POLICY,
      },
      { EAS_BUILD_PROFILE: "production", SONOLECT_PRIVACY_POLICY_URL: POLICY },
    ]) {
      const resolved = resolveReleaseConfig(APP, env);
      assert.deepEqual(resolved.ios, APP.ios);
      assert.deepEqual(resolved.android, APP.android);
    }
  });

  it("is required for a local release build", () => {
    assert.throws(
      () =>
        resolveReleaseConfig(APP, {
          SONOLECT_RELEASE: "1",
          SONOLECT_PRIVACY_POLICY_URL: POLICY,
        }),
      { message: MESSAGES.missingBuildNumber },
    );
    assert.equal(
      MESSAGES.missingBuildNumber,
      "Set SONOLECT_BUILD_NUMBER for local release builds (EAS builds use remote versioning)",
    );
    assert.deepEqual(
      resolveReleaseConfig(APP, {
        SONOLECT_RELEASE: "1",
        SONOLECT_PRIVACY_POLICY_URL: POLICY,
        SONOLECT_BUILD_NUMBER: "12",
      }),
      {
        ...APP,
        ios: { ...APP.ios, buildNumber: "12" },
        android: { ...APP.android, versionCode: 12 },
        extra: { privacyPolicyUrl: POLICY },
      },
    );
  });

  it("is not required on an EAS builder (remote versioning)", () => {
    const resolved = resolveReleaseConfig(APP, {
      SONOLECT_RELEASE: "1",
      SONOLECT_PRIVACY_POLICY_URL: POLICY,
      EAS_BUILD: "true",
    });
    assert.deepEqual(resolved, {
      ...APP,
      extra: { privacyPolicyUrl: POLICY },
    });
    for (const EAS_BUILD of ["false", "1", ""]) {
      assert.throws(
        () =>
          resolveReleaseConfig(APP, {
            SONOLECT_RELEASE: "1",
            SONOLECT_PRIVACY_POLICY_URL: POLICY,
            EAS_BUILD,
          }),
        { message: MESSAGES.missingBuildNumber },
        EAS_BUILD,
      );
    }
  });

  it("asks for the policy URL before the build number", () => {
    assert.throws(() => resolveReleaseConfig(APP, { SONOLECT_RELEASE: "1" }), {
      message: MESSAGES.missingUrl,
    });
  });
});

describe("isReleaseBuild", () => {
  it("is set only by the production profile or SONOLECT_RELEASE=1", () => {
    assert.equal(isReleaseBuild({}), false);
    assert.equal(isReleaseBuild({ EAS_BUILD: "true" }), false);
    assert.equal(isReleaseBuild({ NODE_ENV: "production" }), false);
    assert.equal(isReleaseBuild({ EAS_BUILD_PROFILE: "preview" }), false);
    assert.equal(isReleaseBuild({ EAS_BUILD_PROFILE: "production" }), true);
    assert.equal(isReleaseBuild({ SONOLECT_RELEASE: "1" }), true);
  });
});
