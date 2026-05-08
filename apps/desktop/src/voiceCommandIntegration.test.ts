import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { processTranscriptWithCommands } from "./voiceCommandIntegration";

describe("voiceCommandIntegration", () => {
  // ── Full pipeline tests ───────────────────────────────────────────
  describe("processTranscriptWithCommands", () => {
    it("passes through text with no commands", () => {
      const result = processTranscriptWithCommands(
        "The weather is nice today",
        "",
      );
      assert.strictEqual(result.finalText, "The weather is nice today");
      assert.strictEqual(result.commandsExecuted.length, 0);
      assert.strictEqual(result.sideEffects.length, 0);
    });

    it("passes through when voice commands are disabled", () => {
      const result = processTranscriptWithCommands(
        "Hello delete that",
        "Existing text.",
        { enableVoiceCommands: false },
      );
      assert.strictEqual(result.finalText, "Hello delete that");
      assert.strictEqual(result.commandsExecuted.length, 0);
    });

    it("detects and executes delete that", () => {
      const result = processTranscriptWithCommands(
        "delete that",
        "First sentence. Second sentence.",
      );
      assert.strictEqual(result.finalText, "First sentence.");
      assert.strictEqual(result.commandsExecuted.length, 1);
      assert.strictEqual(
        result.commandsExecuted[0]?.action,
        "editing:deleteLast",
      );
    });

    it("appends remaining text to transcript and executes new paragraph", () => {
      const result = processTranscriptWithCommands(
        "More text new paragraph",
        "Existing.",
      );
      assert.strictEqual(result.finalText, "Existing. More text\n\n");
      assert.strictEqual(result.commandsExecuted.length, 1);
    });

    it("executes bold that on combined text", () => {
      const result = processTranscriptWithCommands(
        "important bold that",
        "This is",
      );
      assert.strictEqual(result.finalText, "This is **important**");
      assert.strictEqual(result.commandsExecuted.length, 1);
    });

    it("returns side effects for control commands", () => {
      const result = processTranscriptWithCommands(
        "stop recording",
        "Some transcript text.",
      );
      assert.ok(result.sideEffects.includes("recording:stop"));
      assert.strictEqual(result.commandsExecuted.length, 1);
    });

    it("handles cancel command", () => {
      const result = processTranscriptWithCommands(
        "Never mind cancel",
        "Some text.",
      );
      assert.ok(result.sideEffects.includes("control:cancel"));
    });

    it("handles insert that command", () => {
      const result = processTranscriptWithCommands(
        "insert that",
        "Text to insert.",
      );
      assert.ok(result.sideEffects.includes("editing:insert"));
    });

    it("handles delete all", () => {
      const result = processTranscriptWithCommands(
        "delete all",
        "A bunch of text here.",
      );
      assert.strictEqual(result.finalText, "");
      assert.strictEqual(result.commandsExecuted.length, 1);
    });

    it("handles undo that side effect", () => {
      const result = processTranscriptWithCommands("undo that", "Some text.");
      assert.ok(result.sideEffects.includes("editing:undo"));
    });

    it("handles empty raw text", () => {
      const result = processTranscriptWithCommands("", "Existing.");
      assert.strictEqual(result.finalText, "");
      assert.strictEqual(result.commandsExecuted.length, 0);
    });

    it("handles empty current transcript with command only", () => {
      const result = processTranscriptWithCommands("new paragraph", "");
      assert.strictEqual(result.finalText, "\n\n");
    });

    it("punctuation commands work correctly", () => {
      const result = processTranscriptWithCommands(
        "Really question mark",
        "Are you sure",
      );
      assert.strictEqual(result.finalText, "Are you sure Really?");
    });

    it("defaults to voice commands enabled", () => {
      const result = processTranscriptWithCommands("delete all", "Text.");
      assert.strictEqual(result.finalText, "");
      assert.strictEqual(result.commandsExecuted.length, 1);
    });
  });
});
