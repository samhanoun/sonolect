import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

/**
 * The version of the saved recording the editor works on decides whether a
 * save keeps what sync wrote meanwhile (as a conflict copy). These tests
 * check that the store knows it after a restart and after undo or redo.
 */
const values = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() {
    return values.size;
  },
};

const v1 = { t: 1_700_000_000_000, c: 0, d: "desk" };
// The last session left an edit of recording 50-1, opened at v1, unsaved.
values.set(
  "sonolect.transcriptDraft",
  JSON.stringify({
    activeSessionId: null,
    transcript: "Edited before the restart.",
    transcriptSegments: [
      {
        id: "capture-50-1-1",
        text: "Edited before the restart.",
        startMs: 0,
        endMs: 2000,
        captureId: "50-1",
      },
    ],
    selectedSegmentIds: [],
    savedAt: "2026-11-20T10:00:00.000Z",
    openedVersion: { id: "50-1", hlc: v1 },
  }),
);

const { useDesktopStore } = await import("./store/appStore");
const { singleCaptureId } = await import("./segmentEditor");
const store = () => useDesktopStore.getState();

function open(id: string, text: string, hlc: typeof v1 | null) {
  store().openCapture({
    id,
    durationMs: 2000,
    transcript: null,
    segments: [{ startMs: 0, endMs: 2000, text, speaker: null }],
    hlc,
  });
}

function edit(text: string) {
  store().updateSegmentText(store().transcriptSegments[0]!.id, text);
}

describe("the version the editor opened", () => {
  it("comes back with a restored draft, as it was when the draft was made", () => {
    assert.equal(store().draftRestored, true);
    assert.equal(singleCaptureId(store().transcriptSegments), "50-1");
    assert.deepEqual(store().openedVersion, { id: "50-1", hlc: v1 });
  });

  it("follows undo and redo past opening another recording", () => {
    const a1 = { t: 1_700_000_000_100, c: 0, d: "desk" };
    const b1 = { t: 1_700_000_000_200, c: 0, d: "desk" };
    open("60-1", "First recording.", a1);
    edit("First recording, edited.");
    open("61-1", "Second recording.", b1);
    assert.deepEqual(store().openedVersion, { id: "61-1", hlc: b1 });

    store().undoTranscriptEdit();
    assert.equal(store().transcript, "First recording, edited.");
    assert.deepEqual(store().openedVersion, { id: "60-1", hlc: a1 });

    store().redoTranscriptEdit();
    assert.equal(store().transcript, "Second recording.");
    assert.deepEqual(store().openedVersion, { id: "61-1", hlc: b1 });
  });

  it("is the version last saved, and none for a recording never synced", () => {
    const a1 = { t: 1_700_000_000_300, c: 0, d: "desk" };
    const a2 = { t: 1_700_000_000_400, c: 0, d: "desk" };
    open("70-1", "Third recording.", a1);
    edit("Third recording, saved.");
    store().setOpenedVersion("70-1", a2);
    open("71-1", "Fourth recording.", null);
    assert.deepEqual(store().openedVersion, { id: "71-1", hlc: null });

    store().undoTranscriptEdit();
    assert.equal(store().transcript, "Third recording, saved.");
    assert.deepEqual(store().openedVersion, { id: "70-1", hlc: a2 });
    store().redoTranscriptEdit();
    assert.deepEqual(store().openedVersion, { id: "71-1", hlc: null });
  });

  it("goes back to the version an edit came from, past opening that recording again", () => {
    const v1 = { t: 1_700_000_000_500, c: 0, d: "desk" };
    const v2 = { t: 1_700_000_000_600, c: 0, d: "phon" };
    open("80-1", "Before the phone.", v1);
    edit("Edited here.");
    // Sync wrote the phone's version, and the editor opened it.
    open("80-1", "Edited on the phone.", v2);
    assert.deepEqual(store().openedVersion, { id: "80-1", hlc: v2 });

    // The edit came from v1: a save then keeps v2 as a conflict copy.
    store().undoTranscriptEdit();
    assert.equal(store().transcript, "Edited here.");
    assert.deepEqual(store().openedVersion, { id: "80-1", hlc: v1 });
    store().redoTranscriptEdit();
    assert.equal(store().transcript, "Edited on the phone.");
    assert.deepEqual(store().openedVersion, { id: "80-1", hlc: v2 });
  });

  it("moves on with a save, for the text before and after it", () => {
    const v1 = { t: 1_700_000_000_700, c: 0, d: "desk" };
    const saved = { t: 1_700_000_000_800, c: 0, d: "desk" };
    open("90-1", "As recorded.", v1);
    edit("Edited and saved.");
    store().setOpenedVersion("90-1", saved);

    // Only this editor's own save came after v1: no conflict copy is due.
    store().undoTranscriptEdit();
    assert.equal(store().transcript, "As recorded.");
    assert.deepEqual(store().openedVersion, { id: "90-1", hlc: saved });
    store().redoTranscriptEdit();
    assert.deepEqual(store().openedVersion, { id: "90-1", hlc: saved });
  });

  it("keeps a version learned after the recording was opened", () => {
    const learned = { t: 1_700_000_000_900, c: 0, d: "desk" };
    store().openCapture({
      id: "91-1",
      durationMs: 2000,
      transcript: null,
      segments: [{ startMs: 0, endMs: 2000, text: "Just in.", speaker: null }],
    });
    assert.equal(store().openedVersion, null);
    edit("Just in, edited.");
    store().setOpenedVersion("91-1", learned);
    store().undoTranscriptEdit();
    assert.equal(store().transcript, "Just in.");
    assert.deepEqual(store().openedVersion, { id: "91-1", hlc: learned });
  });

  it("is unknown for text that is not one saved recording", () => {
    store().clearActiveSession();
    store().setTranscript("Typed by hand.");
    store().undoTranscriptEdit();
    store().redoTranscriptEdit();
    assert.equal(store().transcript, "Typed by hand.");
    assert.equal(singleCaptureId(store().transcriptSegments), undefined);
    assert.equal(store().openedVersion, null);
  });
});
