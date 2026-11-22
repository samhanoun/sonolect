import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SYNC_KEPT_DELETES_ITEM, createKeptDeletes } from "./keptDeletes";
import { MemoryKv } from "./testSupport";

const VAULT = "AAAAAAAAAAAAAAAAAAAAAA";
const OTHER = "BBBBBBBBBBBBBBBBBBBBBB";
const at = (t: number) => ({ t, c: 0, d: "dev" });

describe("the deletes kept while no vault is open", () => {
  it("keeps them by vault, the later delete of a note winning, and hands them over once", async () => {
    const kv = new MemoryKv();
    const kept = createKeptDeletes(kv);
    await kept.keep(VAULT, [{ id: "a", deletedAt: at(5) }]);
    await kept.keep(VAULT, [
      { id: "a", deletedAt: at(3) },
      { id: "b", deletedAt: at(4) },
    ]);
    await kept.keep(OTHER, [{ id: "c", deletedAt: at(1) }]);
    const taken: unknown[] = [];
    await kept.take(VAULT, async (deletes) => {
      taken.push(...deletes);
    });
    assert.deepEqual(taken, [
      { id: "a", deletedAt: at(5) },
      { id: "b", deletedAt: at(4) },
    ]);
    assert.deepEqual(await kept.ids(VAULT), []);
    assert.deepEqual(await kept.ids(OTHER), ["c"]);
  });

  it("keeps them when the engine could not take them", async () => {
    const kv = new MemoryKv();
    const kept = createKeptDeletes(kv);
    await kept.keep(VAULT, [{ id: "a", deletedAt: at(5) }]);
    await assert.rejects(
      kept.take(VAULT, () => Promise.reject(new Error("closed"))),
    );
    assert.deepEqual(await kept.ids(VAULT), ["a"]);
  });

  it("ignores what is not a delete, and a damaged value", async () => {
    const kv = new MemoryKv();
    await kv.setItem(
      SYNC_KEPT_DELETES_ITEM,
      JSON.stringify({
        [VAULT]: [{ id: "ok" }, { id: "bad id!" }, 7, { id: "x", hlc: 3 }],
        "not a vault": [{ id: "y" }],
      }),
    );
    const kept = createKeptDeletes(kv);
    assert.deepEqual(await kept.ids(VAULT), ["ok", "x"]);
    await kv.setItem(SYNC_KEPT_DELETES_ITEM, "{");
    assert.deepEqual(await kept.ids(VAULT), []);
    await kept.clear();
    assert.equal(kv.data.has(SYNC_KEPT_DELETES_ITEM), false);
  });

  it("the recovery screen's delete makes the phone download the other devices' notes again", () => {
    // store.ts clearHistory("here") tells sync the notes were cleared here.
    const store = readFileSync(path.join(__dirname, "..", "store.ts"), "utf8");
    const clear = store.slice(
      store.indexOf("clearHistory: async"),
      store.indexOf("eraseAll: async"),
    );
    assert.match(
      clear,
      /scope === "here"\) await sync\?\.notesClearedLocally\(\)/,
    );
  });
});
