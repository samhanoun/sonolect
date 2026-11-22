import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  type HttpRequester,
  type HttpResponse,
  PairingError,
  READER_VERSION,
  type SyncEngineOptions,
  SyncError,
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
    // Plain text for the phone's scanner, not a link.
    assert.equal(pairing.payload, `SONOLECT SYNC 1 ${pairing.code}`);
    assert.equal(pairing.qr.size, 33);

    const typed = pairing.code.replaceAll("-", "");
    const wrong =
      typed.slice(0, 9) + (typed[9] === "7" ? "8" : "7") + typed.slice(10);
    const refused = await second.controller.join(wrong).catch((error) => error);
    assert.ok(refused instanceof PairingError);
    assert.equal(syncActionErrorText(refused, getT()), "A character is wrong.");
    assert.equal(second.view().phase, "off");
    assert.equal(second.native.key, null);

    // A link is not a code, the old pairing link included.
    const link = await second.controller
      .join(`sonolect://sync/join?v=1&k=${first.native.key}`)
      .catch((error) => error);
    assert.ok(link instanceof PairingError);
    assert.equal(
      syncActionErrorText(link, getT()),
      "This is not a Sonolect sync code.",
    );
    assert.equal(second.native.key, null);

    await second.controller.join(pairing.payload);
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

  it("turning off with the server copy kept still sends the deletes made here", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted just before turning off");
    first.native.record("Kept");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    // Deleted, and sync turned off before the next sync would have run.
    first.native.deleteByUser(gone);
    await first.controller.turnOff({ deleteServerCopy: false });
    assert.equal(first.view().phase, "off");
    assert.equal(first.native.deletes.size, 0);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), ["Kept"]);
  });

  it("“Delete all local data” with the server copy kept still sends the deletes made here", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted just before erasing");
    first.native.record("Kept elsewhere");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    first.native.deleteByUser(gone);
    await first.controller.forgetLocal();
    assert.equal(first.view().phase, "off");
    assert.equal(first.native.key, null);
    assert.equal(first.native.state.size, 0);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), ["Kept elsewhere"]);
  });

  it("keeps the deletes it could not send when turned off, and sends them on a rejoin of the vault", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted while offline");
    first.native.record("Kept");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    const code = (await second.controller.pairing())!.code;
    const vault = first.vaultId();
    first.native.deleteByUser(gone);
    // Offline: the last try fails, and sync turns off all the same.
    for (let i = 0; i < 3; i++)
      first.native.requestFailures.push({
        kind: "network",
        message: "The sync server could not be reached.",
      });
    await first.controller.turnOff({ deleteServerCopy: false });
    assert.equal(first.view().phase, "off");
    assert.equal(first.native.state.size, 0);
    assert.deepEqual([...first.native.deletes.keys()], [gone]);
    assert.equal(first.native.deletes.get(gone)?.vault, vault);
    first.native.requestFailures.length = 0;

    // Another vault does not take it.
    await first.controller.turnOn();
    await w.clock.advance(0);
    assert.deepEqual([...first.native.deletes.keys()], [gone]);
    await first.controller.turnOff({ deleteServerCopy: false });

    // Rejoining the vault sends it: the note goes from the other desktop
    // and does not come back here.
    await first.controller.join(code);
    await w.clock.advance(0);
    assert.equal(first.native.deletes.size, 0);
    assert.deepEqual(first.native.transcripts(), ["Kept"]);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), ["Kept"]);
  });

  it("stays on when the keychain cannot be read at launch, and keeps the deletes made here", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted before quitting");
    first.native.record("Kept");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    first.native.deleteByUser(gone);
    await first.controller.close();

    // The keychain is still locked when the app starts again.
    first.native.failNextKeychain =
      "The sync key could not be read or saved in the keychain.";
    const again = new SyncController({
      platform: fakePlatform(first.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    await again.start();
    assert.equal(again.getView().phase, "on");
    assert.equal(again.getView().problem?.kind, "device");
    // Turning on or joining would put another key over this one: not offered.
    await again.turnOn();
    await again.join((await second.controller.pairing())!.code);
    assert.equal(first.native.key, second.native.key);
    assert.deepEqual([...first.native.deletes.keys()], [gone]);

    // Once the keychain answers, the retry sends the delete.
    await w.clock.advance(5 * 60_000);
    assert.equal(again.getView().problem, undefined);
    assert.equal(first.native.deletes.size, 0);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), ["Kept"]);
  });

  it("can be turned off while the keychain cannot be read, keeping the deletes for the vault", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted before quitting");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    first.native.deleteByUser(gone);
    await first.controller.close();
    const vault = first.vaultId();
    first.native.failNextKeychain = "locked";
    const again = new SyncController({
      platform: fakePlatform(first.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    await again.start();
    first.native.failNextKeychain = "locked";
    await again.turnOff({ deleteServerCopy: false });
    assert.equal(again.getView().phase, "off");
    assert.equal(first.native.keyInUse, false);
    assert.deepEqual(first.native.deletes.get(gone)?.vault, vault);
  });

  it("a delete kept while the keychain could not be read stays deleted on a rejoin", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const gone = first.native.record("Deleted before quitting");
    first.native.record("Kept");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    const code = (await second.controller.pairing())!.code;
    const synced = first.native.captures.get(gone)!.hlc;
    first.native.deleteByUser(gone);
    await first.controller.close();
    // The keychain is locked at the next launch, and sync is turned off
    // with the server copy kept: the delete never reached an engine.
    first.native.failNextKeychain = "locked";
    const again = new SyncController({
      platform: fakePlatform(first.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    await again.start();
    first.native.failNextKeychain = "locked";
    await again.turnOff({ deleteServerCopy: false });
    assert.equal(again.getView().phase, "off");
    // Kept with the version this desktop last synced.
    assert.deepEqual(first.native.deletes.get(gone)?.synced?.hlc, synced);

    // Joining the vault again: the server's copy is the version deleted
    // here, not an edit made elsewhere, so no conflict copy brings it back.
    await again.join(code);
    await w.clock.advance(0);
    assert.equal(first.native.deletes.size, 0);
    assert.deepEqual(first.native.transcripts(), ["Kept"]);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.deepEqual(second.native.transcripts(), ["Kept"]);
  });

  it("refreshes the library after a run that wrote notes and then failed", async () => {
    const w = world();
    let failUploads = 0;
    const openEngine = (options: SyncEngineOptions) =>
      openSyncEngine({
        ...options,
        transport: {
          ...options.transport,
          createVault: () => options.transport.createVault(),
          changes: (since, limit) => options.transport.changes(since, limit),
          deleteVault: () => options.transport.deleteVault(),
          putRecords: (writes) => {
            if (failUploads > 0) {
              failUploads -= 1;
              return Promise.reject(new SyncError("network", "offline"));
            }
            return options.transport.putRecords(writes);
          },
        },
      });
    const first = await syncedDesktop(w);
    const second = await joinedDesktop(w, first, { openEngine });
    first.native.record("Made on the first desktop");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    // The second desktop has a note to upload too: the run pulls the first
    // desktop's note, then its upload fails.
    second.native.record("Made on the second desktop");
    failUploads = 1;
    const before = second.notesChanged();
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    assert.equal(second.view().problem?.kind, "offline");
    assert.deepEqual(second.native.transcripts(), [
      "Made on the first desktop",
      "Made on the second desktop",
    ]);
    assert.equal(second.notesChanged(), before + 1);
  });

  it("dates a delete when the user made it, so a later edit elsewhere still wins", async () => {
    const w = world();
    const first = await syncedDesktop(w);
    const id = first.native.record("Shared note");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    const second = await joinedDesktop(w, first);
    // Deleted here, and the app quits before the next sync.
    first.native.deleteByUser(id);
    await first.controller.close();
    // An hour later the other desktop edits the note.
    await w.clock.advance(60 * 60_000);
    second.native.edit(id, "Edited after the delete");
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    // A day later this desktop starts again: the edit is newer and wins.
    await w.clock.advance(DAY);
    const again = new SyncController({
      platform: fakePlatform(first.native.invoke, w.clock),
      retentionDays: () => 0,
    });
    await again.start();
    await w.clock.advance(0);
    second.controller.syncNow();
    await w.clock.advance(0);
    assert.equal(second.native.note(id)?.transcript, "Edited after the delete");
    assert.equal(first.native.note(id)?.transcript, "Edited after the delete");
  });

  it("sends no request while sync is off, nor for another vault", async () => {
    const w = world();
    const desk = await syncedDesktop(w);
    const ours = desk.vaultId();
    const other = deriveVaultKeys(new Uint8Array(32).fill(7)).vaultId;
    const request = (vault: string) =>
      desk.native.invoke("sync_request", {
        method: "GET",
        path: `/v1/vaults/${vault}/changes?since=0&limit=200`,
        body: null,
        bearer: "a".repeat(43),
      });
    await assert.rejects(request(other), { kind: "invalid" });
    await desk.controller.turnOff({ deleteServerCopy: false });
    await assert.rejects(request(ours), { kind: "invalid" });
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
    for (const code of ["length", "character"] as const)
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
