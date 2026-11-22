import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { RecordState, SyncMeta } from "@sonolect/sync-core";

import { createDesktopStateStore } from "./desktopState";
import { FakeNative } from "./testing/fakeNative";

const native = () =>
  new FakeNative({
    request: async () => ({ status: 500, body: "" }),
    now: () => 0,
  });

const meta = (cursor: number): SyncMeta => ({
  v: 1,
  vaultId: "v".repeat(24),
  deviceId: "desk-device",
  clock: { t: 1_000, c: 0, d: "desk-device" },
  cursor,
  highSeq: cursor,
  vaultCreated: true,
  startedAt: 1_000,
  pendingDeletes: {},
  tooLarge: {},
  unreadable: 0,
  reader: 1,
});

const RID = "Abcdefghijklmnopqrstuvwx";
const record: RecordState = {
  id: "note-1",
  rev: 3,
  hlc: { t: 1_000, c: 1, d: "desk-device" },
  deleted: false,
  fp: "fingerprint",
};

describe("the desktop sync state", () => {
  it("starts empty, and saves the records and the meta in one call", async () => {
    const device = native();
    const store = createDesktopStateStore(device.invoke);
    assert.equal(await store.load(), null);

    await store.save({ meta: meta(5), records: new Map([[RID, record]]) });
    assert.deepEqual(
      device.calls.filter((command) => command.startsWith("sync_state")),
      ["sync_state_load", "sync_state_save"],
    );
    assert.deepEqual([...device.state.keys()].sort(), ["meta", "r.A"]);

    // Another start reads the same state back.
    const again = await createDesktopStateStore(device.invoke).load();
    assert.equal(again?.meta.cursor, 5);
    assert.deepEqual(again?.records.get(RID), record);
  });

  it("keeps a save that failed for the next one", async () => {
    const device = native();
    const store = createDesktopStateStore(device.invoke);
    await store.load();
    device.failNextStateSave = "The sync state could not be saved.";
    await assert.rejects(
      store.save({ meta: meta(5), records: new Map([[RID, record]]) }),
      /The sync state could not be saved\./,
    );
    assert.equal(device.state.size, 0);

    // The next save writes what the failed one did not.
    await store.save({ meta: meta(7) });
    const loaded = await createDesktopStateStore(device.invoke).load();
    assert.equal(loaded?.meta.cursor, 7);
    assert.deepEqual(loaded?.records.get(RID), record);
  });

  it("forgets everything, on the native side too", async () => {
    const device = native();
    const store = createDesktopStateStore(device.invoke);
    await store.load();
    await store.save({ meta: meta(5), records: new Map([[RID, record]]) });
    device.deletes.set("gone-note", {});
    await store.clear();
    assert.equal(device.state.size, 0);
    assert.equal(device.deletes.size, 0);
    assert.equal(await store.load(), null);
  });
});
