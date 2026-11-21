import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  type HttpRequester,
  type HttpResponse,
  PairingError,
  READER_VERSION,
  type SyncEngineOptions,
  base64urlDecode,
  deriveVaultKeys,
  openSyncEngine,
} from "@sonolect/sync-core";
import { createMemoryVaultServer } from "@sonolect/sync-core/testing";

import { getT, setLocale } from "../i18n";
import type { PreferenceStorage } from "./platform";
import {
  FOCUSED_INTERVAL_MS,
  LOCAL_CHANGE_DELAY_MS,
  NEWER_SCHEMA_KEY,
  RETRY_BASE_MS,
  SyncController,
} from "./syncController";
import {
  syncActionErrorText,
  syncNoticeTexts,
  syncProblemText,
} from "./syncMessages";
import { FakeClock, fakePlatform } from "./testing/fakeClock";
import { FakeNative } from "./testing/fakeNative";

const START = Date.parse("2026-11-21T10:00:00Z");
const DAY = 24 * 60 * 60_000;

function memoryStorage(): PreferenceStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

/** One sync server and a clock shared by the desktops of a test. */
function world() {
  const clock = new FakeClock(START);
  const server = createMemoryVaultServer({ now: clock.now });
  /** Answers given before the server's, in order. */
  const answers: HttpResponse[] = [];
  const request: HttpRequester = async (incoming) =>
    answers.shift() ?? server.request(incoming);
  const pulls = () =>
    server.log.filter(
      ({ method, path }) => method === "GET" && path.endsWith("/changes"),
    ).length;

  const desktop = (
    options: {
      available?: boolean;
      retentionDays?: number;
      storage?: PreferenceStorage;
      openEngine?: SyncControllerOptions["openEngine"];
    } = {},
  ) => {
    const native = new FakeNative({
      request,
      now: clock.now,
      available: options.available ?? true,
    });
    let notesChanged = 0;
    const controller = new SyncController({
      platform: fakePlatform(native.invoke, clock),
      retentionDays: () => options.retentionDays ?? 0,
      onNotesChanged: () => {
        notesChanged += 1;
      },
      storage: options.storage,
      openEngine: options.openEngine,
    });
    native.onLocalChange = () => controller.localChange();
    const vaultId = () => deriveVaultKeys(base64urlDecode(native.key!)).vaultId;
    return {
      native,
      controller,
      view: () => controller.getView(),
      notesChanged: () => notesChanged,
      vaultId,
      /** The notes the server holds for this desktop's vault. */
      serverNotes: () =>
        server.records(vaultId()).filter((record) => !record.deleted).length,
    };
  };

  return { clock, server, answers, pulls, desktop };
}

type SyncControllerOptions = ConstructorParameters<typeof SyncController>[0];

/** A desktop with sync on and its first sync done. */
async function syncedDesktop(
  w: ReturnType<typeof world>,
  options?: Parameters<ReturnType<typeof world>["desktop"]>[0],
) {
  const desk = w.desktop(options);
  await desk.controller.start();
  await desk.controller.turnOn();
  await w.clock.advance(0);
  assert.equal(desk.view().problem, undefined);
  return desk;
}

/** A second desktop that joined `first`'s vault, both synced. */
async function joinedDesktop(
  w: ReturnType<typeof world>,
  first: Awaited<ReturnType<typeof syncedDesktop>>,
  options?: Parameters<ReturnType<typeof world>["desktop"]>[0],
) {
  const pairing = await first.controller.pairing();
  const desk = w.desktop(options);
  await desk.controller.start();
  await desk.controller.join(pairing!.code);
  await w.clock.advance(0);
  return desk;
}

