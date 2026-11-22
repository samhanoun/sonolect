import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  TRANSCRIPT_EDITOR_ATTRIBUTE,
  createTranscriptUndoStack,
  transcriptUndoAction,
} from "./transcriptUndo";
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

  it("keeps the version a step was opened at, which makes no step itself", () => {
    const at = (t: number) => ({ id: "1-1", hlc: { t, c: 0, d: "desk" } });
    const text = (transcript: string, version: ReturnType<typeof at>) => ({
      transcript,
      transcriptSegments: textToSegments(transcript),
      selectedSegmentIds: [],
      openedVersion: version,
    });
    const stack = createTranscriptUndoStack(text("One", at(1)));
    // The same text at a newer version: no step, but the newer version.
    stack.push(text("One", at(2)));
    assert.equal(stack.canUndo(), false);
    assert.deepEqual(stack.current().openedVersion, at(2));

    stack.push(text("Two", at(3)));
    assert.deepEqual(stack.undo()?.openedVersion, at(2));
    assert.deepEqual(stack.redo()?.openedVersion, at(3));

    stack.undo();
    stack.rewrite((snapshot) => ({ ...snapshot, openedVersion: at(4) }));
    assert.deepEqual(stack.current().openedVersion, at(4));
    assert.deepEqual(stack.redo()?.openedVersion, at(4));
    assert.equal(stack.current().transcript, "Two");
    assert.deepEqual(stack.undo()?.openedVersion, at(4));
  });
});

describe("undo and redo shortcuts", () => {
  /** A focused element, inside one of the transcript's editors or not. */
  const focused = (
    tagName: string,
    more: { type?: string; isContentEditable?: boolean } = {},
    inEditor = false,
  ) => ({
    tagName: tagName.toUpperCase(),
    ...more,
    closest: (selector: string) =>
      inEditor && selector === `[${TRANSCRIPT_EDITOR_ATTRIBUTE}]` ? {} : null,
  });
  const press = (
    key: string,
    target: unknown,
    keys: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {
      ctrlKey: true,
    },
  ) => ({
    key,
    target,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...keys,
  });
  const editor = focused("textarea", {}, true);

  it("undo and redo the transcript in its own editors", () => {
    assert.equal(transcriptUndoAction(press("z", editor), true), "undo");
    assert.equal(
      transcriptUndoAction(
        press("Z", editor, { ctrlKey: true, shiftKey: true }),
        true,
      ),
      "redo",
    );
    assert.equal(transcriptUndoAction(press("y", editor), true), "redo");
    assert.equal(
      transcriptUndoAction(press("z", editor, { metaKey: true }), true),
      "undo",
    );
  });

  it("leave any other field that takes typing its own undo", () => {
    const fields = {
      input: focused("input"),
      search: focused("input", { type: "search" }),
      number: focused("input", { type: "number" }),
      textarea: focused("textarea"),
      contenteditable: focused("div", { isContentEditable: true }),
    };
    for (const [name, field] of Object.entries(fields))
      for (const shown of [true, false])
        assert.equal(
          transcriptUndoAction(press("z", field), shown),
          undefined,
          `${name}, transcript ${shown ? "shown" : "hidden"}`,
        );
  });

  it("undo the transcript from what takes no typing only while it is on screen", () => {
    const untyped = {
      nothing: null,
      button: focused("button"),
      checkbox: focused("input", { type: "checkbox" }),
      radio: focused("input", { type: "radio" }),
      range: focused("input", { type: "range" }),
      "input button": focused("input", { type: "button" }),
      select: focused("select"),
      "segment checkbox": focused("input", { type: "checkbox" }, true),
    };
    for (const [name, field] of Object.entries(untyped)) {
      assert.equal(transcriptUndoAction(press("z", field), true), "undo", name);
      assert.equal(
        transcriptUndoAction(press("y", field), false),
        undefined,
        name,
      );
    }
  });

  it("ignore other keys and plain letters", () => {
    assert.equal(transcriptUndoAction(press("k", null), true), undefined);
    assert.equal(transcriptUndoAction(press("z", null, {}), true), undefined);
  });
});
