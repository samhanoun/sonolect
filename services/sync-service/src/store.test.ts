import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideWrite } from "./store.js";
import { defineStoreTests } from "./store-suite.js";
import {
  memoryStores,
  newRid,
  sealedBytes,
  sqliteStores,
} from "./test-support.js";

defineStoreTests(memoryStores);
defineStoreTests(sqliteStores());

describe("decideWrite", () => {
  it("never counts fewer than no tombstones", () => {
    // A vault whose tombstone count was never written reads as 0, while it
    // holds a tombstone: bringing that note back must not make it -1.
    const counters = { head: 2, records: 2, tombstones: 0, bytes: 600 };
    const rid = newRid();
    const current = {
      rid,
      rev: 2,
      seq: 2,
      deleted: true,
      ct: sealedBytes(298),
      size: 298,
      updatedAt: 0,
    };
    const { result } = decideWrite(
      { rid, baseRev: 2, deleted: false, ct: sealedBytes(300) },
      current,
      counters,
      {
        maxVaultRecords: 20_000,
        maxVaultTombstones: 20_000,
        maxVaultBytes: 1 << 20,
        maxTombstoneBytes: 1024,
      },
      1,
    );
    assert.equal(result.status, "ok");
    assert.equal(counters.tombstones, 0);
    assert.equal(counters.records, 2);
  });
});
