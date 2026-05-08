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
  loadDictionary,
  saveDictionary,
  addEntry,
  removeEntry,
  updateEntry,
  searchDictionary,
  importDictionary,
  exportDictionary,
} = await import("./dictionaryCrud");

describe("dictionaryCrud", () => {
  beforeEach(() => {
    store = {};
  });

  describe("loadDictionary / saveDictionary", () => {
    it("returns empty array when nothing is stored", () => {
      assert.deepEqual(loadDictionary(), []);
    });

    it("roundtrips entries through save and load", () => {
      const entries = [
        { id: "d1", spoken: "react", replacement: "React" },
        { id: "d2", spoken: "ts", replacement: "TypeScript" },
      ];
      saveDictionary(entries);
      assert.deepEqual(loadDictionary(), entries);
    });

    it("returns empty array for corrupt JSON", () => {
      store["sonolect.dictionaryEntries"] = "not-json{";
      assert.deepEqual(loadDictionary(), []);
    });

    it("filters out invalid entries", () => {
      store["sonolect.dictionaryEntries"] = JSON.stringify([
        { id: "d1", spoken: "ok", replacement: "OK" },
        { id: "d2", spoken: 123, replacement: "bad" },
        null,
        "string entry",
      ]);
      const loaded = loadDictionary();
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0]!.id, "d1");
    });
  });

  describe("addEntry", () => {
    it("adds a new entry to an empty list", () => {
      const result = addEntry([], "react", "React");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.spoken, "react");
      assert.equal(result[0]!.replacement, "React");
    });

    it("deduplicates by spoken word (case-insensitive)", () => {
      const entries = [{ id: "d1", spoken: "react", replacement: "React" }];
      const result = addEntry(entries, "React", "ReactJS");
      assert.equal(result.length, 1); // No addition
    });

    it("rejects entries with empty spoken or replacement", () => {
      const result = addEntry([], "", "something");
      assert.equal(result.length, 0);
      const result2 = addEntry([], "something", "");
      assert.equal(result2.length, 0);
    });

    it("does not mutate the original array", () => {
      const original = [{ id: "d1", spoken: "hello", replacement: "Hello" }];
      const result = addEntry(original, "world", "World");
      assert.equal(original.length, 1);
      assert.equal(result.length, 2);
    });
  });

  describe("removeEntry", () => {
    it("removes an entry by id", () => {
      const entries = [
        { id: "d1", spoken: "react", replacement: "React" },
        { id: "d2", spoken: "ts", replacement: "TypeScript" },
      ];
      const result = removeEntry(entries, "d1");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "d2");
    });

    it("returns same entries when id not found", () => {
      const entries = [{ id: "d1", spoken: "react", replacement: "React" }];
      const result = removeEntry(entries, "nonexistent");
      assert.equal(result.length, 1);
    });
  });

  describe("updateEntry", () => {
    it("updates spoken and replacement fields", () => {
      const entries = [{ id: "d1", spoken: "react", replacement: "React" }];
      const result = updateEntry(entries, "d1", { replacement: "React.js" });
      assert.equal(result[0]!.replacement, "React.js");
      assert.equal(result[0]!.spoken, "react");
    });

    it("leaves other entries unchanged", () => {
      const entries = [
        { id: "d1", spoken: "react", replacement: "React" },
        { id: "d2", spoken: "ts", replacement: "TypeScript" },
      ];
      const result = updateEntry(entries, "d1", { spoken: "reactjs" });
      assert.equal(result[1]!.spoken, "ts");
    });

    it("ignores update for nonexistent id", () => {
      const entries = [{ id: "d1", spoken: "react", replacement: "React" }];
      const result = updateEntry(entries, "nonexistent", { spoken: "foo" });
      assert.deepEqual(result, entries);
    });
  });

  describe("searchDictionary", () => {
    const entries = [
      { id: "d1", spoken: "react", replacement: "React" },
      { id: "d2", spoken: "ts", replacement: "TypeScript" },
      { id: "d3", spoken: "js", replacement: "JavaScript" },
    ];

    it("matches on spoken field", () => {
      const result = searchDictionary(entries, "react");
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, "d1");
    });

    it("matches on replacement field", () => {
      const result = searchDictionary(entries, "Script");
      assert.equal(result.length, 2); // TypeScript and JavaScript
    });

    it("is case-insensitive", () => {
      const result = searchDictionary(entries, "REACT");
      assert.equal(result.length, 1);
    });

    it("returns all entries for empty query", () => {
      const result = searchDictionary(entries, "");
      assert.equal(result.length, 3);
    });

    it("returns empty array when no match", () => {
      const result = searchDictionary(entries, "python");
      assert.equal(result.length, 0);
    });
  });

  describe("importDictionary", () => {
    it("parses CSV lines into entries", () => {
      const csv = "react,React\nts,TypeScript";
      const result = importDictionary(csv);
      assert.equal(result.length, 2);
      assert.equal(result[0]!.spoken, "react");
      assert.equal(result[0]!.replacement, "React");
    });

    it("skips lines without commas", () => {
      const csv = "react,React\nbadline\nts,TypeScript";
      const result = importDictionary(csv);
      assert.equal(result.length, 2);
    });

    it("deduplicates within import", () => {
      const csv = "react,React\nreact,ReactJS";
      const result = importDictionary(csv);
      assert.equal(result.length, 1);
    });

    it("handles empty CSV", () => {
      assert.deepEqual(importDictionary(""), []);
    });

    it("handles replacement containing commas", () => {
      const csv = "greeting,Hello, World!";
      const result = importDictionary(csv);
      assert.equal(result[0]!.replacement, "Hello, World!");
    });

    it("skips empty spoken or replacement", () => {
      const csv = ",React\nts,";
      const result = importDictionary(csv);
      assert.equal(result.length, 0);
    });
  });

  describe("exportDictionary", () => {
    it("exports entries as CSV", () => {
      const entries = [
        { id: "d1", spoken: "react", replacement: "React" },
        { id: "d2", spoken: "ts", replacement: "TypeScript" },
      ];
      const csv = exportDictionary(entries);
      assert.equal(csv, "react,React\nts,TypeScript");
    });

    it("exports empty array as empty string", () => {
      assert.equal(exportDictionary([]), "");
    });
  });

  it("roundtrips through import and export", () => {
    const csv = "react,React\nts,TypeScript\njs,JavaScript";
    const imported = importDictionary(csv);
    const exported = exportDictionary(imported);
    assert.equal(exported, csv);
  });
});
