import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  VOICE_COMMANDS,
  parseVoiceCommand,
  executeVoiceCommand,
  isVoiceCommandEnabled,
  stripVoiceCommands,
  getVoiceCommandHelp,
} from "./voiceCommands";
import type { VoiceCommand } from "./voiceCommands";

describe("voiceCommands", () => {
  // ── Pattern matching ──────────────────────────────────────────────
  describe("parseVoiceCommand", () => {
    it("matches 'delete that' at end of speech", () => {
      const result = parseVoiceCommand("The meeting went well delete that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:deleteLast");
      assert.strictEqual(result.remainingText, "The meeting went well");
    });

    it("matches 'delete all' at end of speech", () => {
      const result = parseVoiceCommand("Some text here delete all");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:deleteAll");
      assert.strictEqual(result.remainingText, "Some text here");
    });

    it("matches 'undo that' at end", () => {
      const result = parseVoiceCommand("That was wrong undo that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:undo");
    });

    it("matches 'redo that' at end", () => {
      const result = parseVoiceCommand("Actually redo that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:redo");
    });

    it("matches 'select all' at end", () => {
      const result = parseVoiceCommand("Okay select all");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:selectAll");
    });

    it("matches 'new line' at end", () => {
      const result = parseVoiceCommand("First line new line");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "navigation:newLine");
      assert.strictEqual(result.remainingText, "First line");
    });

    it("matches 'new paragraph' at end", () => {
      const result = parseVoiceCommand("End of intro new paragraph");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "navigation:newParagraph");
      assert.strictEqual(result.remainingText, "End of intro");
    });

    it("matches 'go back' at end", () => {
      const result = parseVoiceCommand("Hmm go back");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "navigation:goBack");
    });

    it("matches 'bold that' at end", () => {
      const result = parseVoiceCommand("This is important bold that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:bold");
      assert.strictEqual(result.remainingText, "This is important");
    });

    it("matches 'capitalize that' at end", () => {
      const result = parseVoiceCommand("My name is john capitalize that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:capitalize");
    });

    it("matches 'lowercase that' at end", () => {
      const result = parseVoiceCommand("Type HELLO lowercase that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:lowercase");
    });

    it("matches 'period' at end", () => {
      const result = parseVoiceCommand("That is all period");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:period");
    });

    it("matches 'comma' at end", () => {
      const result = parseVoiceCommand("First comma");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:comma");
    });

    it("matches 'question mark' at end", () => {
      const result = parseVoiceCommand("Are you sure question mark");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "formatting:questionMark");
    });

    it("matches 'stop recording' at end", () => {
      const result = parseVoiceCommand("That is all stop recording");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "control:stopRecording");
    });

    it("matches 'cancel' at end", () => {
      const result = parseVoiceCommand("Never mind cancel");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "control:cancel");
    });

    it("matches 'insert that' at end", () => {
      const result = parseVoiceCommand("Okay insert that");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "control:insert");
    });

    it("does not match commands in the middle of normal speech", () => {
      const result = parseVoiceCommand(
        "I need to delete that file from the server",
      );
      // "delete that" is NOT at the end, so it should not match
      assert.ok(!result.matched);
      assert.strictEqual(
        result.remainingText,
        "I need to delete that file from the server",
      );
    });

    it("does not match partial commands", () => {
      const result = parseVoiceCommand("I was just going to update that");
      // "update that" is not a command
      assert.ok(!result.matched);
    });

    it("returns unmatched for empty text", () => {
      const result = parseVoiceCommand("");
      assert.ok(!result.matched);
      assert.strictEqual(result.remainingText, "");
    });

    it("returns unmatched for text with no commands", () => {
      const result = parseVoiceCommand("The weather is nice today");
      assert.ok(!result.matched);
      assert.strictEqual(result.remainingText, "The weather is nice today");
    });

    it("matches case-insensitively", () => {
      const result = parseVoiceCommand("Something DELETE THAT");
      assert.ok(result.matched);
      assert.strictEqual(result.action, "editing:deleteLast");
    });

    it("matches when command is the entire text", () => {
      const result = parseVoiceCommand("delete that");
      assert.ok(result.matched);
      assert.strictEqual(result.remainingText, "");
    });
  });

  // ── Command execution ─────────────────────────────────────────────
  describe("executeVoiceCommand", () => {
    function findCommand(action: string): VoiceCommand {
      const cmd = VOICE_COMMANDS.find((c) => c.action === action);
      if (!cmd) throw new Error(`Command not found: ${action}`);
      return cmd;
    }

    it("delete that removes the last sentence", () => {
      const result = executeVoiceCommand(
        findCommand("editing:deleteLast"),
        "Hello world. This is a test. Remove me.",
      );
      assert.strictEqual(result.text, "Hello world. This is a test.");
    });

    it("delete that on single sentence returns empty", () => {
      const result = executeVoiceCommand(
        findCommand("editing:deleteLast"),
        "Only one sentence here.",
      );
      assert.strictEqual(result.text, "");
    });

    it("delete all clears text", () => {
      const result = executeVoiceCommand(
        findCommand("editing:deleteAll"),
        "A lot of text here.",
      );
      assert.strictEqual(result.text, "");
    });

    it("undo that returns text unchanged with undo action", () => {
      const result = executeVoiceCommand(
        findCommand("editing:undo"),
        "Some text",
      );
      assert.strictEqual(result.text, "Some text");
      assert.strictEqual(result.action, "editing:undo");
    });

    it("redo that returns text unchanged with redo action", () => {
      const result = executeVoiceCommand(
        findCommand("editing:redo"),
        "Some text",
      );
      assert.strictEqual(result.text, "Some text");
      assert.strictEqual(result.action, "editing:redo");
    });

    it("new line appends \\n", () => {
      const result = executeVoiceCommand(
        findCommand("navigation:newLine"),
        "First line",
      );
      assert.strictEqual(result.text, "First line\n");
    });

    it("new paragraph appends \\n\\n", () => {
      const result = executeVoiceCommand(
        findCommand("navigation:newParagraph"),
        "End of section",
      );
      assert.strictEqual(result.text, "End of section\n\n");
    });

    it("go back triggers undo action", () => {
      const result = executeVoiceCommand(
        findCommand("navigation:goBack"),
        "Text",
      );
      assert.strictEqual(result.action, "editing:undo");
    });

    it("bold that wraps last word in **", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:bold"),
        "This is important",
      );
      assert.strictEqual(result.text, "This is **important**");
    });

    it("bold that on single word wraps it", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:bold"),
        "hello",
      );
      assert.strictEqual(result.text, "**hello**");
    });

    it("capitalize that uppercases the last word", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:capitalize"),
        "My name is john",
      );
      assert.strictEqual(result.text, "My name is JOHN");
    });

    it("lowercase that lowercases the last word", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:lowercase"),
        "Type HELLO",
      );
      assert.strictEqual(result.text, "Type hello");
    });

    it("period appends .", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:period"),
        "That is all",
      );
      assert.strictEqual(result.text, "That is all.");
    });

    it("comma appends ,", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:comma"),
        "First",
      );
      assert.strictEqual(result.text, "First,");
    });

    it("question mark appends ?", () => {
      const result = executeVoiceCommand(
        findCommand("formatting:questionMark"),
        "Are you sure",
      );
      assert.strictEqual(result.text, "Are you sure?");
    });

    it("stop recording returns stop action", () => {
      const result = executeVoiceCommand(
        findCommand("control:stopRecording"),
        "Done",
      );
      assert.strictEqual(result.text, "Done");
      assert.strictEqual(result.action, "recording:stop");
    });

    it("cancel returns cancel action", () => {
      const result = executeVoiceCommand(findCommand("control:cancel"), "Nope");
      assert.strictEqual(result.action, "control:cancel");
    });

    it("insert that returns insert action", () => {
      const result = executeVoiceCommand(
        findCommand("control:insert"),
        "Ready",
      );
      assert.strictEqual(result.action, "editing:insert");
    });
  });

  // ── isVoiceCommandEnabled ─────────────────────────────────────────
  describe("isVoiceCommandEnabled", () => {
    it("returns true when text ends with a command", () => {
      assert.ok(isVoiceCommandEnabled("Some text delete that"));
    });

    it("returns false for normal text", () => {
      assert.ok(!isVoiceCommandEnabled("The weather is nice today"));
    });

    it("returns false for empty text", () => {
      assert.ok(!isVoiceCommandEnabled(""));
    });
  });

  // ── stripVoiceCommands ────────────────────────────────────────────
  describe("stripVoiceCommands", () => {
    it("removes a command from the end of text", () => {
      const result = stripVoiceCommands("Hello world delete that");
      assert.strictEqual(result, "Hello world");
    });

    it("removes command phrases from within text", () => {
      const result = stripVoiceCommands(
        "Start bold that and then new line end",
      );
      assert.ok(!result.includes("bold that"));
      assert.ok(!result.includes("new line"));
    });

    it("returns unchanged text when no commands present", () => {
      const result = stripVoiceCommands("Normal speech here");
      assert.strictEqual(result, "Normal speech here");
    });

    it("handles empty text", () => {
      const result = stripVoiceCommands("");
      assert.strictEqual(result, "");
    });
  });

  // ── getVoiceCommandHelp ───────────────────────────────────────────
  describe("getVoiceCommandHelp", () => {
    it("returns all commands", () => {
      const help = getVoiceCommandHelp();
      assert.strictEqual(help.length, VOICE_COMMANDS.length);
    });

    it("each entry has command, description, and category", () => {
      const help = getVoiceCommandHelp();
      for (const entry of help) {
        assert.ok(entry.command, "Missing command string");
        assert.ok(entry.description, "Missing description");
        assert.ok(entry.category, "Missing category");
      }
    });

    it("includes known commands", () => {
      const help = getVoiceCommandHelp();
      const commands = help.map((h) => h.command);
      assert.ok(
        commands.some((c) => c.includes("delete that")),
        "Missing delete that",
      );
      assert.ok(
        commands.some((c) => c.includes("new paragraph")),
        "Missing new paragraph",
      );
      assert.ok(
        commands.some((c) => c.includes("bold that")),
        "Missing bold that",
      );
    });
  });

  // ── VOICE_COMMANDS structure ──────────────────────────────────────
  describe("VOICE_COMMANDS", () => {
    it("has at least 15 commands", () => {
      assert.ok(
        VOICE_COMMANDS.length >= 15,
        `Expected at least 15, got ${VOICE_COMMANDS.length}`,
      );
    });

    it("every command has required fields", () => {
      for (const cmd of VOICE_COMMANDS) {
        assert.ok(cmd.pattern instanceof RegExp, "pattern must be RegExp");
        assert.ok(cmd.action, "Missing action");
        assert.ok(cmd.description, "Missing description");
        assert.ok(cmd.category, "Missing category");
      }
    });

    it("covers all four categories", () => {
      const categories = new Set(VOICE_COMMANDS.map((c) => c.category));
      for (const cat of ["editing", "navigation", "formatting", "control"]) {
        assert.ok(categories.has(cat as never), `Missing category "${cat}"`);
      }
    });
  });
});
