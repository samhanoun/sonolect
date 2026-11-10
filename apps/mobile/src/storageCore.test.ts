import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TranscriptTurn } from "./domain";
import type { KeyValueStore } from "./storageCore";
import {
  CORRUPT_SUFFIX,
  INDEX_KEY,
  LEGACY_V1_KEY,
  LEGACY_V2_KEY,
  MAX_TEXT_LENGTH,
  UNKNOWN_DATE,
  V01_SAMPLE_TRANSCRIPTS,
  asRecord,
  createJsonStore,
  createNoteStore,
  isUnreadableValueError,
  isV01Sample,
  noteKey,
  parseIndex,
  sanitizeDictionary,
  sanitizeSnippets,
  sanitizeTurn,
  serializeIndex,
} from "./storageCore";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const SETTINGS_KEY = "sonolect.mobile.settings";

type Op =
  | "getItem"
  | "setItem"
  | "removeItem"
  | "multiGet"
  | "multiSet"
  | "multiRemove"
  | "getAllKeys";

const WRITES: readonly Op[] = [
  "setItem",
  "removeItem",
  "multiSet",
  "multiRemove",
];

/** An in-memory KeyValueStore with a call log and fault injection. */
class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  readonly log: string[] = [];
  /** Return true to make the call reject. */
  fail: (op: Op, keys: readonly string[]) => boolean = () => false;
  /** Awaited before each call runs. */
  gate: (op: Op, keys: readonly string[]) => Promise<void> = () =>
    Promise.resolve();
  /** Changes what setItem stores. */
  tamper: (key: string, value: string) => string = (_key, value) => value;

  private async run<T>(
    op: Op,
    keys: readonly string[],
    action: () => T,
  ): Promise<T> {
    await this.gate(op, keys);
    this.log.push(keys.length > 0 ? `${op} ${keys.join(",")}` : op);
    if (this.fail(op, keys)) throw new Error(`${op} failed`);
    return action();
  }

  getItem(key: string) {
    return this.run("getItem", [key], () => this.data.get(key) ?? null);
  }

  setItem(key: string, value: string) {
    return this.run("setItem", [key], () => {
      this.data.set(key, this.tamper(key, value));
    });
  }

  removeItem(key: string) {
    return this.run("removeItem", [key], () => {
      this.data.delete(key);
    });
  }

  multiGet(keys: readonly string[]) {
    return this.run("multiGet", keys, () =>
      keys.map((key) => [key, this.data.get(key) ?? null] as const),
    );
  }

  multiSet(pairs: readonly (readonly [string, string])[]) {
    return this.run(
      "multiSet",
      pairs.map(([key]) => key),
      () => {
        for (const [key, value] of pairs) this.data.set(key, value);
      },
    );
  }

  multiRemove(keys: readonly string[]) {
    return this.run("multiRemove", keys, () => {
      for (const key of keys) this.data.delete(key);
    });
  }

  getAllKeys() {
    return this.run("getAllKeys", [], () => [...this.data.keys()]);
  }

  /** The write calls in the log, in order. */
  writes(): string[] {
    return this.log.filter((entry) =>
      WRITES.some((op) => entry.startsWith(`${op} `)),
    );
  }

  snapshot(): [string, string][] {
    return [...this.data.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
}

/** Note n is n minutes older than NOW, so lower numbers are newer. */
const note = (
  n: number,
  overrides: Partial<TranscriptTurn> = {},
): TranscriptTurn => ({
  id: `turn_${n}`,
  rawText: `raw ${n}`,
  refinedText: `Note ${n}.`,
  mode: "dictate",
  language: "en-US",
  privacyMode: true,
  createdAt: new Date(NOW - n * 60_000).toISOString(),
  durationMs: 1000,
  source: "microphone",
  syncState: "local",
  ...overrides,
});

const storeOn = (kv: KeyValueStore) => createNoteStore(kv, { now: () => NOW });

const ids = (notes: readonly TranscriptTurn[]) => notes.map((turn) => turn.id);

const indexOf = (kv: MemoryStore) => {
  const raw = kv.data.get(INDEX_KEY);
  return raw === undefined ? null : parseIndex(raw);
};

/** A store holding these notes through a real save. */
async function seeded(notes: readonly TranscriptTurn[]): Promise<MemoryStore> {
  const kv = new MemoryStore();
  const store = storeOn(kv);
  await store.load();
  await store.save(notes);
  kv.log.length = 0;
  return kv;
}

describe("sanitizeTurn", () => {
  it("keeps a valid note as it is", () => {
    const pinned = note(1, { pinned: true, mode: "summarize" });
    assert.deepEqual(sanitizeTurn(pinned, NOW), pinned);
    assert.deepEqual(sanitizeTurn(note(2), NOW), note(2));
  });

  it("rejects what can't be a note and repairs the rest", () => {
    const cases: [string, unknown, Partial<TranscriptTurn> | null][] = [
      ["null", null, null],
      ["a string", "note", null],
      ["an id of 129 characters", { ...note(1), id: "x".repeat(129) }, null],
      ["an empty id", { ...note(1), id: "" }, null],
      ["a numeric id", { ...note(1), id: 7 }, null],
      ["a non-string text", { ...note(1), refinedText: 42 }, null],
      ["an object as raw text", { ...note(1), rawText: { a: 1 } }, null],
      [
        "no text at all",
        { ...note(1), rawText: undefined, refinedText: undefined },
        null,
      ],
      [
        "a future date",
        { ...note(1), createdAt: "2999-01-01T00:00:00Z" },
        { createdAt: new Date(NOW).toISOString() },
      ],
      [
        "an unparseable date",
        { ...note(1), createdAt: "not-a-date" },
        { createdAt: UNKNOWN_DATE },
      ],
      [
        "a numeric date",
        { ...note(1), createdAt: 1700000000000 },
        { createdAt: UNKNOWN_DATE },
      ],
      ["an unknown mode", { ...note(1), mode: { a: 1 } }, { mode: "dictate" }],
      ["a NaN duration", { ...note(1), durationMs: Number.NaN }, {}],
      ["a negative duration", { ...note(1), durationMs: -5 }, {}],
      [
        "a long language",
        { ...note(1), language: "x".repeat(36) },
        { language: "auto" },
      ],
      ["an unknown source", { ...note(1), source: "sample" }, {}],
      [
        "an unknown sync state",
        { ...note(1), syncState: "uploading" },
        { syncState: "local" },
      ],
      [
        "a non-boolean privacy mode",
        { ...note(1), privacyMode: "yes" },
        { privacyMode: false },
      ],
    ];
    for (const [label, value, expected] of cases) {
      const result = sanitizeTurn(value, NOW);
      if (expected === null) {
        assert.equal(result, null, label);
        continue;
      }
      assert.ok(result, label);
      const fixed: TranscriptTurn = {
        ...note(1),
        durationMs: label.includes("duration") ? 0 : note(1).durationMs,
        ...expected,
      };
      assert.deepEqual(result, fixed, label);
    }
  });

  it("omits pinned unless it is exactly true", () => {
    for (const pinned of ["yes", 1, false, null]) {
      const result = sanitizeTurn({ ...note(1), pinned }, NOW);
      assert.ok(result);
      assert.equal("pinned" in result, false, String(pinned));
    }
    assert.equal(sanitizeTurn({ ...note(1), pinned: true }, NOW)?.pinned, true);
  });

  it("uses one text for the other when one is missing", () => {
    const { refinedText: _refined, ...rawOnly } = note(1);
    assert.equal(sanitizeTurn(rawOnly, NOW)?.refinedText, "raw 1");
    const { rawText: _raw, ...refinedOnly } = note(1);
    assert.equal(sanitizeTurn(refinedOnly, NOW)?.rawText, "Note 1.");
    assert.equal(
      sanitizeTurn({ ...note(1), rawText: null }, NOW)?.rawText,
      "Note 1.",
    );
  });

  it("caps each text and drops unknown fields", () => {
    const long = "a".repeat(MAX_TEXT_LENGTH + 10);
    const result = sanitizeTurn(
      { ...note(1), rawText: long, refinedText: long, extra: "x", token: 1 },
      NOW,
    );
    assert.equal(result?.rawText.length, MAX_TEXT_LENGTH);
    assert.equal(result?.refinedText.length, MAX_TEXT_LENGTH);
    assert.deepEqual(
      Object.keys(result ?? {}).sort(),
      Object.keys(note(1)).sort(),
    );
  });
});

describe("v0.1 sample transcripts", () => {
  it("are the three sentences v0.1 saved", () => {
    assert.equal(V01_SAMPLE_TRANSCRIPTS.length, 3);
    assert.ok(V01_SAMPLE_TRANSCRIPTS[0].startsWith("Rappelle-moi de préparer"));
    assert.ok(V01_SAMPLE_TRANSCRIPTS[1].startsWith("Réponds à Camille"));
    assert.ok(V01_SAMPLE_TRANSCRIPTS[2].startsWith("Note réunion produit:"));
  });

  it("match on the trimmed raw text only", () => {
    for (const sample of V01_SAMPLE_TRANSCRIPTS) {
      assert.equal(isV01Sample({ rawText: `  ${sample}\n` }), true);
    }
    assert.equal(isV01Sample({ rawText: "Réponds à Camille." }), false);
    assert.equal(
      isV01Sample({ rawText: `${V01_SAMPLE_TRANSCRIPTS[0]} Merci.` }),
      false,
    );
  });
});

describe("note store", () => {
  it("writes nothing on a fresh install", async () => {
    const kv = new MemoryStore();
    const store = storeOn(kv);
    assert.equal(store.isDegraded(), true);
    assert.deepEqual(await store.load(), { ok: true, notes: [] });
    assert.deepEqual(kv.writes(), []);
    assert.equal(store.isDegraded(), false);
  });

  it("keeps 150 notes, pinned ones included, in order (no cap)", async () => {
    const notes = Array.from({ length: 150 }, (_, n) =>
      note(n, n >= 145 ? { pinned: true } : {}),
    );
    const kv = await seeded(notes);
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.equal(result.notes.length, 150);
    assert.deepEqual(result.notes, notes);
    assert.deepEqual(indexOf(kv), ids(notes));
    // Read in batches of 50.
    assert.equal(
      kv.log.filter((entry) => entry.startsWith("multiGet")).length,
      3,
    );
  });

  it("writes changed notes, then removals, then the index", async () => {
    const kv = await seeded([note(1), note(2), note(3)]);
    const store = storeOn(kv);
    const [a, b, c] = (await store.load()).notes;
    assert.ok(a && b && c);
    kv.log.length = 0;

    await store.save([{ ...a, pinned: true }, b, c]);
    assert.deepEqual(kv.writes(), [
      `multiSet ${noteKey(a.id)}`,
      `setItem ${INDEX_KEY}`,
    ]);

    kv.log.length = 0;
    await store.save([{ ...a, pinned: true }, c]);
    assert.deepEqual(kv.writes(), [
      `multiRemove ${noteKey(b.id)}`,
      `setItem ${INDEX_KEY}`,
    ]);

    kv.log.length = 0;
    await store.save([{ ...c, refinedText: "Edited." }]);
    assert.deepEqual(kv.writes(), [
      `multiSet ${noteKey(c.id)}`,
      `multiRemove ${noteKey(a.id)}`,
      `setItem ${INDEX_KEY}`,
    ]);
    assert.deepEqual(indexOf(kv), [c.id]);
    assert.deepEqual((await storeOn(kv).load()).notes, [
      { ...c, refinedText: "Edited." },
    ]);
  });

  it("gives ok false for an unreadable index and changes nothing", async () => {
    const kv = await seeded([note(1), note(2)]);
    const before = kv.snapshot();
    kv.fail = (op, keys) => op === "getItem" && keys[0] === INDEX_KEY;
    const store = storeOn(kv);
    const result = await store.load();
    assert.equal(result.ok, false);
    assert.equal(store.isDegraded(), true);
    assert.deepEqual(kv.writes(), []);
    assert.deepEqual(kv.snapshot(), before);
    // What can be read without the index is still shown.
    assert.deepEqual(ids(result.notes), ["turn_1", "turn_2"]);
  });

  it("saves only note keys while degraded; the next load recovers them", async () => {
    const kv = await seeded([note(1), note(2)]);
    kv.fail = (op, keys) => op === "getItem" && keys[0] === INDEX_KEY;
    const store = storeOn(kv);
    const shown = (await store.load()).notes;
    kv.fail = () => false;
    kv.log.length = 0;

    // A new capture, and note 2 deleted.
    const fresh = note(0);
    await store.save([fresh, ...shown.filter((turn) => turn.id !== "turn_2")]);
    assert.deepEqual(kv.writes(), [`multiSet ${noteKey(fresh.id)}`]);
    assert.deepEqual(indexOf(kv), ["turn_1", "turn_2"]);

    const next = storeOn(kv);
    const result = await next.load();
    assert.equal(result.ok, true);
    assert.equal(next.isDegraded(), false);
    assert.deepEqual(ids(result.notes), ["turn_0", "turn_1", "turn_2"]);
    assert.deepEqual(indexOf(kv), ["turn_0", "turn_1", "turn_2"]);
  });

  it("merges orphans in by date and keeps the index order", async () => {
    const kv = await seeded([note(1), note(5)]);
    for (const n of [3, 0, 9]) {
      kv.data.set(noteKey(`turn_${n}`), JSON.stringify(note(n)));
    }
    const result = await storeOn(kv).load();
    assert.deepEqual(ids(result.notes), [
      "turn_0",
      "turn_1",
      "turn_3",
      "turn_5",
      "turn_9",
    ]);
  });

  it("sets a broken note aside and loads the others", async () => {
    const kv = await seeded([note(1), note(2), note(3)]);
    kv.data.set(noteKey("turn_2"), "{not json");
    kv.data.set(noteKey("turn_3"), JSON.stringify({ ...note(3), id: "other" }));
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.deepEqual(ids(result.notes), ["turn_1"]);
    assert.equal(
      kv.data.get(`${noteKey("turn_2")}${CORRUPT_SUFFIX}`),
      "{not json",
    );
    assert.equal(kv.data.has(noteKey("turn_2")), false);
    assert.ok(kv.data.has(`${noteKey("turn_3")}${CORRUPT_SUFFIX}`));
    assert.equal(kv.data.has(noteKey("turn_3")), false);
    // A copy is not a note: the next load does not recover it.
    assert.deepEqual(ids((await storeOn(kv).load()).notes), ["turn_1"]);
  });

  it("keeps a broken note when its copy can't be written", async () => {
    const kv = await seeded([note(1), note(2)]);
    kv.data.set(noteKey("turn_2"), "{not json");
    kv.fail = (op, keys) =>
      op === "setItem" && keys[0]!.endsWith(CORRUPT_SUFFIX);
    const result = await storeOn(kv).load();
    assert.deepEqual(ids(result.notes), ["turn_1"]);
    assert.equal(kv.data.get(noteKey("turn_2")), "{not json");
  });

  it("skips a note the index lists but that was deleted", async () => {
    const kv = await seeded([note(1), note(2)]);
    kv.data.delete(noteKey("turn_1"));
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.deepEqual(ids(result.notes), ["turn_2"]);
  });

  it("deletes nothing when a note read fails", async () => {
    const kv = await seeded([note(1), note(2)]);
    const before = kv.snapshot();
    kv.fail = (op) => op === "multiGet";
    const store = storeOn(kv);
    const result = await store.load();
    assert.deepEqual(result, { ok: false, notes: [] });
    assert.deepEqual(kv.writes(), []);
    assert.deepEqual(kv.snapshot(), before);
  });

  it("rebuilds an index it can't parse", async () => {
    const kv = await seeded([note(1), note(2)]);
    kv.data.set(INDEX_KEY, "{broken");
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.deepEqual(ids(result.notes), ["turn_1", "turn_2"]);
    assert.equal(kv.data.get(`${INDEX_KEY}${CORRUPT_SUFFIX}`), "{broken");
    assert.deepEqual(indexOf(kv), ["turn_1", "turn_2"]);
  });

  it("writes a future-dated note back with its corrected date", async () => {
    const kv = new MemoryStore();
    const future = { ...note(1), createdAt: "2999-01-01T00:00:00.000Z" };
    kv.data.set(noteKey(future.id), JSON.stringify(future));
    kv.data.set(INDEX_KEY, serializeIndex([future.id]));
    const store = storeOn(kv);
    const { notes } = await store.load();
    assert.equal(notes[0]?.createdAt, new Date(NOW).toISOString());
    kv.log.length = 0;
    await store.save(notes);
    assert.deepEqual(kv.writes(), [
      `multiSet ${noteKey(future.id)}`,
      `setItem ${INDEX_KEY}`,
    ]);
    assert.equal(
      JSON.parse(kv.data.get(noteKey(future.id)) ?? "{}").createdAt,
      new Date(NOW).toISOString(),
    );
  });

  it("never stores a note a load would reject", async () => {
    const kv = new MemoryStore();
    const store = storeOn(kv);
    await store.load();
    await store.save([note(1), { ...note(2), id: "x".repeat(200) }]);
    assert.deepEqual(indexOf(kv), ["turn_1"]);
    assert.deepEqual(
      [...kv.data.keys()].filter((key) =>
        key.startsWith("sonolect.mobile.note."),
      ),
      [noteKey("turn_1")],
    );
  });

  it("removes every note, the index and the older histories on clear", async () => {
    const kv = await seeded([note(1), note(2)]);
    kv.data.set(noteKey("turn_9"), JSON.stringify(note(9)));
    kv.data.set(`${noteKey("turn_8")}${CORRUPT_SUFFIX}`, "{");
    kv.data.set(LEGACY_V2_KEY, "[]");
    kv.data.set(`${LEGACY_V2_KEY}${CORRUPT_SUFFIX}`, "[");
    kv.data.set(LEGACY_V1_KEY, "[]");
    kv.data.set(SETTINGS_KEY, "{}");
    const store = storeOn(kv);
    await store.load();
    await store.clear();
    assert.deepEqual([...kv.data.keys()], [SETTINGS_KEY]);
    assert.deepEqual(await storeOn(kv).load(), { ok: true, notes: [] });
  });

  it("leaves degraded mode after a clear", async () => {
    const kv = await seeded([note(1)]);
    kv.fail = (op, keys) => op === "getItem" && keys[0] === INDEX_KEY;
    const store = storeOn(kv);
    await store.load();
    kv.fail = () => false;
    await store.clear();
    assert.equal(store.isDegraded(), false);
    await store.save([note(0)]);
    assert.deepEqual(indexOf(kv), ["turn_0"]);
  });
});

describe("v2 to v3 migration", () => {
  const sample = note(4, {
    rawText: V01_SAMPLE_TRANSCRIPTS[1],
    refinedText: V01_SAMPLE_TRANSCRIPTS[1],
  });
  const v2 = JSON.stringify([
    note(1),
    sample,
    note(2, { pinned: true }),
    { id: 42, refinedText: "not a note" },
    note(3, { syncState: "queued" }),
  ]);
  const migrated = [
    note(1),
    note(2, { pinned: true }),
    note(3, { syncState: "queued" }),
  ];

  it("moves v2 to one key per note, without samples or malformed entries", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.deepEqual(result.notes, migrated);
    assert.deepEqual(indexOf(kv), ids(migrated));
    assert.equal(kv.data.has(LEGACY_V2_KEY), false);
    assert.equal(kv.data.has(noteKey(sample.id)), false);
    for (const turn of migrated) {
      assert.deepEqual(
        JSON.parse(kv.data.get(noteKey(turn.id)) ?? "null"),
        turn,
      );
    }
    // The next launch reads the index.
    assert.deepEqual((await storeOn(kv).load()).notes, migrated);
  });

  it("removes v2 only after the index was read back", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    await storeOn(kv).load();
    const at = (entry: string) => kv.log.indexOf(entry);
    const notesWritten = kv.log.findIndex((entry) =>
      entry.startsWith("multiSet "),
    );
    assert.ok(notesWritten >= 0);
    assert.ok(notesWritten < at(`setItem ${INDEX_KEY}`));
    assert.ok(
      at(`setItem ${INDEX_KEY}`) < kv.log.lastIndexOf(`getItem ${INDEX_KEY}`),
    );
    assert.ok(
      kv.log.lastIndexOf(`getItem ${INDEX_KEY}`) <
        at(`removeItem ${LEGACY_V2_KEY}`),
    );
    assert.equal(kv.log.at(-1), `removeItem ${LEGACY_V2_KEY}`);
  });

  it("keeps v2 when a write fails, and migrates at the next launch", async () => {
    for (const failing of ["multiSet", "setItem"] as const) {
      const kv = new MemoryStore();
      kv.data.set(LEGACY_V2_KEY, v2);
      kv.fail = (op) => op === failing;
      const store = storeOn(kv);
      const result = await store.load();
      assert.equal(result.ok, false, failing);
      assert.equal(store.isDegraded(), true, failing);
      assert.equal(kv.data.get(LEGACY_V2_KEY), v2, failing);
      assert.equal(kv.data.has(INDEX_KEY), false, failing);

      kv.fail = () => false;
      const retry = await storeOn(kv).load();
      assert.equal(retry.ok, true, failing);
      assert.deepEqual(retry.notes, migrated, failing);
      assert.equal(kv.data.has(LEGACY_V2_KEY), false, failing);
    }
  });

  it("keeps v2 when the index read back differs", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    kv.tamper = (key, value) =>
      key === INDEX_KEY ? serializeIndex(["turn_1"]) : value;
    const result = await storeOn(kv).load();
    assert.equal(result.ok, false);
    assert.equal(kv.data.get(LEGACY_V2_KEY), v2);
    assert.equal(kv.data.has(INDEX_KEY), false);

    kv.tamper = (_key, value) => value;
    assert.deepEqual((await storeOn(kv).load()).notes, migrated);
    assert.equal(kv.data.has(LEGACY_V2_KEY), false);
  });

  it("keeps an unreadable v2 untouched", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    kv.fail = (op, keys) => op === "getItem" && keys[0] === LEGACY_V2_KEY;
    const result = await storeOn(kv).load();
    assert.deepEqual(result, { ok: false, notes: [] });
    assert.deepEqual(kv.writes(), []);
    assert.equal(kv.data.get(LEGACY_V2_KEY), v2);
  });

  it("shows notes saved since, while v2 stays unreadable", async () => {
    // An Android v2 value over the ~2 MB row limit can never be read.
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    kv.fail = (op, keys) => op === "getItem" && keys[0] === LEGACY_V2_KEY;
    const first = storeOn(kv);
    await first.load();
    await first.save([note(0)]);
    assert.deepEqual(kv.writes(), [`multiSet ${noteKey("turn_0")}`]);

    kv.log.length = 0;
    const second = await storeOn(kv).load();
    assert.equal(second.ok, false);
    assert.deepEqual(ids(second.notes), ["turn_0"]);
    assert.deepEqual(kv.writes(), []);
    assert.equal(kv.data.get(LEGACY_V2_KEY), v2);
  });

  it("sets an unparseable v2 aside", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, "[{oops");
    const result = await storeOn(kv).load();
    assert.deepEqual(result, { ok: true, notes: [] });
    assert.equal(kv.data.get(`${LEGACY_V2_KEY}${CORRUPT_SUFFIX}`), "[{oops");
    assert.equal(kv.data.has(LEGACY_V2_KEY), false);
  });

  it("keeps notes saved meanwhile over their v2 copies", async () => {
    // A session that could not finish the migration pinned note 1 and
    // added note 0.
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, v2);
    kv.data.set(noteKey("turn_1"), JSON.stringify(note(1, { pinned: true })));
    kv.data.set(noteKey("turn_0"), JSON.stringify(note(0)));
    const result = await storeOn(kv).load();
    assert.equal(result.ok, true);
    assert.deepEqual(result.notes, [
      note(0),
      note(1, { pinned: true }),
      ...migrated.slice(1),
    ]);
    assert.equal(kv.data.has(LEGACY_V2_KEY), false);
    assert.equal(
      kv.writes().some((entry) => entry.includes(noteKey("turn_1"))),
      false,
    );
  });

  it("removes a v2 that only held samples", async () => {
    const kv = new MemoryStore();
    kv.data.set(LEGACY_V2_KEY, JSON.stringify([sample]));
    assert.deepEqual(await storeOn(kv).load(), { ok: true, notes: [] });
    assert.equal(kv.data.has(LEGACY_V2_KEY), false);
    assert.deepEqual(indexOf(kv), []);
  });
});

