import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CaptureStatus, TranscriptTurn } from "./domain";
import {
  dictationResult,
  isQuickDictationLink,
  leaveAction,
  quickStart,
  stillHeard,
} from "./quickDictation";

function turn(id: string): TranscriptTurn {
  return {
    id,
    rawText: "hello",
    refinedText: "Hello.",
    mode: "dictate",
    language: "en-US",
    privacyMode: false,
    createdAt: "2026-11-20T00:00:00.000Z",
    durationMs: 1000,
    source: "microphone",
    syncState: "local",
  };
}

function state(status: CaptureStatus, latest?: TranscriptTurn) {
  return { capture: { status }, latest };
}

describe("isQuickDictationLink", () => {
  it("recognizes the link in the forms it arrives in", () => {
    for (const url of [
      "sonolect://dictate",
      "sonolect://dictate/",
      "sonolect:///dictate",
      "sonolect://dictate?source=action-button",
      "sonolect://dictate#top",
      "exp://127.0.0.1:8081/--/dictate",
      "https://example.com/dictate",
    ]) {
      assert.equal(isQuickDictationLink(url), true, url);
    }
  });

  it("leaves every other link alone", () => {
    for (const url of [
      "sonolect://",
      "sonolect://settings",
      "sonolect://dictated",
      "sonolect://library?next=/dictate",
      "sonolect://reader#/dictate",
      "",
    ]) {
      assert.equal(isQuickDictationLink(url), false, url);
    }
  });
});

describe("quickStart", () => {
  it("starts when the app is in front and nothing is running", () => {
    for (const status of ["idle", "ready", "error"] as const) {
      assert.equal(quickStart("active", status), "start", status);
    }
  });

  it("waits until the app is in front: the microphone can't start before", () => {
    assert.equal(quickStart("background", "idle"), "wait");
    assert.equal(quickStart("inactive", "idle"), "wait");
  });

  it("starts when the app's state is not known", () => {
    assert.equal(quickStart("unknown", "idle"), "start");
    assert.equal(quickStart(null, "idle"), "start");
    assert.equal(quickStart(undefined, "idle"), "start");
  });

  it("waits while the previous dictation is being polished", () => {
    assert.equal(quickStart("active", "processing"), "wait");
  });

  it("adopts a dictation that is already listening", () => {
    assert.equal(quickStart("active", "listening"), "adopt");
  });
});

describe("stillHeard", () => {
  it("is heard once a dictation listens, until it ends", () => {
    assert.equal(stillHeard(false, "listening"), true);
    assert.equal(stillHeard(true, "processing"), true);
    for (const status of ["idle", "ready", "error"] as const) {
      assert.equal(stillHeard(true, status), false, status);
    }
  });

  it("is not heard when only its polishing was seen", () => {
    // A dictation from Capture, already ending when Quick dictation opened.
    assert.equal(stillHeard(false, "processing"), false);
  });
});

describe("dictationResult", () => {
  it("is the new latest note when polishing ends ready", () => {
    const before = turn("a");
    const after = turn("b");
    assert.equal(
      dictationResult(state("processing", before), state("ready", after)),
      after,
    );
    assert.equal(
      dictationResult(state("processing"), state("ready", after)),
      after,
    );
  });

  it("is nothing when the dictation kept no text", () => {
    const latest = turn("a");
    assert.equal(
      dictationResult(state("processing", latest), state("idle", latest)),
      null,
    );
    assert.equal(
      dictationResult(state("processing", latest), state("error", latest)),
      null,
    );
  });

  it("is nothing when the latest note changes for another reason", () => {
    const before = turn("a");
    // A refinement replaces the note; history sync brings another one.
    assert.equal(
      dictationResult(
        state("ready", before),
        state("ready", { ...before, refinedText: "Refined." }),
      ),
      null,
    );
    assert.equal(
      dictationResult(
        state("listening", before),
        state("listening", turn("b")),
      ),
      null,
    );
    assert.equal(
      dictationResult(state("idle", before), state("idle", turn("b"))),
      null,
    );
  });

  it("is nothing while the note is unchanged", () => {
    const latest = turn("a");
    assert.equal(
      dictationResult(state("processing", latest), state("ready", latest)),
      null,
    );
  });
});

describe("leaveAction", () => {
  it("keeps what a listening dictation heard", () => {
    assert.equal(
      leaveAction({ status: "listening", partialTranscript: "Book the" }),
      "stop",
    );
  });

  it("drops a listening dictation that heard nothing yet", () => {
    assert.equal(
      leaveAction({ status: "listening", partialTranscript: "" }),
      "cancel",
    );
    assert.equal(
      leaveAction({ status: "listening", partialTranscript: "  " }),
      "cancel",
    );
  });

  it("leaves everything else as it is", () => {
    for (const status of ["idle", "processing", "ready", "error"] as const) {
      assert.equal(
        leaveAction({ status, partialTranscript: "Book the dentist" }),
        "none",
        status,
      );
    }
  });
});
