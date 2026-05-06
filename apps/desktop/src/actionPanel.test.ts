import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  getDefaultActions,
  getAvailableActions,
  getActionsByCategory,
  executeAction,
} from "./actionPanel";
import type { ActionContext } from "./actionPanel";

const fullContext: ActionContext = {
  hasTranscript: true,
  hasPolishedPreview: true,
  isOnline: true,
  clipboardAvailable: true,
  nativeInsertionAvailable: true,
};

const offlineNoClipboard: ActionContext = {
  hasTranscript: true,
  hasPolishedPreview: false,
  isOnline: false,
  clipboardAvailable: false,
  nativeInsertionAvailable: false,
};

const noTranscript: ActionContext = {
  hasTranscript: false,
  hasPolishedPreview: false,
  isOnline: true,
  clipboardAvailable: true,
  nativeInsertionAvailable: true,
};

describe("actionPanel", () => {
  describe("getDefaultActions", () => {
    it("returns actions in all three categories", () => {
      const actions = getDefaultActions();
      const categories = new Set(actions.map((a) => a.category));
      assert.ok(categories.has("output"));
      assert.ok(categories.has("create"));
      assert.ok(categories.has("share"));
    });

    it("returns 13 actions total", () => {
      const actions = getDefaultActions();
      assert.equal(actions.length, 13);
    });

    it("has unique ids", () => {
      const actions = getDefaultActions();
      const ids = actions.map((a) => a.id);
      assert.equal(new Set(ids).size, ids.length);
    });

    it("includes expected output actions", () => {
      const actions = getDefaultActions();
      const outputIds = actions
        .filter((a) => a.category === "output")
        .map((a) => a.id);
      assert.ok(outputIds.includes("copy-to-clipboard"));
      assert.ok(outputIds.includes("insert-into-app"));
      assert.ok(outputIds.includes("export-markdown"));
      assert.ok(outputIds.includes("export-text"));
      assert.ok(outputIds.includes("export-srt"));
      assert.ok(outputIds.includes("export-json"));
    });

    it("includes expected create actions", () => {
      const actions = getDefaultActions();
      const createIds = actions
        .filter((a) => a.category === "create")
        .map((a) => a.id);
      assert.ok(createIds.includes("create-note"));
      assert.ok(createIds.includes("draft-email-reply"));
      assert.ok(createIds.includes("create-task"));
      assert.ok(createIds.includes("summarize"));
      assert.ok(createIds.includes("create-bullet-points"));
    });
  });

  describe("getAvailableActions", () => {
    it("returns all actions with full context", () => {
      const actions = getDefaultActions();
      const available = getAvailableActions(actions, fullContext);
      assert.equal(available.length, actions.length);
    });

    it("filters out clipboard/insert when unavailable", () => {
      const actions = getDefaultActions();
      const available = getAvailableActions(actions, offlineNoClipboard);
      const ids = available.map((a) => a.id);
      assert.ok(!ids.includes("copy-to-clipboard"));
      assert.ok(!ids.includes("insert-into-app"));
    });

    it("filters out share actions when offline", () => {
      const actions = getDefaultActions();
      const available = getAvailableActions(actions, offlineNoClipboard);
      const ids = available.map((a) => a.id);
      assert.ok(!ids.includes("share-via-link"));
      assert.ok(!ids.includes("send-to-slack"));
    });

    it("filters out all actions when no transcript", () => {
      const actions = getDefaultActions();
      const available = getAvailableActions(actions, noTranscript);
      assert.equal(available.length, 0);
    });
  });

  describe("getActionsByCategory", () => {
    it("groups actions into their categories", () => {
      const actions = getDefaultActions();
      const grouped = getActionsByCategory(actions);
      assert.ok(grouped.has("output"));
      assert.ok(grouped.has("create"));
      assert.ok(grouped.has("share"));
      assert.equal(grouped.get("output")!.length, 6);
      assert.equal(grouped.get("create")!.length, 5);
      assert.equal(grouped.get("share")!.length, 2);
    });

    it("returns empty map for empty actions", () => {
      const grouped = getActionsByCategory([]);
      assert.equal(grouped.size, 0);
    });
  });

  describe("executeAction", () => {
    it("copies text to clipboard", async () => {
      let clipboardContent = "";
      const fakeNav = {
        clipboard: {
          writeText: async (text: string) => {
            clipboardContent = text;
          },
        },
      };
      Object.defineProperty(globalThis, "navigator", {
        value: fakeNav,
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "copy-to-clipboard",
        "Hello world",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.equal(result.actionId, "copy-to-clipboard");
      assert.equal(clipboardContent, "Hello world");
    });

    it("fails clipboard copy when unavailable", async () => {
      const result = await executeAction(
        "copy-to-clipboard",
        "Hello",
        offlineNoClipboard,
      );
      assert.equal(result.success, false);
    });

    it("exports as markdown", async () => {
      const result = await executeAction(
        "export-markdown",
        "Some text",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(result.message.includes("transcript.md"));
    });

    it("exports as text", async () => {
      const result = await executeAction(
        "export-text",
        "Some text",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(result.message.includes("transcript.txt"));
    });

    it("exports as SRT", async () => {
      const result = await executeAction(
        "export-srt",
        "Some text",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(result.message.includes("transcript.srt"));
    });

    it("exports as JSON", async () => {
      const result = await executeAction(
        "export-json",
        "Some text",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(result.message.includes("transcript.json"));
    });

    it("creates a note and copies to clipboard", async () => {
      let clipboardContent = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardContent = text;
            },
          },
        },
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "create-note",
        "My important idea",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(clipboardContent.includes("Note ("));
      assert.ok(clipboardContent.includes("My important idea"));
    });

    it("drafts an email reply", async () => {
      let clipboardContent = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardContent = text;
            },
          },
        },
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "draft-email-reply",
        "I agree with your proposal.",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(clipboardContent.includes("Thank you"));
      assert.ok(clipboardContent.includes("I agree with your proposal."));
    });

    it("creates tasks from sentences", async () => {
      let clipboardContent = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardContent = text;
            },
          },
        },
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "create-task",
        "Review the PR. Deploy to staging. Run tests.",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(clipboardContent.includes("- [ ] Review the PR"));
      assert.ok(clipboardContent.includes("- [ ] Deploy to staging"));
    });

    it("summarizes text", async () => {
      let clipboardContent = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardContent = text;
            },
          },
        },
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "summarize",
        "First sentence. Second sentence. Third sentence. Fourth sentence.",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(clipboardContent.includes("First sentence."));
      assert.ok(clipboardContent.includes("Second sentence."));
      assert.ok(clipboardContent.includes("omitted"));
    });

    it("creates bullet points", async () => {
      let clipboardContent = "";
      Object.defineProperty(globalThis, "navigator", {
        value: {
          clipboard: {
            writeText: async (text: string) => {
              clipboardContent = text;
            },
          },
        },
        configurable: true,
        writable: true,
      });

      const result = await executeAction(
        "create-bullet-points",
        "Point one. Point two. Point three.",
        fullContext,
      );
      assert.equal(result.success, true);
      assert.ok(clipboardContent.includes("- Point one."));
      assert.ok(clipboardContent.includes("- Point two."));
    });

    it("returns placeholder for share-via-link", async () => {
      const result = await executeAction(
        "share-via-link",
        "text",
        fullContext,
      );
      assert.equal(result.success, false);
      assert.ok(result.message.includes("coming soon"));
    });

    it("returns placeholder for send-to-slack", async () => {
      const result = await executeAction("send-to-slack", "text", fullContext);
      assert.equal(result.success, false);
      assert.ok(result.message.includes("coming soon"));
    });

    it("returns failure for unknown action", async () => {
      const result = await executeAction(
        "nonexistent-action",
        "text",
        fullContext,
      );
      assert.equal(result.success, false);
      assert.ok(result.message.includes("Unknown action"));
    });
  });
});
