const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  MAX_BUILD_NUMBER,
  MESSAGES,
  isDevelopmentBundle,
  isEasBuilder,
  isReleaseBuild,
  resolveReleaseConfig,
  syncServerUrlFrom,
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
    // EAS sets EAS_BUILD=true on its servers and 1 for eas build --local.
    for (const EAS_BUILD of ["true", "1", "TRUE"]) {
      const resolved = resolveReleaseConfig(APP, {
        SONOLECT_RELEASE: "1",
        SONOLECT_PRIVACY_POLICY_URL: POLICY,
        EAS_BUILD,
      });
      assert.deepEqual(
        resolved,
        {
          ...APP,
          extra: { privacyPolicyUrl: POLICY },
        },
        EAS_BUILD,
      );
    }
    for (const EAS_BUILD of ["false", "0", ""]) {
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

describe("isEasBuilder", () => {
  it("reads EAS_BUILD as Expo does: true or 1", () => {
    for (const EAS_BUILD of ["true", "1", "TRUE", " true\n", " 1 "]) {
      assert.equal(
        isEasBuilder({ EAS_BUILD }),
        true,
        JSON.stringify(EAS_BUILD),
      );
    }
    for (const EAS_BUILD of ["false", "0", "", "yes", "2"]) {
      assert.equal(
        isEasBuilder({ EAS_BUILD }),
        false,
        JSON.stringify(EAS_BUILD),
      );
    }
    assert.equal(isEasBuilder({}), false);
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

describe("isDevelopmentBundle", () => {
  it("is false for a release build and for a bundle made for production", () => {
    assert.equal(isDevelopmentBundle({}), true);
    assert.equal(isDevelopmentBundle({ NODE_ENV: "development" }), true);
    assert.equal(isDevelopmentBundle({ NODE_ENV: "production" }), false);
    assert.equal(
      isDevelopmentBundle({ EAS_BUILD_PROFILE: "production" }),
      false,
    );
    assert.equal(isDevelopmentBundle({ SONOLECT_RELEASE: "1" }), false);
    // EAS bundles a preview build for production (__DEV__ false).
    assert.equal(
      isDevelopmentBundle({
        EAS_BUILD_PROFILE: "preview",
        NODE_ENV: "production",
      }),
      false,
    );
  });
});

describe("EXPO_PUBLIC_SONOLECT_SYNC_URL", () => {
  const SYNC = "https://sync.example.org";

  it("is optional, in development and release builds alike", () => {
    for (const env of [
      {},
      { EXPO_PUBLIC_SONOLECT_SYNC_URL: "" },
      { EXPO_PUBLIC_SONOLECT_SYNC_URL: "  " },
    ]) {
      assert.equal(syncServerUrlFrom(env), null);
      assert.equal(
        syncServerUrlFrom({ ...env, EAS_BUILD_PROFILE: "production" }),
        null,
      );
    }
    assert.deepEqual(
      resolveReleaseConfig(CONFIG, {
        SONOLECT_PRIVACY_POLICY_URL: POLICY,
        EAS_BUILD_PROFILE: "production",
      }),
      { ...CONFIG, extra: { supportsRTL: false, privacyPolicyUrl: POLICY } },
    );
  });

  it("accepts an https URL and leaves the config unchanged", () => {
    for (const [raw, url] of [
      [SYNC, SYNC],
      [" https://Sync.Example.org/ ", SYNC],
      ["https://example.org:8443/sync/", "https://example.org:8443/sync"],
    ]) {
      assert.equal(
        syncServerUrlFrom({ EXPO_PUBLIC_SONOLECT_SYNC_URL: raw }),
        url,
        raw,
      );
      for (const env of [
        {},
        {
          EAS_BUILD_PROFILE: "production",
          SONOLECT_PRIVACY_POLICY_URL: POLICY,
        },
      ]) {
        const resolved = resolveReleaseConfig(CONFIG, {
          ...env,
          EXPO_PUBLIC_SONOLECT_SYNC_URL: raw,
        });
        // The app reads the variable itself: nothing is added to extra.
        assert.equal("syncUrl" in resolved.extra, false);
        assert.equal(
          JSON.stringify(resolved).includes("sync.example.org"),
          false,
        );
      }
    }
  });

  it("accepts plain http to this machine in development builds only", () => {
    for (const url of [
      "http://127.0.0.1:8713",
      "http://localhost:8713",
      "http://10.0.2.2:8713",
    ]) {
      assert.equal(
        syncServerUrlFrom({ EXPO_PUBLIC_SONOLECT_SYNC_URL: url }),
        url,
      );
      assert.equal(
        syncServerUrlFrom({
          NODE_ENV: "development",
          EXPO_PUBLIC_SONOLECT_SYNC_URL: url,
        }),
        url,
      );
      for (const release of [
        { EAS_BUILD_PROFILE: "production" },
        { SONOLECT_RELEASE: "1" },
        // The app would drop plain http there (__DEV__ false) and have no
        // sync: an EAS preview build, or a release variant built locally.
        { EAS_BUILD_PROFILE: "preview", NODE_ENV: "production" },
        { NODE_ENV: "production" },
      ]) {
        assert.throws(
          () =>
            syncServerUrlFrom({
              ...release,
              EXPO_PUBLIC_SONOLECT_SYNC_URL: url,
            }),
          { message: MESSAGES.localSyncUrlInRelease },
          url,
        );
      }
    }
    assert.throws(
      () =>
        resolveReleaseConfig(CONFIG, {
          EAS_BUILD_PROFILE: "production",
          SONOLECT_PRIVACY_POLICY_URL: POLICY,
          EXPO_PUBLIC_SONOLECT_SYNC_URL: "http://127.0.0.1:8713",
        }),
      { message: MESSAGES.localSyncUrlInRelease },
    );
  });

  it("refuses anything else, in every build", () => {
    for (const url of [
      "http://sync.example.org",
      "http://192.168.1.20:8713",
      "ftp://sync.example.org",
      "sync.example.org",
      "https:sync.example.org",
      "https://user:secret@sync.example.org",
      "https://sync.example.org/?vault=1",
      "https://sync.example.org/#key",
      "https://sync example.org",
      "https://sync.example.org:0",
      "https://sync.example.org:70000",
      "https://.example.org",
      "https://sync..example.org",
    ]) {
      for (const env of [{}, { SONOLECT_RELEASE: "1" }]) {
        assert.throws(
          () =>
            resolveReleaseConfig(CONFIG, {
              ...env,
              SONOLECT_PRIVACY_POLICY_URL: POLICY,
              SONOLECT_BUILD_NUMBER: "3",
              EXPO_PUBLIC_SONOLECT_SYNC_URL: url,
            }),
          { message: MESSAGES.invalidSyncUrl },
          url,
        );
      }
    }
  });
});
