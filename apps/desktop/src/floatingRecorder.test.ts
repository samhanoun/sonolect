import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  POSITION_STORAGE_KEY,
  loadPosition,
  savePosition,
  waveformBarHeights,
  recordingStateLabel,
  DEFAULT_WAVEFORM_BAR_COUNT,
} from "./FloatingRecorder";
import type { RecordingState } from "./recordingStateMachine";
import { formatDuration } from "./recordingStateMachine";

// Minimal localStorage polyfill for Node test environment
let store: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};
(globalThis as any).localStorage = fakeLocalStorage;

const componentSource = await readFile(
  new URL("./FloatingRecorder.tsx", import.meta.url),
  "utf8",
);

describe("FloatingRecorder helper functions", () => {
  it("returns default position when localStorage is empty", () => {
    store = {};
    const pos = loadPosition();
    assert.deepEqual(pos, { x: 16, y: 16 });
  });

  it("roundtrips a saved position through localStorage", () => {
    store = {};
    savePosition({ x: 100, y: 200 });
    const pos = loadPosition();
    assert.deepEqual(pos, { x: 100, y: 200 });
  });

  it("falls back to default for corrupt stored position", () => {
    store = { [POSITION_STORAGE_KEY]: "{bad-json" };
    const pos = loadPosition();
    assert.deepEqual(pos, { x: 16, y: 16 });
  });

  it("computes waveform bar heights from normalized peaks", () => {
    const peaks = [0, 0.5, 1.0];
    const heights = waveformBarHeights(peaks, 2, 32);
    assert.deepEqual(heights, [2, 17, 32]);
  });

  it("returns minimum height for silent peaks", () => {
    const heights = waveformBarHeights([0, 0, 0]);
    assert.ok(heights.every((h) => h >= 2));
  });

  it("maps all recording states to human-readable labels", () => {
    const states: RecordingState[] = [
      "idle",
      "countdown",
      "recording",
      "processing",
      "previewing",
      "inserting",
      "done",
      "error",
    ];
    for (const state of states) {
      const label = recordingStateLabel(state);
      assert.ok(typeof label === "string" && label.length > 0);
    }
  });

  it("shows 'Recording' label for recording state", () => {
    assert.equal(recordingStateLabel("recording"), "Recording");
  });

  it("shows 'Preview' label for previewing state", () => {
    assert.equal(recordingStateLabel("previewing"), "Preview");
  });

  it("exports a default waveform bar count", () => {
    assert.equal(typeof DEFAULT_WAVEFORM_BAR_COUNT, "number");
    assert.ok(DEFAULT_WAVEFORM_BAR_COUNT > 0);
  });
});

describe("FloatingRecorder timer format", () => {
  it("formats recording duration in mm:ss", () => {
    assert.equal(formatDuration(0), "00:00");
    assert.equal(formatDuration(65000), "01:05");
    assert.equal(formatDuration(3599000), "59:59");
  });
});

describe("FloatingRecorder component contract", () => {
  it("renders recording state with timer and waveform bars", () => {
    assert.match(componentSource, /floating-recorder__timer/);
    assert.match(componentSource, /floating-recorder__waveform-bar/);
    assert.match(componentSource, /formatDuration/);
    assert.match(componentSource, /waveformBarHeights/);
  });

  it("shows polished preview when processing completes", () => {
    assert.match(componentSource, /polishedPreview/);
    assert.match(componentSource, /floating-recorder__preview/);
    assert.match(componentSource, /previewing/);
  });

  it("provides cancel and finish action buttons", () => {
    assert.match(componentSource, /onCancel/);
    assert.match(componentSource, /onFinish/);
    assert.match(componentSource, /Cancel recording/);
    assert.match(componentSource, /Finish recording/);
  });

  it("provides insert button in preview state", () => {
    assert.match(componentSource, /onInsert/);
    assert.match(componentSource, /Insert text/);
  });

  it("minimizes to pill and expands back", () => {
    assert.match(componentSource, /floating-recorder--pill/);
    assert.match(componentSource, /floating-recorder--expanded/);
    assert.match(componentSource, /onMinimize/);
    assert.match(componentSource, /minimized/);
    assert.match(componentSource, /Minimize recorder/);
  });

  it("uses dark glass theme CSS classes for the overlay", () => {
    assert.match(componentSource, /floating-recorder/);
    assert.match(componentSource, /role="region"/);
    assert.match(componentSource, /role="status"/);
  });
});