describe("write queue", () => {
  it("applies concurrent saves in call order", async () => {
    const kv = new MemoryStore();
    const store = storeOn(kv);
    await store.load();
    let slowed = false;
    kv.gate = async (op) => {
      if (op === "multiSet" && !slowed) {
        slowed = true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const first = store.save([note(1)]);
    const second = store.save([note(0), note(1)]);
    await Promise.all([first, second]);
    assert.deepEqual(indexOf(kv), ["turn_0", "turn_1"]);
    assert.ok(
      kv.log.indexOf(`setItem ${INDEX_KEY}`) <
        kv.log.indexOf(`multiSet ${noteKey("turn_0")}`),
    );
  });

  it("rejects a failed save without blocking the next", async () => {
    const kv = new MemoryStore();
    const store = storeOn(kv);
    await store.load();
    let failures = 1;
    kv.fail = (op) => op === "multiSet" && failures-- > 0;
    const first = store.save([note(1)]);
    const second = store.save([note(0), note(1)]);
    await assert.rejects(first);
    await second;
    assert.deepEqual(indexOf(kv), ["turn_0", "turn_1"]);
    // The failed save's note is written by the next one.
    assert.deepEqual(ids((await storeOn(kv).load()).notes), [
      "turn_0",
      "turn_1",
    ]);
  });
});

describe("JSON values (settings, dictionary, snippets)", () => {
  const DICTIONARY_KEY = "sonolect.mobile.dictionary";

  it("reads a value and an absent key", async () => {
    const kv = new MemoryStore();
    kv.data.set(SETTINGS_KEY, JSON.stringify({ language: "fr-FR" }));
    const json = createJsonStore(kv);
    assert.deepEqual(await json.read(SETTINGS_KEY), {
      ok: true,
      value: { language: "fr-FR" },
    });
    assert.deepEqual(await json.read(DICTIONARY_KEY), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(kv.writes(), []);
  });

  it("keeps a value it can't read and never overwrites it", async () => {
    const kv = new MemoryStore();
    kv.data.set(DICTIONARY_KEY, JSON.stringify([{ id: "d1" }]));
    kv.fail = (op) => op === "getItem";
    const json = createJsonStore(kv);
    assert.deepEqual(await json.read(DICTIONARY_KEY), { ok: false });
    kv.fail = () => false;

    await assert.rejects(json.write(DICTIONARY_KEY, []), (error) =>
      isUnreadableValueError(error),
    );
    assert.deepEqual(kv.writes(), []);
    assert.equal(kv.data.get(DICTIONARY_KEY), JSON.stringify([{ id: "d1" }]));

    // Other keys are written as usual.
    await json.write(SETTINGS_KEY, { onboarded: true });
    assert.deepEqual(kv.writes(), [`setItem ${SETTINGS_KEY}`]);
  });

  it("writes a key again once a read succeeds, or after an erase", async () => {
    const kv = new MemoryStore();
    kv.fail = (op) => op === "getItem";
    const json = createJsonStore(kv);
    await json.read(DICTIONARY_KEY);
    await json.read(SETTINGS_KEY);
    kv.fail = () => false;

    await json.read(DICTIONARY_KEY);
    await json.write(DICTIONARY_KEY, []);
    await assert.rejects(json.write(SETTINGS_KEY, {}));

    json.reset();
    await json.write(SETTINGS_KEY, {});
    assert.deepEqual(kv.writes(), [
      `setItem ${DICTIONARY_KEY}`,
      `setItem ${SETTINGS_KEY}`,
    ]);
  });

  it("sets unparseable JSON aside", async () => {
    const kv = new MemoryStore();
    kv.data.set(SETTINGS_KEY, "{not json");
    const json = createJsonStore(kv);
    assert.deepEqual(await json.read(SETTINGS_KEY), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(kv.snapshot(), [
      [`${SETTINGS_KEY}${CORRUPT_SUFFIX}`, "{not json"],
    ]);
    await json.write(SETTINGS_KEY, { onboarded: true });
    assert.equal(kv.data.get(SETTINGS_KEY), '{"onboarded":true}');
  });

  it("keeps unparseable JSON when its copy fails", async () => {
    const kv = new MemoryStore();
    kv.data.set(SETTINGS_KEY, "{not json");
    kv.fail = (op) => op === "setItem";
    const json = createJsonStore(kv);
    assert.deepEqual(await json.read(SETTINGS_KEY), {
      ok: true,
      value: undefined,
    });
    assert.deepEqual(kv.snapshot(), [[SETTINGS_KEY, "{not json"]]);
  });

  it("accepts only plain objects as records", () => {
    assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
    for (const value of [null, undefined, [], "x", 3, true]) {
      assert.equal(asRecord(value), undefined, String(value));
    }
  });

  it("keeps valid dictionary entries and snippets, field by field", () => {
    assert.deepEqual(
      sanitizeDictionary([
        { id: "d1", spoken: "sono", replacement: "Sonolect", extra: 1 },
        { id: "d2", spoken: "x" },
        { id: 3, spoken: "a", replacement: "b" },
        null,
        "d4",
        [],
      ]),
      [{ id: "d1", spoken: "sono", replacement: "Sonolect" }],
    );
    assert.deepEqual(sanitizeDictionary({ id: "d1" }), []);
    assert.deepEqual(sanitizeDictionary(undefined), []);

    assert.deepEqual(
      sanitizeSnippets([
        { id: "s1", trigger: "sig", body: "Best,", extra: true },
        { id: "s2", trigger: "x", body: 4 },
        { trigger: "y", body: "z" },
      ]),
      [{ id: "s1", trigger: "sig", body: "Best," }],
    );
    assert.deepEqual(sanitizeSnippets("[]"), []);
  });
});
