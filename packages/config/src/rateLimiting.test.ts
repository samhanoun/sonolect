import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_RATE_LIMITS,
  createPreset,
  buildRateLimitConfig,
  toFastifyRateLimitOptions,
} from "./rateLimiting";
import type { RateLimitPreset } from "./rateLimiting";

describe("DEFAULT_RATE_LIMITS", () => {
  it("has all required endpoint categories", () => {
    const expected: (keyof typeof DEFAULT_RATE_LIMITS)[] = [
      "auth",
      "transcription",
      "ai",
      "upload",
      "billing",
      "general",
    ];
    for (const key of expected) {
      assert.ok(key in DEFAULT_RATE_LIMITS, `Missing preset: ${key}`);
    }
  });

  it("auth allows 5 requests per 15 minutes", () => {
    assert.strictEqual(DEFAULT_RATE_LIMITS.auth.max, 5);
    assert.strictEqual(DEFAULT_RATE_LIMITS.auth.timeWindow, 15 * 60_000);
  });

  it("transcription allows 30 requests per minute", () => {
    assert.strictEqual(DEFAULT_RATE_LIMITS.transcription.max, 30);
    assert.strictEqual(DEFAULT_RATE_LIMITS.transcription.timeWindow, 60_000);
  });

  it("general allows 100 requests per minute", () => {
    assert.strictEqual(DEFAULT_RATE_LIMITS.general.max, 100);
    assert.strictEqual(DEFAULT_RATE_LIMITS.general.timeWindow, 60_000);
  });

  it("every preset has a positive max and timeWindow", () => {
    for (const [key, preset] of Object.entries(DEFAULT_RATE_LIMITS)) {
      assert.ok(preset.max > 0, `${key}.max must be positive`);
      assert.ok(preset.timeWindow > 0, `${key}.timeWindow must be positive`);
      assert.ok(
        typeof preset.label === "string" && preset.label.length > 0,
        `${key}.label must be a non-empty string`,
      );
    }
  });
});

describe("createPreset", () => {
  it("creates a valid preset", () => {
    const preset = createPreset(50, 30_000, "custom");
    assert.strictEqual(preset.max, 50);
    assert.strictEqual(preset.timeWindow, 30_000);
    assert.strictEqual(preset.label, "custom");
  });
});

describe("buildRateLimitConfig", () => {
  it("returns defaults when called with no overrides", () => {
    const config = buildRateLimitConfig();
    assert.deepStrictEqual(config, DEFAULT_RATE_LIMITS);
  });

  it("overrides only the specified fields", () => {
    const config = buildRateLimitConfig({
      auth: { max: 3 },
    });
    assert.strictEqual(config.auth.max, 3);
    // timeWindow should remain from defaults
    assert.strictEqual(
      config.auth.timeWindow,
      DEFAULT_RATE_LIMITS.auth.timeWindow,
    );
    // Other presets untouched
    assert.deepStrictEqual(config.general, DEFAULT_RATE_LIMITS.general);
  });

  it("can override multiple presets", () => {
    const config = buildRateLimitConfig({
      auth: { max: 2 },
      general: { max: 200, timeWindow: 120_000 },
    });
    assert.strictEqual(config.auth.max, 2);
    assert.strictEqual(config.general.max, 200);
    assert.strictEqual(config.general.timeWindow, 120_000);
  });

  it("does not mutate DEFAULT_RATE_LIMITS", () => {
    const before = { ...DEFAULT_RATE_LIMITS.auth };
    buildRateLimitConfig({ auth: { max: 999 } });
    assert.deepStrictEqual(DEFAULT_RATE_LIMITS.auth, before);
  });
});

describe("toFastifyRateLimitOptions", () => {
  it("maps preset to Fastify-compatible options", () => {
    const preset: RateLimitPreset = createPreset(10, 60_000, "test");
    const opts = toFastifyRateLimitOptions(preset);

    assert.strictEqual(opts.max, 10);
    assert.strictEqual(opts.timeWindow, 60_000);
    assert.ok(opts.addHeaders);
    assert.ok(opts.addHeadersOnExceeding);
  });

  it("includes rate limit response headers", () => {
    const opts = toFastifyRateLimitOptions(DEFAULT_RATE_LIMITS.general);
    assert.strictEqual(opts.addHeaders["retry-after"], true);
    assert.strictEqual(opts.addHeaders["x-ratelimit-limit"], true);
  });
});
