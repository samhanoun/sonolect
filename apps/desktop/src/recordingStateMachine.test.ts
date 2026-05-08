import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  recordingTransition,
  createTimerState,
  getRecordingDuration,
  updateTimerOnEvent,
  formatDuration,
} from "./recordingStateMachine";
import type { RecordingState, RecordingEvent } from "./recordingStateMachine";

describe("recording state machine transitions", () => {
  it("follows the happy path: idle → countdown → recording → processing → previewing → inserting → done", () => {
    let state: RecordingState = "idle";
    state = recordingTransition(state, "START");
    assert.equal(state, "countdown");
    state = recordingTransition(state, "COUNTDOWN_DONE");
    assert.equal(state, "recording");
    state = recordingTransition(state, "FINISH");
    assert.equal(state, "processing");
    state = recordingTransition(state, "PROCESS_COMPLETE");
    assert.equal(state, "previewing");
    state = recordingTransition(state, "INSERT");
    assert.equal(state, "inserting");
    state = recordingTransition(state, "INSERT_COMPLETE");
    assert.equal(state, "done");
  });

  it("returns current state for invalid transitions", () => {
    assert.equal(recordingTransition("idle", "FINISH"), "idle");
    assert.equal(recordingTransition("idle", "PAUSE"), "idle");
    assert.equal(recordingTransition("done", "FINISH"), "done");
    assert.equal(recordingTransition("processing", "START"), "processing");
    assert.equal(recordingTransition("previewing", "FINISH"), "previewing");
  });

  it("allows cancel from countdown, recording, processing, and previewing", () => {
    assert.equal(recordingTransition("countdown", "CANCEL"), "idle");
    assert.equal(recordingTransition("recording", "CANCEL"), "idle");
    assert.equal(recordingTransition("processing", "CANCEL"), "idle");
    assert.equal(recordingTransition("previewing", "CANCEL"), "idle");
  });

  it("transitions to error from recording-active states", () => {
    assert.equal(recordingTransition("countdown", "ERROR"), "error");
    assert.equal(recordingTransition("recording", "ERROR"), "error");
    assert.equal(recordingTransition("processing", "ERROR"), "error");
    assert.equal(recordingTransition("previewing", "ERROR"), "error");
    assert.equal(recordingTransition("inserting", "ERROR"), "error");
  });

  it("recovers from error via RESET", () => {
    assert.equal(recordingTransition("error", "RESET"), "idle");
  });

  it("recovers from done via RESET", () => {
    assert.equal(recordingTransition("done", "RESET"), "idle");
  });

  it("handles PAUSE and RESUME in recording state", () => {
    assert.equal(recordingTransition("recording", "PAUSE"), "recording");
    assert.equal(recordingTransition("recording", "RESUME"), "recording");
  });
});

describe("recording timer calculations", () => {
  it("returns zero duration for fresh timer", () => {
    const timer = createTimerState();
    assert.equal(getRecordingDuration(timer, Date.now()), 0);
  });

  it("tracks elapsed time from COUNTDOWN_DONE", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    assert.equal(getRecordingDuration(timer, 4000), 3000);
  });

  it("accounts for paused duration", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    timer = updateTimerOnEvent(timer, "PAUSE", 3000);
    timer = updateTimerOnEvent(timer, "RESUME", 5000);
    // 2s paused, total elapsed 6s at now=7000, so active = 6s - 2s = 4s
    assert.equal(getRecordingDuration(timer, 7000), 4000);
  });

  it("freezes duration on FINISH", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    timer = updateTimerOnEvent(timer, "FINISH", 6000);
    assert.equal(timer.totalDuration, 5000);
    // Duration stays frozen even as time advances
    assert.equal(getRecordingDuration(timer, 99000), 5000);
  });

  it("resets timer on CANCEL", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    timer = updateTimerOnEvent(timer, "CANCEL", 5000);
    assert.equal(timer.startedAt, null);
    assert.equal(timer.totalDuration, 0);
  });

  it("ignores duplicate PAUSE when already paused", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    timer = updateTimerOnEvent(timer, "PAUSE", 3000);
    const timerAfterDupPause = updateTimerOnEvent(timer, "PAUSE", 4000);
    assert.equal(timerAfterDupPause.pausedAt, 3000);
  });

  it("ignores RESUME when not paused", () => {
    let timer = createTimerState();
    timer = updateTimerOnEvent(timer, "COUNTDOWN_DONE", 1000);
    const timerAfterResume = updateTimerOnEvent(timer, "RESUME", 2000);
    assert.equal(timerAfterResume.pausedAt, null);
    assert.equal(timerAfterResume.pausedDuration, 0);
  });
});

describe("formatDuration", () => {
  it("formats zero milliseconds as 00:00", () => {
    assert.equal(formatDuration(0), "00:00");
  });

  it("formats seconds correctly in mm:ss", () => {
    assert.equal(formatDuration(5000), "00:05");
    assert.equal(formatDuration(59000), "00:59");
  });

  it("formats minutes and seconds", () => {
    assert.equal(formatDuration(60000), "01:00");
    assert.equal(formatDuration(90000), "01:30");
    assert.equal(formatDuration(605000), "10:05");
  });

  it("floors partial seconds", () => {
    assert.equal(formatDuration(1500), "00:01");
    assert.equal(formatDuration(999), "00:00");
  });

  it("clamps negative values to 00:00", () => {
    assert.equal(formatDuration(-5000), "00:00");
  });
});
