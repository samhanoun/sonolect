import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  PRIVACY_PRESETS,
  getPrivacyConfig,
  isCloudAllowed,
  isAudioStorageAllowed,
  shouldRedactBeforeCloud,
  validatePrivacyCompliance,
} from "./privacyEnforcement";
import type { PrivacyConfig, PrivacyMode } from "./privacyEnforcement";

/* ── PRIVACY_PRESETS ──────────────────────────────────────────────── */

describe("PRIVACY_PRESETS", () => {
  it("has all three modes", () => {
    const modes: PrivacyMode[] = ["standard", "enhanced", "maximum"];
    for (const mode of modes) {
      assert.ok(mode in PRIVACY_PRESETS, `Missing preset: ${mode}`);
    }
  });

  it("standard allows cloud and persistent audio", () => {
    const s = PRIVACY_PRESETS.standard;
    assert.strictEqual(s.localOnly, false);
    assert.strictEqual(s.audioRetention, "persistent");
    assert.strictEqual(s.telemetryEnabled, true);
    assert.strictEqual(s.crashReportingEnabled, true);
  });

  it("enhanced restricts audio to session, disables telemetry", () => {
    const e = PRIVACY_PRESETS.enhanced;
    assert.strictEqual(e.localOnly, false);
    assert.strictEqual(e.audioRetention, "session");
    assert.strictEqual(e.telemetryEnabled, false);
    assert.strictEqual(e.crashReportingEnabled, true);
  });

  it("maximum is local-only with no audio and no telemetry", () => {
    const m = PRIVACY_PRESETS.maximum;
    assert.strictEqual(m.localOnly, true);
    assert.strictEqual(m.audioRetention, "none");
    assert.strictEqual(m.transcriptRetention, "session");
    assert.strictEqual(m.telemetryEnabled, false);
    assert.strictEqual(m.crashReportingEnabled, false);
  });
});

/* ── getPrivacyConfig ─────────────────────────────────────────────── */

describe("getPrivacyConfig", () => {
  it("returns the correct preset for each mode", () => {
    assert.deepStrictEqual(
      getPrivacyConfig("standard"),
      PRIVACY_PRESETS.standard,
    );
    assert.deepStrictEqual(
      getPrivacyConfig("enhanced"),
      PRIVACY_PRESETS.enhanced,
    );
    assert.deepStrictEqual(
      getPrivacyConfig("maximum"),
      PRIVACY_PRESETS.maximum,
    );
  });
});

/* ── isCloudAllowed ───────────────────────────────────────────────── */

describe("isCloudAllowed", () => {
  it("returns true for standard and enhanced", () => {
    assert.strictEqual(isCloudAllowed(PRIVACY_PRESETS.standard), true);
    assert.strictEqual(isCloudAllowed(PRIVACY_PRESETS.enhanced), true);
  });

  it("returns false for maximum", () => {
    assert.strictEqual(isCloudAllowed(PRIVACY_PRESETS.maximum), false);
  });
});

/* ── isAudioStorageAllowed ────────────────────────────────────────── */

describe("isAudioStorageAllowed", () => {
  it("returns true for standard (persistent)", () => {
    assert.strictEqual(isAudioStorageAllowed(PRIVACY_PRESETS.standard), true);
  });

  it("returns true for enhanced (session)", () => {
    assert.strictEqual(isAudioStorageAllowed(PRIVACY_PRESETS.enhanced), true);
  });

  it("returns false for maximum (none)", () => {
    assert.strictEqual(isAudioStorageAllowed(PRIVACY_PRESETS.maximum), false);
  });
});

/* ── shouldRedactBeforeCloud ──────────────────────────────────────── */

describe("shouldRedactBeforeCloud", () => {
  it("returns false for standard", () => {
    assert.strictEqual(
      shouldRedactBeforeCloud(PRIVACY_PRESETS.standard),
      false,
    );
  });

  it("returns true for enhanced", () => {
    assert.strictEqual(shouldRedactBeforeCloud(PRIVACY_PRESETS.enhanced), true);
  });

  it("returns true for maximum", () => {
    assert.strictEqual(shouldRedactBeforeCloud(PRIVACY_PRESETS.maximum), true);
  });
});

/* ── validatePrivacyCompliance ────────────────────────────────────── */

describe("validatePrivacyCompliance", () => {
  describe("standard mode", () => {
    const cfg = PRIVACY_PRESETS.standard;

    it("allows cloud transcription", () => {
      const r = validatePrivacyCompliance(cfg, "cloud_transcription");
      assert.strictEqual(r.allowed, true);
    });

    it("allows audio persistence", () => {
      const r = validatePrivacyCompliance(cfg, "audio_persist");
      assert.strictEqual(r.allowed, true);
    });

    it("allows telemetry", () => {
      const r = validatePrivacyCompliance(cfg, "telemetry_send");
      assert.strictEqual(r.allowed, true);
    });

    it("allows crash reporting", () => {
      const r = validatePrivacyCompliance(cfg, "crash_report");
      assert.strictEqual(r.allowed, true);
    });
  });

  describe("enhanced mode", () => {
    const cfg = PRIVACY_PRESETS.enhanced;

    it("allows cloud operations (not local-only)", () => {
      const r = validatePrivacyCompliance(cfg, "cloud_storage");
      assert.strictEqual(r.allowed, true);
    });

    it("denies telemetry", () => {
      const r = validatePrivacyCompliance(cfg, "telemetry_send");
      assert.strictEqual(r.allowed, false);
      assert.ok(r.reason?.includes("enhanced"));
    });
  });

  describe("maximum mode", () => {
    const cfg = PRIVACY_PRESETS.maximum;

    it("denies cloud transcription", () => {
      const r = validatePrivacyCompliance(cfg, "cloud_transcription");
      assert.strictEqual(r.allowed, false);
      assert.ok(r.reason?.includes("maximum"));
    });

    it("denies cloud storage", () => {
      const r = validatePrivacyCompliance(cfg, "cloud_storage");
      assert.strictEqual(r.allowed, false);
    });

    it("denies audio persistence", () => {
      const r = validatePrivacyCompliance(cfg, "audio_persist");
      assert.strictEqual(r.allowed, false);
    });

    it("denies telemetry", () => {
      const r = validatePrivacyCompliance(cfg, "telemetry_send");
      assert.strictEqual(r.allowed, false);
    });

    it("denies crash reporting", () => {
      const r = validatePrivacyCompliance(cfg, "crash_report");
      assert.strictEqual(r.allowed, false);
    });
  });

  it("always allows data export (GDPR right)", () => {
    for (const mode of ["standard", "enhanced", "maximum"] as const) {
      const r = validatePrivacyCompliance(PRIVACY_PRESETS[mode], "data_export");
      assert.strictEqual(
        r.allowed,
        true,
        `data_export should be allowed in ${mode}`,
      );
    }
  });
});
