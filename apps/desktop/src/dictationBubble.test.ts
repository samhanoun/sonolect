import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BUBBLE_ACTIVE_SIZE,
  BUBBLE_IDLE_SIZE,
  bubbleDetailFor,
  bubblePhaseFor,
  bubbleSizeFor,
  displayAccelerator,
  formatElapsed,
  isBubbleAction,
  levelFromSamples,
  parseBubbleVisibility,
  previewDetail,
  pushLevel,
  shouldShowBubble,
} from "./dictationBubble";

describe("dictation bubble phases", () => {
  it("maps capture states to bubble phases", () => {
    assert.equal(bubblePhaseFor("idle", undefined, "hotkey"), "idle");
    assert.equal(
      bubblePhaseFor("requesting-permission", undefined, "hotkey"),
      "listening",
    );
    assert.equal(bubblePhaseFor("recording", undefined, "app"), "listening");
    assert.equal(
      bubblePhaseFor("uploading", undefined, "bubble"),
      "transcribing",
    );
    assert.equal(bubblePhaseFor("error", undefined, "hotkey"), "error");
  });

  it("shows the delivery outcome once transcription completes", () => {
    assert.equal(
      bubblePhaseFor("completed", { kind: "inserted", text: "hi" }, "hotkey"),
      "inserted",
    );
    assert.equal(
      bubblePhaseFor(
        "completed",
        { kind: "copied", text: "hi", reason: "x" },
        "bubble",
      ),
      "copied",
    );
    assert.equal(
      bubblePhaseFor("completed", { kind: "error", message: "no" }, "hotkey"),
      "error",
    );
    assert.equal(
      bubblePhaseFor("completed", { kind: "empty" }, "hotkey"),
      "idle",
    );
  });

  it("keeps showing progress while the text is being pasted", () => {
    // Transcribed but the paste has not reported back yet: no idle flicker.
    assert.equal(
      bubblePhaseFor("completed", undefined, "hotkey"),
      "transcribing",
    );
  });

  it("goes idle after in-app captures, which land in the editor", () => {
    assert.equal(bubblePhaseFor("completed", undefined, "app"), "idle");
    assert.equal(
      bubblePhaseFor("completed", { kind: "inserted", text: "x" }, "app"),
      "idle",
    );
  });

  it("writes short, human detail lines", () => {
    assert.equal(
      bubbleDetailFor(
        "inserted",
        { kind: "inserted", text: "Hello   world" },
        undefined,
      ),
      "Hello world",
    );
    assert.match(
      bubbleDetailFor(
        "copied",
        { kind: "copied", text: "a", reason: "r" },
        undefined,
      ) ?? "",
      /Ctrl\+V/,
    );
    assert.equal(
      bubbleDetailFor("error", undefined, "error.micPermissionDenied"),
      "Microphone access was denied.",
    );
    assert.equal(bubbleDetailFor("listening", undefined, undefined), null);
    const long = previewDetail("x".repeat(200));
    assert.ok(long.length <= 64);
    assert.ok(long.endsWith("…"));
  });
});

describe("dictation bubble visibility and size", () => {
  it("parses the saved visibility with a safe default", () => {
    assert.equal(parseBubbleVisibility("off"), "off");
    assert.equal(parseBubbleVisibility("dictating"), "dictating");
    assert.equal(parseBubbleVisibility("bogus"), "always");
    assert.equal(parseBubbleVisibility(null), "always");
  });

  it("only shows the idle pill when set to always", () => {
    assert.equal(shouldShowBubble("always", "idle"), true);
    assert.equal(shouldShowBubble("dictating", "idle"), false);
    assert.equal(shouldShowBubble("dictating", "listening"), true);
    assert.equal(shouldShowBubble("off", "listening"), false);
  });

  it("uses a compact window when idle", () => {
    assert.deepEqual(bubbleSizeFor("idle"), BUBBLE_IDLE_SIZE);
    assert.deepEqual(bubbleSizeFor("listening"), BUBBLE_ACTIVE_SIZE);
    assert.ok(BUBBLE_IDLE_SIZE.width < BUBBLE_ACTIVE_SIZE.width);
  });

  it("accepts only known actions from the bubble window", () => {
    assert.equal(isBubbleAction("toggle"), true);
    assert.equal(isBubbleAction("cancel"), true);
    assert.equal(isBubbleAction("rm -rf"), false);
    assert.equal(isBubbleAction({ action: "toggle" }), false);
  });
});

describe("dictation bubble meter and labels", () => {
  it("turns PCM blocks into a 0..1 level", () => {
    assert.equal(levelFromSamples([]), 0);
    assert.equal(levelFromSamples(new Float32Array(512)), 0);
    const loud = levelFromSamples(new Float32Array(512).fill(0.5));
    assert.equal(loud, 1);
    const speech = levelFromSamples(new Float32Array(512).fill(0.05));
    assert.ok(speech > 0.3 && speech < 1);
  });

  it("keeps a rolling level history", () => {
    let history: number[] = [];
    for (let i = 0; i < 25; i += 1) history = pushLevel(history, i / 25, 18);
    assert.equal(history.length, 18);
    assert.equal(history.at(-1), 24 / 25);
    assert.deepEqual(pushLevel([], 4), [1]);
  });

  it("formats the timer and the hotkey", () => {
    assert.equal(formatElapsed(0), "0:00");
    assert.equal(formatElapsed(65_400), "1:05");
    assert.equal(
      displayAccelerator("CommandOrControl+Shift+M"),
      "Ctrl+Shift+M",
    );
    assert.equal(displayAccelerator("CommandOrControl+Shift+M", true), "⌘⇧M");
  });
});

describe("bubble window configuration", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  ) as { app: { windows: Array<Record<string, unknown>> } };
  const bubble = config.app.windows.find((w) => w.label === "recorder");

  it("never takes focus from the app being dictated into", () => {
    assert.ok(bubble);
    assert.equal(bubble.focus, false);
    assert.equal(bubble.focusable, false);
    assert.equal(bubble.alwaysOnTop, true);
    assert.equal(bubble.skipTaskbar, true);
    assert.equal(bubble.visible, false);
    assert.equal(bubble.decorations, false);
    assert.equal(bubble.transparent, true);
  });

  it("keeps the Linux window list in step with the main config", () => {
    // GTK keeps a non-resizable window at its content's natural size
    // (200×200 for a webview) whatever size is asked for, so on Linux the
    // bubble is resizable. A platform config replaces the whole windows
    // array, so everything else has to match the main config.
    const linux = JSON.parse(
      readFileSync(
        new URL("../src-tauri/tauri.linux.conf.json", import.meta.url),
        "utf8",
      ),
    ) as { app: { windows: Array<Record<string, unknown>> } };
    assert.equal(bubble?.resizable, false);
    assert.deepEqual(
      linux.app.windows,
      config.app.windows.map((w) =>
        w.label === "recorder" ? { ...w, resizable: true } : w,
      ),
    );
  });

  it("grants the bubble window events only", () => {
    const capability = JSON.parse(
      readFileSync(
        new URL("../src-tauri/capabilities/bubble.json", import.meta.url),
        "utf8",
      ),
    ) as { windows: string[]; permissions: string[] };
    assert.deepEqual(capability.windows, ["recorder"]);
    for (const permission of capability.permissions) {
      assert.match(permission, /^core:event:/);
    }
  });
});
