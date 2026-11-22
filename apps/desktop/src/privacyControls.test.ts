import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  CAPTURE_RETENTION_KEY,
  applyCaptureRetention,
  countExpiredCaptures,
  deleteAllLocalData,
  loadCaptureRetentionDays,
  retentionLabel,
  saveCaptureRetentionDays,
  type NativeCall,
} from "./privacyControls";

function memoryStorage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

function recordingCalls(results: Record<string, unknown> = {}) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const call: NativeCall = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, ...(args ? { args } : {}) });
    const result = results[command];
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { call, calls };
}

describe("capture retention", () => {
  it("keeps recordings by default and ignores unknown values", () => {
    assert.equal(loadCaptureRetentionDays(memoryStorage()), 0);
    assert.equal(
      loadCaptureRetentionDays(memoryStorage({ [CAPTURE_RETENTION_KEY]: "5" })),
      0,
    );
    const storage = memoryStorage();
    saveCaptureRetentionDays(30, storage);
    assert.equal(loadCaptureRetentionDays(storage), 30);
    assert.equal(retentionLabel(0), "Until I delete them");
    assert.equal(retentionLabel(1), "1 day");
    assert.equal(retentionLabel(90), "90 days");
  });

  it("only asks the native side to purge when a limit is set", async () => {
    const keep = recordingCalls();
    assert.equal(await applyCaptureRetention(keep.call, 0), 0);
    assert.deepEqual(keep.calls, []);

    const week = recordingCalls({ purge_local_captures: 3 });
    assert.equal(await applyCaptureRetention(week.call, 7), 3);
    assert.deepEqual(week.calls, [
      { command: "purge_local_captures", args: { olderThanDays: 7 } },
    ]);
  });

  it("counts what a shorter period deletes now, as the native purge does", () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const day = 86_400_000;
    const captures = [
      { createdAtMs: now - 10 * day },
      { createdAtMs: now - 2 * day },
      { createdAtMs: now - 3 * day, pinned: true },
      { createdAtMs: now - day + 1 },
      { createdAtMs: now - 60_000 },
    ];
    assert.equal(countExpiredCaptures(captures, 0, now), 0);
    assert.equal(countExpiredCaptures(captures, 1, now), 2);
    assert.equal(countExpiredCaptures(captures, 7, now), 1);
    assert.equal(countExpiredCaptures(captures, 30, now), 0);
    assert.equal(countExpiredCaptures([], 1, now), 0);
  });
});

describe("delete all my data", () => {
  it("removes recordings, saved keys and every Sonolect setting", async () => {
    const storage = memoryStorage({
      "sonolect.dictionaryEntries": "[]",
      "sonolect.providers.v1": "{}",
      "sonolect.transcriptDraft": "{}",
      "other-app.setting": "keep",
    });
    const { call, calls } = recordingCalls({ purge_local_captures: 4 });

    const result = await deleteAllLocalData(call, storage);

    assert.equal(result.recordingsRemoved, 4);
    assert.equal(result.settingsRemoved, 3);
    assert.deepEqual(result.problems, []);
    assert.deepEqual([...storage.data.keys()], ["other-app.setting"]);
    assert.deepEqual(calls, [
      { command: "purge_local_captures", args: { olderThanDays: null } },
      { command: "delete_provider_key", args: { provider: "openrouter" } },
      { command: "delete_provider_key", args: { provider: "opencode" } },
    ]);
  });

  it("still clears settings and reports when recordings cannot be deleted", async () => {
    const storage = memoryStorage({ "sonolect.snippets": "[]" });
    const { call } = recordingCalls({
      purge_local_captures: new Error("disk is read-only"),
      delete_provider_key: new Error("Secure key storage requires Windows."),
    });

    const result = await deleteAllLocalData(call, storage);

    assert.equal(result.recordingsRemoved, 0);
    assert.equal(result.settingsRemoved, 1);
    assert.deepEqual(result.problems, ["Recordings: disk is read-only"]);
    assert.equal(storage.data.size, 0);
  });

  it("forgets the sync key and state first, in a build with sync", async () => {
    const storage = memoryStorage({ "sonolect.sync.newerSchema": "1" });
    const order: string[] = [];
    const { call, calls } = recordingCalls({ purge_local_captures: 2 });
    const result = await deleteAllLocalData(
      async <T>(command: string, args?: Record<string, unknown>) => {
        order.push(command);
        return call<T>(command, args);
      },
      storage,
      {
        forgetSync: async () => {
          order.push("forget sync");
        },
      },
    );
    assert.deepEqual(result.problems, []);
    assert.equal(order[0], "forget sync");
    assert.equal(calls.length, 3);
    assert.equal(storage.data.size, 0);
  });

  it("deletes the rest when sync cannot be forgotten, and says so", async () => {
    const { call } = recordingCalls({ purge_local_captures: 1 });
    const result = await deleteAllLocalData(call, memoryStorage(), {
      forgetSync: async () => {
        throw new Error("the keychain is locked");
      },
    });
    assert.equal(result.recordingsRemoved, 1);
    assert.deepEqual(result.problems, ["Sync: the keychain is locked"]);
  });
});
