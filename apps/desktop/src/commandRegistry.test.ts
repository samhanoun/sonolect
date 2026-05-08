import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  DEFAULT_COMMANDS,
  searchCommands,
  getCommandsByCategory,
  getCommandShortcutMap,
} from "./commandRegistry";
import type { Command, CommandCategory } from "./commandRegistry";

describe("commandRegistry", () => {
  // ── DEFAULT_COMMANDS structure ─────────────────────────────────
  it("has at least 15 commands", () => {
    assert.ok(
      DEFAULT_COMMANDS.length >= 15,
      `Expected at least 15 commands, got ${DEFAULT_COMMANDS.length}`,
    );
  });

  it("every command has required fields", () => {
    for (const cmd of DEFAULT_COMMANDS) {
      assert.ok(cmd.id, `Command missing id`);
      assert.ok(cmd.label, `Command ${cmd.id} missing label`);
      assert.ok(cmd.hint, `Command ${cmd.id} missing hint`);
      assert.ok(cmd.category, `Command ${cmd.id} missing category`);
      assert.ok(cmd.action, `Command ${cmd.id} missing action`);
    }
  });

  it("all command ids are unique", () => {
    const ids = DEFAULT_COMMANDS.map((c) => c.id);
    assert.strictEqual(ids.length, new Set(ids).size);
  });

  it("covers all expected categories", () => {
    const categories = new Set(DEFAULT_COMMANDS.map((c) => c.category));
    const expected: CommandCategory[] = [
      "recording",
      "editing",
      "navigation",
      "export",
      "data",
    ];
    for (const cat of expected) {
      assert.ok(categories.has(cat), `Missing category "${cat}"`);
    }
  });

  // ── searchCommands ─────────────────────────────────────────────
  describe("searchCommands", () => {
    it("returns all commands when query is empty", () => {
      assert.strictEqual(
        searchCommands(DEFAULT_COMMANDS, "").length,
        DEFAULT_COMMANDS.length,
      );
      assert.strictEqual(
        searchCommands(DEFAULT_COMMANDS, "  ").length,
        DEFAULT_COMMANDS.length,
      );
    });

    it("filters by label case-insensitively", () => {
      const results = searchCommands(DEFAULT_COMMANDS, "undo");
      assert.ok(results.length >= 1);
      assert.ok(results.some((c) => c.id === "editing.undo"));
    });

    it("filters by hint case-insensitively", () => {
      const results = searchCommands(DEFAULT_COMMANDS, "clipboard");
      assert.ok(results.length >= 1);
      assert.ok(results.some((c) => c.id === "editing.copy"));
    });

    it("filters by category", () => {
      const results = searchCommands(DEFAULT_COMMANDS, "export");
      assert.ok(results.length >= 5);
    });

    it("returns empty array when nothing matches", () => {
      const results = searchCommands(DEFAULT_COMMANDS, "zzzznotfound");
      assert.strictEqual(results.length, 0);
    });
  });

  // ── getCommandsByCategory ──────────────────────────────────────
  describe("getCommandsByCategory", () => {
    it("groups commands by their category", () => {
      const map = getCommandsByCategory(DEFAULT_COMMANDS);
      assert.ok(map.has("recording"));
      assert.ok(map.has("editing"));
      assert.ok(map.has("navigation"));
      assert.ok(map.has("export"));
      assert.ok(map.has("data"));
    });

    it("recording category has 3 commands", () => {
      const map = getCommandsByCategory(DEFAULT_COMMANDS);
      assert.strictEqual(map.get("recording")!.length, 3);
    });

    it("all commands are accounted for", () => {
      const map = getCommandsByCategory(DEFAULT_COMMANDS);
      let total = 0;
      for (const [, cmds] of map) {
        total += cmds.length;
      }
      assert.strictEqual(total, DEFAULT_COMMANDS.length);
    });
  });

  // ── getCommandShortcutMap ──────────────────────────────────────
  describe("getCommandShortcutMap", () => {
    it("maps shortcuts to their commands", () => {
      const map = getCommandShortcutMap(DEFAULT_COMMANDS);
      assert.ok(map.size > 0);
      const startCmd = map.get("CmdOrCtrl+Shift+R");
      assert.ok(startCmd);
      assert.strictEqual(startCmd.id, "recording.start");
    });

    it("only includes commands with shortcuts", () => {
      const map = getCommandShortcutMap(DEFAULT_COMMANDS);
      const withShortcuts = DEFAULT_COMMANDS.filter((c) => c.shortcut);
      assert.strictEqual(map.size, withShortcuts.length);
    });

    it("returns empty map for commands without shortcuts", () => {
      const noShortcuts: Command[] = [
        {
          id: "test",
          label: "Test",
          hint: "A test",
          category: "data",
          action: "test:action",
        },
      ];
      const map = getCommandShortcutMap(noShortcuts);
      assert.strictEqual(map.size, 0);
    });
  });

  // ── enabled callback ──────────────────────────────────────────
  describe("enabled callbacks", () => {
    it("start recording is disabled when already recording", () => {
      const cmd = DEFAULT_COMMANDS.find((c) => c.id === "recording.start")!;
      assert.strictEqual(cmd.enabled!({ isRecording: true }), false);
      assert.strictEqual(cmd.enabled!({ isRecording: false }), true);
    });

    it("stop recording is enabled only when recording", () => {
      const cmd = DEFAULT_COMMANDS.find((c) => c.id === "recording.stop")!;
      assert.strictEqual(cmd.enabled!({ isRecording: true }), true);
      assert.strictEqual(cmd.enabled!({ isRecording: false }), false);
    });

    it("editing commands require a transcript", () => {
      const undoCmd = DEFAULT_COMMANDS.find((c) => c.id === "editing.undo")!;
      assert.strictEqual(undoCmd.enabled!({ hasTranscript: true }), true);
      assert.strictEqual(undoCmd.enabled!({ hasTranscript: false }), false);
    });
  });
});
