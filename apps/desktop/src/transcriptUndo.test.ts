import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createTranscriptUndoStack } from "./transcriptUndo";
import { textToSegments } from "./segmentEditor";

describe("desktop transcript undo stack", () => {
  it("undoes and redoes transcript text changes", () => {
    const stack = createTranscriptUndoStack({
      transcript: "First",
      transcriptSegments: textToSegments("First"),
      selectedSegmentIds: [],
    });

    stack.push({
      transcript: "Second",
      transcriptSegments: textToSegments("Second"),
      selectedSegmentIds: [],
    });
    stack.push({
      transcript: "Third",
      transcriptSegments: textToSegments("Third"),
      selectedSegmentIds: [],
    });

    assert.equal(stack.canUndo(), true);
    assert.equal(stack.undo()?.transcript, "Second");
    assert.equal(stack.undo()?.transcript, "First");
    assert.equal(stack.canUndo(), false);
    assert.equal(stack.redo()?.transcript, "Second");
    assert.equal(stack.redo()?.transcript, "Third");
    assert.equal(stack.canRedo(), false);
  });

  it("tracks segment edits and clears redo after a new change", () => {
    const initialSegments = textToSegments("Alpha.\n\nBeta.");
    const stack = createTranscriptUndoStack({
      transcript: "Alpha.\n\nBeta.",
      transcriptSegments: initialSegments,
      selectedSegmentIds: [initialSegments[0]!.id],
    });

    const editedSegments = initialSegments.map((segment, index) =>
      index === 0 ? { ...segment, text: "Alpha edited." } : segment,
    );
    stack.push({
      transcript: "Alpha edited.\n\nBeta.",
      transcriptSegments: editedSegments,
      selectedSegmentIds: [],
    });

    const undone = stack.undo();
    assert.equal(undone?.transcriptSegments[0]?.text, "Alpha.");
    assert.equal(stack.canRedo(), true);

    stack.push({
      transcript: "Replacement",
      transcriptSegments: textToSegments("Replacement"),
      selectedSegmentIds: [],
    });
    assert.equal(stack.canRedo(), false);
  });

  it("coalesces identical snapshots", () => {
    const snapshot = {
      transcript: "Same",
      transcriptSegments: textToSegments("Same"),
      selectedSegmentIds: [],
    };
    const stack = createTranscriptUndoStack(snapshot);
    stack.push(snapshot);
    assert.equal(stack.canUndo(), false);
  });
});
