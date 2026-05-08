import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  detectPlatform,
  getPermissionInstructions,
  getMissingPermissions,
  canInsertText,
  canRecordAudio,
  canCaptureSystemAudio,
} from "./platformPermissions";
import type {
  PlatformPermission,
  PermissionStatus,
  PermissionCheckResult,
} from "./platformPermissions";

// ── Helper to build a result ──────────────────────────────────────────

function makeResult(
  permission: PlatformPermission,
  status: PermissionStatus,
  platform = "macos",
): PermissionCheckResult {
  return {
    permission,
    status,
    platform,
    instructions: getPermissionInstructions(permission, platform),
  };
}

// ── detectPlatform ────────────────────────────────────────────────────

describe("detectPlatform", () => {
  it("returns 'unknown' when navigator is undefined", () => {
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
    });
    try {
      assert.equal(detectPlatform(), "unknown");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: origNavigator,
        configurable: true,
      });
    }
  });

  it("detects platform from user agent string", () => {
    // In Node test env the platform is based on the actual UA or lack thereof.
    // We just verify the function returns a string.
    const result = detectPlatform();
    assert.ok(typeof result === "string");
  });
});

// ── getPermissionInstructions ─────────────────────────────────────────

describe("getPermissionInstructions", () => {
  it("returns macOS accessibility instructions", () => {
    const instructions = getPermissionInstructions("accessibility", "macos");
    assert.match(instructions, /System Settings/);
    assert.match(instructions, /Accessibility/);
    assert.match(instructions, /Sonolect/);
  });

  it("returns macOS microphone instructions", () => {
    const instructions = getPermissionInstructions("microphone", "macos");
    assert.match(instructions, /Microphone/);
    assert.match(instructions, /Sonolect/);
  });

  it("returns Windows accessibility instructions (not needed)", () => {
    const instructions = getPermissionInstructions("accessibility", "windows");
    assert.match(instructions, /No additional permissions/);
  });

  it("returns Linux accessibility instructions (not needed)", () => {
    const instructions = getPermissionInstructions("accessibility", "linux");
    assert.match(instructions, /No additional permissions/);
  });

  it("returns Linux microphone instructions", () => {
    const instructions = getPermissionInstructions("microphone", "linux");
    assert.match(instructions, /microphone/i);
  });

  it("returns macOS screen-recording instructions", () => {
    const instructions = getPermissionInstructions("screen-recording", "macos");
    assert.match(instructions, /Screen Recording/);
  });

  it("returns system-audio instructions per platform", () => {
    assert.match(
      getPermissionInstructions("system-audio", "macos"),
      /BlackHole|Loopback/,
    );
    assert.match(
      getPermissionInstructions("system-audio", "windows"),
      /Stereo Mix/,
    );
    assert.match(
      getPermissionInstructions("system-audio", "linux"),
      /PulseAudio|PipeWire/,
    );
  });

  it("falls back to generic instructions for unknown platform", () => {
    const instructions = getPermissionInstructions("accessibility", "unknown");
    assert.ok(instructions.length > 0);
  });
});

// ── getMissingPermissions ─────────────────────────────────────────────

describe("getMissingPermissions", () => {
  it("returns empty array when all permissions are granted", () => {
    const results = [
      makeResult("accessibility", "granted"),
      makeResult("microphone", "granted"),
    ];
    assert.equal(getMissingPermissions(results).length, 0);
  });

  it("filters out granted and unsupported permissions", () => {
    const results = [
      makeResult("accessibility", "granted"),
      makeResult("microphone", "denied"),
      makeResult("screen-recording", "unsupported"),
      makeResult("system-audio", "not-determined"),
    ];
    const missing = getMissingPermissions(results);
    assert.equal(missing.length, 2);
    assert.equal(missing[0]!.permission, "microphone");
    assert.equal(missing[1]!.permission, "system-audio");
  });

  it("returns all when all are denied or not-determined", () => {
    const results = [
      makeResult("accessibility", "denied"),
      makeResult("microphone", "not-determined"),
    ];
    assert.equal(getMissingPermissions(results).length, 2);
  });
});

// ── canInsertText ─────────────────────────────────────────────────────

describe("canInsertText", () => {
  it("returns true when accessibility is granted", () => {
    const results = [makeResult("accessibility", "granted")];
    assert.equal(canInsertText(results), true);
  });

  it("returns false when accessibility is denied", () => {
    const results = [makeResult("accessibility", "denied")];
    assert.equal(canInsertText(results), false);
  });

  it("returns false when accessibility is not-determined", () => {
    const results = [makeResult("accessibility", "not-determined")];
    assert.equal(canInsertText(results), false);
  });

  it("returns false when accessibility result is missing", () => {
    const results = [makeResult("microphone", "granted")];
    assert.equal(canInsertText(results), false);
  });
});

// ── canRecordAudio ────────────────────────────────────────────────────

describe("canRecordAudio", () => {
  it("returns true when microphone is granted", () => {
    const results = [makeResult("microphone", "granted")];
    assert.equal(canRecordAudio(results), true);
  });

  it("returns false when microphone is denied", () => {
    const results = [makeResult("microphone", "denied")];
    assert.equal(canRecordAudio(results), false);
  });

  it("returns false when microphone result is missing", () => {
    assert.equal(canRecordAudio([]), false);
  });
});

// ── canCaptureSystemAudio ─────────────────────────────────────────────

describe("canCaptureSystemAudio", () => {
  it("returns true when system-audio is granted", () => {
    const results = [makeResult("system-audio", "granted")];
    assert.equal(canCaptureSystemAudio(results), true);
  });

  it("returns false when system-audio is denied", () => {
    const results = [makeResult("system-audio", "denied")];
    assert.equal(canCaptureSystemAudio(results), false);
  });

  it("returns false when system-audio result is missing", () => {
    assert.equal(canCaptureSystemAudio([]), false);
  });
});
