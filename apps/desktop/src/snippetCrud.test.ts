import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

// Minimal localStorage polyfill for Node test environment
let store: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
};

(globalThis as any).localStorage = fakeLocalStorage;

const {
  loadSnippets,
  saveSnippets,
  addSnippet,
  removeSnippet,
  updateSnippet,
  searchSnippets,
  importSnippets,
  exportSnippets,
} = await import("./snippetCrud");

describe("snippetCrud", () => {
  beforeEach(() => {
    store = {};
  });

  describe("loadSnippets / saveSnippets", () => {
    it("returns empty array when nothing is stored", () => {
      assert.deepEqual(loadSnippets(), []);
    });

    it("roundtrips snippets through save and load", () => {
      const snippets = [
        { id: "s1", trigger: "/sig", body: "Best, Ismail" },
        { id: "s2", trigger: "/ty", body: "Thank you!" },
      ];
      saveSnippets(snippets);
      assert.deepEqual(loadSnippets(), snippets);
    });

    it("returns empty array for corrupt JSON", () => {
      store["sonolect.snippets"] = "{bad json";
      assert.deepEqual(loadSnippets(), []);
    });

    it("filters out invalid snippets", () => {
      store["sonolect.snippets"] = JSON.stringify([
        { id: "s1", trigger: "/sig", body: "Best" },
        { id: "s2", trigger: 123, body: "bad" },
        null,
      ]);
      const loaded = loadSnippets();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0]!.id, "s1");
    });
  });

  describe("addSnippet", () => {
    it("adds a new snippet to an empty list", () => {
      const result = addSnippet([], "sig", "Best, Ismail");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.trigger, "/sig"); // Normalized with /
      assert.equal(result[0]!.body, "Best, Ismail");
    });

    it("normalizes trigger to start with /", () => {
      const result = addSnippet([], "hello", "Hello there!");
      assert.equal(result[0]!.trigger, "/hello");
    });

    it("does not double-prefix triggers already starting with /", () => {
      const result = addSnippet([], "/sig", "Best, Ismail");
      assert.equal(result[0]!.trigger, "/sig");
    });

    it("deduplicates by trigger (case-insensitive)", () => {
      const snippets = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = addSnippet(snippets, "/SIG", "Best, Ismail");
      assert.equal(result.length, 1);
    });

    it("rejects snippets with empty trigger or body", () => {
      assert.equal(addSnippet([], "", "body").length, 0);
      assert.equal(addSnippet([], "trigger", "").length, 0);
    });

    it("does not mutate the original array", () => {
      const original = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = addSnippet(original, "ty", "Thank you");
      assert.equal(original.length, 1);
      assert.equal(result.length, 2);
    });
  });

  describe("removeSnippet", () => {
    it("removes a snippet by id", () => {
      const snippets = [
        { id: "s1", trigger: "/sig", body: "Best" },
        { id: "s2", trigger: "/ty", body: "Thanks" },
      ];
      const result = removeSnippet(snippets, "s1");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "s2");
    });

    it("returns same array when id not found", () => {
      const snippets = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = removeSnippet(snippets, "nonexistent");
      assert.equal(result.length, 1);
    });
  });

  describe("updateSnippet", () => {
    it("updates body field", () => {
      const snippets = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = updateSnippet(snippets, "s1", { body: "Best regards" });
      assert.equal(result[0]!.body, "Best regards");
      assert.equal(result[0]!.trigger, "/sig");
    });

    it("updates trigger with normalization", () => {
      const snippets = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = updateSnippet(snippets, "s1", { trigger: "signature" });
      assert.equal(result[0]!.trigger, "/signature");
    });

    it("ignores update for nonexistent id", () => {
      const snippets = [{ id: "s1", trigger: "/sig", body: "Best" }];
      const result = updateSnippet(snippets, "nope", { body: "New" });
      assert.deepEqual(result, snippets);
    });
  });

  describe("searchSnippets", () => {
    const snippets = [
      { id: "s1", trigger: "/sig", body: "Best regards, Ismail" },
      { id: "s2", trigger: "/ty", body: "Thank you very much!" },
      { id: "s3", trigger: "/addr", body: "123 Main Street" },
    ];

    it("matches on trigger field", () => {
      const result = searchSnippets(snippets, "sig");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "s1");
    });

    it("matches on body field", () => {
      const result = searchSnippets(snippets, "street");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "s3");
    });

    it("is case-insensitive", () => {
      const result = searchSnippets(snippets, "THANK");
      assert.equal(result.length, 1);
    });

    it("returns all snippets for empty query", () => {
      assert.equal(searchSnippets(snippets, "").length, 3);
    });

    it("returns empty array when no match", () => {
      assert.equal(searchSnippets(snippets, "python").length, 0);
    });
  });

  describe("importSnippets", () => {
    it("parses CSV lines into snippets", () => {
      const csv = "/sig,Best regards\n/ty,Thank you!";
      const result = importSnippets(csv);
      assert.equal(result.length, 2);
      assert.equal(result[0]!.trigger, "/sig");
      assert.equal(result[0]!.body, "Best regards");
    });

    it("normalizes triggers without /", () => {
      const csv = "sig,Best regards";
      const result = importSnippets(csv);
      assert.equal(result[0]!.trigger, "/sig");
    });

    it("skips lines without commas", () => {
      const csv = "/sig,Best\nbadline\n/ty,Thanks";
      const result = importSnippets(csv);
      assert.equal(result.length, 2);
    });

    it("deduplicates within import", () => {
      const csv = "/sig,Best\n/sig,Best regards";
      const result = importSnippets(csv);
      assert.equal(result.length, 1);
    });

    it("handles empty CSV", () => {
      assert.deepEqual(importSnippets(""), []);
    });

    it("handles body containing commas", () => {
      const csv = "/greeting,Hello, my friend!";
      const result = importSnippets(csv);
      assert.equal(result[0]!.body, "Hello, my friend!");
    });

    it("skips empty trigger or body", () => {
      const csv = ",Best\n/sig,";
      const result = importSnippets(csv);
      assert.equal(result.length, 0);
    });
  });

  describe("exportSnippets", () => {
    it("exports snippets as CSV", () => {
      const snippets = [
        { id: "s1", trigger: "/sig", body: "Best regards" },
        { id: "s2", trigger: "/ty", body: "Thank you" },
      ];
      const csv = exportSnippets(snippets);
      assert.equal(csv, "/sig,Best regards\n/ty,Thank you");
    });

    it("exports empty array as empty string", () => {
      assert.equal(exportSnippets([]), "");
    });
  });

  it("roundtrips through import and export", () => {
    const csv = "/sig,Best regards\n/ty,Thank you\n/addr,123 Main St";
    const imported = importSnippets(csv);
    const exported = exportSnippets(imported);
    assert.equal(exported, csv);
  });
});