describe("the sync controller", () => {
  it("is invisible and silent in a build without a sync server", async () => {
    const w = world();
    const desk = w.desktop({ available: false });
    await desk.controller.start();
    assert.deepEqual(desk.view(), {
      available: false,
      server: undefined,
      phase: "off",
      syncing: false,
      lastSyncAt: undefined,
      problem: undefined,
      notices: { quotaExceeded: false, tooLarge: false, newerSchema: false },
    });
    desk.native.record("A note");
    desk.controller.localChange();
    desk.controller.setFocused(true);
    desk.controller.syncNow();
    await w.clock.advance(10 * 60_000);
    // One question to the native side, and nothing else: no key, no request.
    assert.deepEqual(desk.native.calls, ["sync_config"]);
    assert.equal(w.server.log.length, 0);
  });

  it("is off until turned on, and then syncs at once", async () => {
    const w = world();
    const desk = w.desktop();
    await desk.controller.start();
    assert.equal(desk.view().available, true);
    assert.equal(desk.view().server, "sync.test");
    assert.equal(desk.view().phase, "off");
    desk.native.record("Recorded before sync");
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.log.length, 0);

    await desk.controller.turnOn();
    assert.equal(desk.view().phase, "on");
    await w.clock.advance(0);
    assert.equal(desk.serverNotes(), 1);
    assert.equal(desk.view().lastSyncAt, w.clock.time);
    assert.equal(desk.view().syncing, false);
    assert.deepEqual(
      w.server.log.map(({ method }) => method),
      ["POST", "GET", "POST"],
    );
  });

  it("syncs again at start when a key is saved", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    await first.controller.close();
    // The app starts again: same keychain, same files.
    const again = new SyncController({
      platform: fakePlatform(first.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    const before = w.pulls();
    await again.start();
    assert.equal(again.getView().phase, "on");
    await w.clock.advance(0);
    assert.equal(w.pulls(), before + 1);
  });

  it("sends a note changed here about 5 s later, together with the next ones", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.record("First");
    await w.clock.advance(2_000);
    desk.native.record("Second");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS - 2_001);
    assert.equal(desk.serverNotes(), 0);
    await w.clock.advance(1);
    assert.equal(desk.serverNotes(), 2);
  });

  it("syncs every 60 s while the window has focus, and not without it", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    const pulls = w.pulls();
    // Focus right after a sync: the next one comes a minute later.
    desk.controller.setFocused(true);
    await w.clock.advance(FOCUSED_INTERVAL_MS - 1);
    assert.equal(w.pulls(), pulls);
    await w.clock.advance(1);
    assert.equal(w.pulls(), pulls + 1);
    await w.clock.advance(FOCUSED_INTERVAL_MS);
    assert.equal(w.pulls(), pulls + 2);

    desk.controller.setFocused(false);
    await w.clock.advance(10 * FOCUSED_INTERVAL_MS);
    assert.equal(w.pulls(), pulls + 2);

    // Back after a long time away: a sync at once.
    desk.controller.setFocused(true);
    await w.clock.advance(0);
    assert.equal(w.pulls(), pulls + 3);
  });

  it("losing focus keeps a sync a local change asked for", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.controller.setFocused(true);
    desk.native.record("Typed, then switched away");
    desk.controller.setFocused(false);
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.equal(desk.serverNotes(), 1);
  });

  it("retries a failing server with growing delays, and says so", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    w.server.failNext(2, 503);
    desk.native.record("Waiting for the server");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.deepEqual(desk.view().problem, { kind: "server" });
    // The jitter is fixed at its middle here: 10 s, then 20 s.
    await w.clock.advance(RETRY_BASE_MS - 1);
    assert.equal(desk.serverNotes(), 0);
    await w.clock.advance(1);
    assert.deepEqual(desk.view().problem, { kind: "server" });
    await w.clock.advance(2 * RETRY_BASE_MS - 1);
    assert.equal(desk.serverNotes(), 0);
    await w.clock.advance(1);
    assert.equal(desk.serverNotes(), 1);
    assert.equal(desk.view().problem, undefined);
  });

  it("spreads its retries out", async () => {
    const w = world();
    const native = new FakeNative({
      request: async () => ({ status: 503, body: "" }),
      now: w.clock.now,
    });
    const delays: number[] = [];
    const platform = fakePlatform(native.invoke, w.clock, () => 1);
    const controller = new SyncController({
      platform: {
        ...platform,
        timers: {
          setTimeout: (run, ms) => {
            delays.push(ms);
            return platform.timers.setTimeout(run, ms);
          },
          clearTimeout: platform.timers.clearTimeout,
        },
      },
      retentionDays: () => 0,
    });
    await controller.start();
    await controller.turnOn();
    await w.clock.advance(20 * 60_000);
    // 0 to start, then 10 s, 20 s, 40 s… at their longest (+25 %), at most 5 min.
    assert.deepEqual(
      delays.slice(0, 7),
      [0, 12_500, 25_000, 50_000, 100_000, 200_000, 375_000],
    );
  });

  it("waits out a rate limit without a word", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    w.answers.push({
      status: 429,
      body: '{"error":"rate_limited","message":"slow down"}',
      retryAfter: "30",
    });
    desk.native.record("Rate limited");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.equal(desk.view().problem, undefined);
    desk.native.record("Another change meanwhile");
    await w.clock.advance(30_000 - 1);
    assert.equal(desk.serverNotes(), 0);
    await w.clock.advance(1);
    assert.equal(desk.serverNotes(), 2);
  });

  it("is quiet offline, and syncs as soon as the network is back", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.requestFailures.push({ kind: "network", message: "offline" });
    desk.native.record("Written offline");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.deepEqual(desk.view().problem, { kind: "offline" });
    assert.equal(desk.view().phase, "on");
    desk.controller.online();
    await w.clock.advance(0);
    assert.equal(desk.view().problem, undefined);
    assert.equal(desk.serverNotes(), 1);
  });

  it("says what failed on this device", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.failNextStateSave = "The sync state could not be saved.";
    desk.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(desk.view().problem, {
      kind: "device",
      detail: "The sync state could not be saved.",
    });
  });

  it("stops when the server refuses the key, until sync is turned off", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    // The server does not know the vault, and its id is taken by another key.
    w.answers.push(
      { status: 401, body: '{"error":"unauthorized","message":"no"}' },
      { status: 409, body: '{"error":"conflict","message":"taken"}' },
    );
    desk.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(desk.view().problem, { kind: "unauthorized" });
    const pulls = w.pulls();
    desk.native.record("Not sent");
    desk.controller.setFocused(true);
    await w.clock.advance(10 * 60_000);
    assert.equal(w.pulls(), pulls);

    await desk.controller.turnOff({ deleteServerCopy: false });
    assert.equal(desk.view().phase, "off");
    assert.equal(desk.view().problem, undefined);
    assert.equal(desk.native.key, null);
    assert.equal(desk.native.state.size, 0);
    assert.deepEqual(desk.native.transcripts(), ["Not sent"]);
  });

  it("joins another device with its code, and refuses a mistyped one", async () => {
    setLocale("en");
    const w = world();
    const first = await syncedDesktop(w);
    first.native.record("From the first desktop");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);

    const second = w.desktop();
    await second.controller.start();
    second.native.record("From the second desktop");
    const pairing = await first.controller.pairing();
    assert.ok(pairing);
    assert.equal(pairing.code.replaceAll("-", "").length, 56);
    assert.equal(pairing.groups.join("-"), pairing.code);
    assert.ok(pairing.link.startsWith("sonolect://sync/join"));
    assert.ok(pairing.qr.size > 0);

    const typed = pairing.code.replaceAll("-", "");
    const wrong =
      typed.slice(0, 9) + (typed[9] === "7" ? "8" : "7") + typed.slice(10);
    const refused = await second.controller.join(wrong).catch((error) => error);
    assert.ok(refused instanceof PairingError);
    assert.equal(syncActionErrorText(refused, getT()), "A character is wrong.");
    assert.equal(second.view().phase, "off");
    assert.equal(second.native.key, null);

    await second.controller.join(pairing.link);
    assert.equal(second.native.key, first.native.key);
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), [
      "From the first desktop",
      "From the second desktop",
    ]);
    assert.ok(second.notesChanged() > 0);
    first.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(first.native.transcripts(), second.native.transcripts());
  });

  it("brings an edit made elsewhere, and a delete made here reaches the others", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const id = first.native.record("Shared note");
    const kept = first.native.record("Kept elsewhere");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    assert.deepEqual(second.native.transcripts(), [
      "Kept elsewhere",
      "Shared note",
    ]);

    second.native.edit(id, "Shared note, edited on the second desktop");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    first.controller.syncNow();
    await w.clock.advance(0);
    assert.equal(
      first.native.note(id)?.transcript,
      "Shared note, edited on the second desktop",
    );

    // The user deletes one note; retention removes another: only the first travels.
    first.native.deleteByUser(id);
    first.native.purge(kept);
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.equal(first.native.deletes.size, 0);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.equal(second.native.note(id), undefined);
    assert.deepEqual(second.native.transcripts(), ["Kept elsewhere"]);
  });

  it("does not bring notes older than this device keeps", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    first.native.record("Old note", { createdAtMs: START - 40 * DAY });
    first.native.record("Recent note");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first, { retentionDays: 30 });
    assert.deepEqual(second.native.transcripts(), ["Recent note"]);
  });

  it("deleting the server copy turns the other devices off and keeps every note", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    first.native.record("Everyone keeps this");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);

    await first.controller.turnOff({ deleteServerCopy: true });
    assert.equal(first.view().phase, "off");
    assert.equal(first.native.key, null);
    assert.equal(first.native.state.size, 0);
    assert.equal(w.server.records(second.vaultId()).length, 0);

    second.controller.syncNow();
    await w.clock.advance(0);
    assert.equal(second.view().phase, "off");
    assert.deepEqual(second.view().problem, { kind: "deleted" });
    assert.equal(second.native.key, null);
    assert.equal(second.native.state.size, 0);
    for (const desk of [first, second])
      assert.deepEqual(desk.native.transcripts(), ["Everyone keeps this"]);

    // Nothing more happens on either.
    const log = w.server.log.length;
    second.native.record("After the end");
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.log.length, log);
  });

  it("keeps sync on when the server copy cannot be deleted", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    w.server.failNext(1);
    await assert.rejects(desk.controller.turnOff({ deleteServerCopy: true }));
    assert.equal(desk.view().phase, "on");
    assert.ok(desk.native.key);
    // And it still syncs.
    desk.native.record("Still syncing");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.equal(desk.serverNotes(), 1);
  });

  it("turning off without deleting leaves the server copy to the others", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    first.native.record("Stays on the server");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    await second.controller.turnOff({ deleteServerCopy: false });
    assert.equal(second.native.key, null);
    assert.equal(first.serverNotes(), 1);
    first.controller.syncNow();
    await w.clock.advance(0);
    assert.equal(first.view().problem, undefined);
    assert.equal(first.view().phase, "on");
  });

  it("forgets the key and the sync state for “Delete all local data”", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.record("To be erased");
    await desk.controller.forgetLocal();
    assert.equal(desk.view().phase, "off");
    assert.equal(desk.native.key, null);
    assert.equal(desk.native.state.size, 0);
    const log = w.server.log.length;
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.log.length, log);
  });

  it("stays off after a restart when the keychain could not forget the key", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.failNextKeychain =
      "The sync key could not be read or saved in the keychain.";
    await desk.controller.turnOff({ deleteServerCopy: false });
    assert.equal(desk.view().phase, "off");
    assert.equal(desk.view().problem?.kind, "device");
    // The key is still in the keychain, but nothing reads it any more.
    assert.ok(desk.native.key);
    const again = new SyncController({
      platform: fakePlatform(desk.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    await again.start();
    assert.equal(again.getView().phase, "off");
    const log = w.server.log.length;
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.log.length, log);
    // Turning sync on again makes a new vault with a new key.
    const before = desk.native.key;
    await again.turnOn();
    assert.notEqual(desk.native.key, before);
  });

  it("“Delete all local data” forgets the key even when the state cannot be", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    await desk.controller.close();
    const invoke = desk.native.invoke;
    const controller = new SyncController({
      platform: fakePlatform(
        async <T>(command: string, args?: Record<string, unknown>) => {
          if (command === "sync_state_clear")
            throw "The sync state could not be saved.";
          return invoke<T>(command, args);
        },
        w.clock,
      ),
      retentionDays: () => 0,
    });
    await controller.start();
    await assert.rejects(
      controller.forgetLocal(),
      /The sync state could not be saved\./,
    );
    assert.equal(controller.getView().phase, "off");
    assert.equal(desk.native.key, null);
    assert.equal(desk.native.keyInUse, false);
    const log = w.server.log.length;
    await w.clock.advance(10 * 60_000);
    assert.equal(w.server.log.length, log);
  });

  it("turning off while a sync runs waits for it, then forgets", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    desk.native.record("In flight");
    desk.controller.syncNow();
    // The timer fires, the run starts, and turning off comes right after.
    w.clock.advance(0);
    await desk.controller.turnOff({ deleteServerCopy: false });
    await desk.controller.idle();
    assert.equal(desk.view().phase, "off");
    assert.equal(desk.native.key, null);
    assert.equal(desk.native.state.size, 0);
  });

  it("shows the vault's lasting notices, and remembers a newer version", async () => {
    setLocale("en");
    const w = world();
    const storage = memoryStorage();
    const openEngine = async (options: SyncEngineOptions) => {
      const engine = await openSyncEngine(options);
      const sync = engine.sync.bind(engine);
      engine.sync = async () => ({
        ...(await sync()),
        quotaExceeded: true,
        tooLarge: ["big-note"],
        newerSchema: 2,
      });
      return engine;
    };
    const desk = await syncedDesktop(w, { storage, openEngine });
    assert.deepEqual(desk.view().notices, {
      quotaExceeded: true,
      tooLarge: true,
      newerSchema: true,
    });
    assert.deepEqual(syncNoticeTexts(desk.view().notices, getT()), [
      "Sync storage is full. Delete notes to sync new ones.",
      "A note is too large to sync.",
      "Update Sonolect to sync every note.",
    ]);
    assert.equal(storage.values.get(NEWER_SCHEMA_KEY), String(READER_VERSION));

    // A later start still says so, before any sync.
    const later = new SyncController({
      platform: fakePlatform(desk.native.invoke, w.clock),
      retentionDays: () => 0,
      storage,
    });
    await later.start();
    assert.equal(later.getView().notices.newerSchema, true);
  });

  it("puts every problem in plain words", () => {
    setLocale("en");
    const t = getT();
    assert.equal(
      syncProblemText({ kind: "unauthorized" }, t),
      "This sync key is not accepted by the server.",
    );
    assert.equal(
      syncProblemText({ kind: "deleted" }, t),
      "This sync was deleted.",
    );
    assert.equal(
      syncProblemText({ kind: "tooLarge" }, t),
      "A note is too large to sync.",
    );
    assert.equal(
      syncProblemText({ kind: "server" }, t),
      "Sync is unavailable right now.",
    );
    assert.equal(
      syncProblemText({ kind: "offline" }, t),
      "Offline. Notes will sync when you're back online.",
    );
    assert.equal(
      syncActionErrorText(new PairingError("invalid", "x"), t),
      "This is not a Sonolect sync code.",
    );
    assert.equal(
      syncActionErrorText(new PairingError("version", "x"), t),
      "Update Sonolect to use this code.",
    );
    for (const code of ["key", "length", "character"] as const)
      assert.equal(
        syncActionErrorText(new PairingError(code, "x"), t),
        "Check the code: it has 56 characters.",
      );
    setLocale("fr");
    try {
      const fr = getT();
      assert.equal(
        syncProblemText({ kind: "deleted" }, fr),
        "Cette synchronisation a été supprimée.",
      );
      assert.equal(
        syncProblemText(
          { kind: "device", detail: "The sync state could not be saved." },
          fr,
        ),
        fr("native.syncStateFailed"),
      );
      assert.notEqual(
        fr("native.syncStateFailed"),
        "The sync state could not be saved.",
      );
    } finally {
      setLocale("en");
    }
  });
});
