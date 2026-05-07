import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  getSystemAudioSetupGuide,
  resetCaptureSession,
  getActiveCaptureSession,
} from "./systemAudioCapture";
import type { SystemAudioStatus, CaptureSession } from "./systemAudioCapture";

describe("systemAudioCapture", () => {
  // ── Type handling ──────────────────────────────────────────────
  describe("SystemAudioStatus type handling", () => {
    it("accepts a fully available status", () => {
      const status: SystemAudioStatus = {
        available: true,
        method: "pulseaudio-monitor",
        setupInstructions: "Ready to capture.",
      };
      assert.equal(status.available, true);
      assert.equal(status.method, "pulseaudio-monitor");
    });

    it("accepts an unavailable status with instructions", () => {
      const status: SystemAudioStatus = {
        available: false,
        method: "none",
        setupInstructions: "Install PulseAudio.",
      };
      assert.equal(status.available, false);
      assert.equal(status.method, "none");
      assert.ok(status.setupInstructions.length > 0);
    });
  });

  // ── CaptureSession type handling ───────────────────────────────
  describe("CaptureSession type handling", () => {
    it("accepts a recording session", () => {
      const session: CaptureSession = {
        id: "capture-1",
        startedAt: "2026-05-07T10:00:00Z",
        outputPath: "/tmp/test.wav",
        status: "recording",
      };
      assert.equal(session.status, "recording");
      assert.equal(session.id, "capture-1");
    });

    it("accepts a stopped session", () => {
      const session: CaptureSession = {
        id: "capture-2",
        startedAt: "2026-05-07T10:00:00Z",
        outputPath: "/tmp/test.wav",
        status: "stopped",
      };
      assert.equal(session.status, "stopped");
    });

    it("accepts an error session", () => {
      const session: CaptureSession = {
        id: "capture-3",
        startedAt: "2026-05-07T10:00:00Z",
        outputPath: "/tmp/test.wav",
        status: "error",
      };
      assert.equal(session.status, "error");
    });
  });

  // ── Setup guide ────────────────────────────────────────────────
  describe("getSystemAudioSetupGuide", () => {
    it("returns Linux-specific instructions for linux platform", () => {
      const guide = getSystemAudioSetupGuide("linux");
      assert.ok(guide.includes("Linux"));
      assert.ok(guide.includes("PulseAudio"));
      assert.ok(guide.includes("pactl"));
    });

    it("returns macOS-specific instructions for darwin platform", () => {
      const guide = getSystemAudioSetupGuide("darwin");
      assert.ok(guide.includes("macOS"));
      assert.ok(guide.includes("BlackHole"));
      assert.ok(guide.includes("ffmpeg"));
    });

    it("returns macOS-specific instructions for macos string", () => {
      const guide = getSystemAudioSetupGuide("macos");
      assert.ok(guide.includes("macOS"));
    });

    it("returns Windows-specific instructions for windows platform", () => {
      const guide = getSystemAudioSetupGuide("windows");
      assert.ok(guide.includes("Windows"));
      assert.ok(guide.includes("Stereo Mix"));
      assert.ok(guide.includes("ffmpeg"));
    });

    it("returns Windows-specific instructions for win32 string", () => {
      const guide = getSystemAudioSetupGuide("win32");
      assert.ok(guide.includes("Windows"));
    });

    it("returns generic message for unknown platforms", () => {
      const guide = getSystemAudioSetupGuide("freebsd");
      assert.ok(guide.includes("not available"));
    });

    it("is case-insensitive for platform strings", () => {
      const guide = getSystemAudioSetupGuide("LINUX");
      assert.ok(guide.includes("Linux"));
    });
  });

  // ── Capture session state ──────────────────────────────────────
  describe("capture session management", () => {
    it("initially has no active session", () => {
      resetCaptureSession();
      assert.equal(getActiveCaptureSession(), null);
    });

    it("resetCaptureSession clears the session", () => {
      resetCaptureSession();
      const session = getActiveCaptureSession();
      assert.equal(session, null);
    });
  });
});
