const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
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
      { SONOLECT_PRIVACY_POLICY_URL: ` ${POLICY}\n`, SONOLECT_RELEASE: "1" },
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
