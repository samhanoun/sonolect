import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  RECORDER_WINDOW_CONFIG,
  PILL_WIDTH,
  PILL_HEIGHT,
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  showRecorderWindow,
  hideRecorderWindow,
  resizeRecorderWindow,
  moveRecorderWindow,
  isRecorderWindowVisible,
  closeRecorderWindow,
} from "./tauriWindowManager";

describe("tauriWindowManager config constants", () => {
  it("has a recorder window label", () => {
    assert.equal(RECORDER_WINDOW_CONFIG.label, "recorder");
  });

  it("pill dimensions are 320x80", () => {
    assert.equal(PILL_WIDTH, 320);
    assert.equal(PILL_HEIGHT, 80);
    assert.equal(RECORDER_WINDOW_CONFIG.width, PILL_WIDTH);
    assert.equal(RECORDER_WINDOW_CONFIG.height, PILL_HEIGHT);
  });

  it("expanded dimensions are 320x280", () => {
    assert.equal(EXPANDED_WIDTH, 320);
    assert.equal(EXPANDED_HEIGHT, 280);
  });

  it("recorder window is frameless, always-on-top, and transparent", () => {
    assert.equal(RECORDER_WINDOW_CONFIG.decorations, false);
    assert.equal(RECORDER_WINDOW_CONFIG.alwaysOnTop, true);
    assert.equal(RECORDER_WINDOW_CONFIG.transparent, true);
  });

  it("config has no default position (managed by app)", () => {
    assert.equal(RECORDER_WINDOW_CONFIG.x, undefined);
    assert.equal(RECORDER_WINDOW_CONFIG.y, undefined);
  });
});

describe("tauriWindowManager browser fallback", () => {
  it("showRecorderWindow resolves without error in browser", async () => {
    await showRecorderWindow();
  });

  it("hideRecorderWindow resolves without error in browser", async () => {
    await hideRecorderWindow();
  });

  it("resizeRecorderWindow resolves without error in browser", async () => {
    await resizeRecorderWindow(true);
    await resizeRecorderWindow(false);
  });

  it("moveRecorderWindow resolves without error in browser", async () => {
    await moveRecorderWindow(100, 200);
  });

  it("isRecorderWindowVisible returns false in browser", async () => {
    const visible = await isRecorderWindowVisible();
    assert.equal(visible, false);
  });

  it("closeRecorderWindow resolves without error in browser", async () => {
    await closeRecorderWindow();
  });
});

describe("tauriWindowManager size calculations", () => {
  it("pill size is smaller than expanded size", () => {
    assert.ok(PILL_HEIGHT < EXPANDED_HEIGHT);
    assert.equal(PILL_WIDTH, EXPANDED_WIDTH);
  });

  it("expanded height accommodates waveform and preview areas", () => {
    // Expanded is 280px — enough for header + waveform + preview + actions
    assert.ok(EXPANDED_HEIGHT >= 200);
    assert.ok(EXPANDED_HEIGHT <= 400);
  });

  it("pill height is compact enough for minimal UI", () => {
    // Pill at 80px — enough for status dot + timer
    assert.ok(PILL_HEIGHT >= 40);
    assert.ok(PILL_HEIGHT <= 120);
  });
});
