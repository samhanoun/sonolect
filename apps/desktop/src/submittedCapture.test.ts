import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getT } from "./i18n";
import { completeCapture, useDesktopStore } from "./store/appStore";

/**
 * A recording sent to a transcription job comes back with no text yet: only
 * the job's id and a message. Nothing goes into the transcript or the app
 * in front, and the message says what happened.
 */
const metadata = { durationMs: 1000, mimeType: "audio/webm", sizeBytes: 10 };
const store = () => useDesktopStore.getState();

function startWith(text: string, source: "app" | "bubble" | "hotkey") {
  store().setTranscript(text);
  useDesktopStore.setState({
    dictationSource: source,
    dictationOutcome: undefined,
    voiceError: undefined,
  });
}

describe("a recording sent to a transcription job", () => {
  it("adds nothing to the transcript, and says it was sent", async () => {
    startWith("Typed before.", "app");
    const canUndo = store().canUndoTranscript;
    await completeCapture(
      {
        status: "submitted",
        jobId: "job-1",
        transcriptId: "transcript-1",
        message: "Sent for transcription.",
      },
      metadata,
      "blob:job-1",
    );
    assert.equal(store().transcript, "Typed before.");
    assert.equal(store().canUndoTranscript, canUndo);
    assert.equal(store().recordingState, "completed");
    assert.equal(store().voiceError, "Sent for transcription.");
    assert.equal(store().dictationOutcome, undefined);
  });

  it("pastes nothing for a dictation: the bubble shows why", async () => {
    for (const source of ["bubble", "hotkey"] as const) {
      startWith("Typed before.", source);
      await completeCapture(
        { status: "submitted", jobId: "job-2", message: "Queued." },
        metadata,
        "blob:job-2",
      );
      assert.equal(store().transcript, "Typed before.", source);
      assert.deepEqual(
        store().dictationOutcome,
        { kind: "error", message: "Queued." },
        source,
      );

      startWith("Typed before.", source);
      await completeCapture(
        { status: "submitted", jobId: "job-3" },
        metadata,
        "blob:job-3",
      );
      assert.deepEqual(
        store().dictationOutcome,
        { kind: "error", message: getT()("voice.sentForTranscription") },
        source,
      );
    }
  });
});
