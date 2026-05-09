import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processTranscriptWithCommands } from "./voiceCommandIntegration";

describe("processTranscriptWithCommands", () => {
  it("passes non-command text through unchanged", () => {
    const result = processTranscriptWithCommands(
      "hello world this is a normal sentence",
    );
    assert.equal(result.cleanText, "hello world this is a normal sentence");
    assert.deepEqual(result.appliedCommands, []);
  });

  it("applies period command", () => {
    const result = processTranscriptWithCommands("end of sentence period");
    assert.equal(result.cleanText, "end of sentence.");
    assert.deepEqual(result.appliedCommands, ["period"]);
  });

  it("applies new line command", () => {
    const result = processTranscriptWithCommands("first line new line");
    assert.equal(result.cleanText, "first line\n");
    assert.deepEqual(result.appliedCommands, ["new line"]);
  });

  it("applies bold that command", () => {
    const result = processTranscriptWithCommands(
      "context here. important bold that",
    );
    assert.equal(result.cleanText, "context here. **important**");
    assert.deepEqual(result.appliedCommands, ["bold that"]);
  });

  it("applies uppercase that command", () => {
    const result = processTranscriptWithCommands("warning uppercase that");
    assert.equal(result.cleanText, "WARNING");
    assert.deepEqual(result.appliedCommands, ["uppercase that"]);
  });

  it("applies comma command", () => {
    const result = processTranscriptWithCommands("hello comma");
    assert.equal(result.cleanText, "hello,");
    assert.deepEqual(result.appliedCommands, ["comma"]);
  });

  it("applies question mark command", () => {
    const result = processTranscriptWithCommands("how are you question mark");
    assert.equal(result.cleanText, "how are you?");
    assert.deepEqual(result.appliedCommands, ["question mark"]);
  });

  it("applies capitalize that command", () => {
    const result = processTranscriptWithCommands("hello world capitalize that");
    assert.equal(result.cleanText, "hello World");
    assert.deepEqual(result.appliedCommands, ["capitalize that"]);
  });

  it("handles empty string", () => {
    const result = processTranscriptWithCommands("");
    assert.equal(result.cleanText, "");
    assert.deepEqual(result.appliedCommands, []);
  });

  it("handles text with only whitespace", () => {
    const result = processTranscriptWithCommands("   ");
    assert.equal(result.cleanText, "   ");
    assert.deepEqual(result.appliedCommands, []);
  });

  it("does not match commands in middle of text", () => {
    const result = processTranscriptWithCommands(
      "I need to delete that file from the server",
    );
    assert.equal(
      result.cleanText,
      "I need to delete that file from the server",
    );
    assert.deepEqual(result.appliedCommands, []);
  });
});
