import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  polishedText,
  UnusablePolishError,
  type PolishModelResponse,
} from "./ai.js";

const answer = (
  finishReason: string | undefined,
  ...texts: string[]
): PolishModelResponse => ({
  candidates: [
    {
      ...(finishReason === undefined ? {} : { finishReason }),
      content: { parts: texts.map((text) => ({ text })) },
    },
  ],
});

const assertUnusable = (
  response: PolishModelResponse,
  code: UnusablePolishError["code"],
  finishReason?: string,
) =>
  assert.throws(
    () => polishedText(response),
    (error: unknown) =>
      error instanceof UnusablePolishError &&
      error.code === code &&
      error.finishReason === finishReason,
  );

describe("polishedText", () => {
  it("returns the text of a complete answer, joined and trimmed", () => {
    assert.equal(
      polishedText(answer("STOP", "  The meeting moved ", "to Tuesday. ")),
      "The meeting moved to Tuesday.",
    );
  });

  it("treats no candidates as an empty answer", () => {
    assertUnusable({}, "polish_empty");
    assertUnusable({ candidates: [] }, "polish_empty");
  });

  it("treats a complete answer without text as empty", () => {
    assertUnusable(answer("STOP"), "polish_empty", "STOP");
    assertUnusable(answer("STOP", "  ", "\n"), "polish_empty", "STOP");
    assertUnusable(
      { candidates: [{ finishReason: "STOP", content: {} }] },
      "polish_empty",
      "STOP",
    );
    assertUnusable(
      { candidates: [{ finishReason: "STOP", content: { parts: [{}] } }] },
      "polish_empty",
      "STOP",
    );
  });

  it("refuses an answer cut off at the token limit, even with text", () => {
    assertUnusable(
      answer("MAX_TOKENS", "The meeting moved to"),
      "polish_incomplete",
      "MAX_TOKENS",
    );
  });

  it("refuses an answer stopped by a filter", () => {
    for (const reason of ["SAFETY", "RECITATION", "OTHER", "BLOCKLIST"])
      assertUnusable(answer(reason, "partial"), "polish_incomplete", reason);
  });

  it("refuses an answer with no finish reason, since it did not stop", () => {
    assertUnusable(answer(undefined, "partial"), "polish_incomplete");
  });
});
