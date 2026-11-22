import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SyncError,
  createKeyValueStateStore,
  parsePairing,
  parsePairingCode,
} from "@sonolect/sync-core";
import { createMemoryVaultServer } from "@sonolect/sync-core/testing";

import {
  BACKOFF_BASE_MS,
  CHANGE_DELAY_MS,
  OFFLINE_DEVICE_ID,
  PERIODIC_MS,
  type SyncPause,
  SyncController,
  reportProblem,
  syncPauseFor,
} from "./controller";
import { SYNC_STATE_PREFIX } from "../storageCore";
import { SYNC_KEY_ITEM, createSyncKeyStore } from "./keyStore";
import {
  FakeClock,
  MemorySecrets,
  TestPhone,
  makeTurn,
  testRandomBytes,
} from "./testSupport";

const START = Date.parse("2026-11-20T12:00:00.000Z");

function world() {
  const clock = new FakeClock(START);
  const server = createMemoryVaultServer({ now: clock.now });
  /** One phone: its notes, its secure store and its controller. */
  const phone = async (
    options: { pause?: () => SyncPause | null; retentionDays?: number } = {},
  ) => {
    const notes = new TestPhone(clock.now);
    await notes.load();
    const secrets = new MemorySecrets();
    /** No network on this phone (or for its uploads only) while set. */
    const link = { offline: false, uploadsFail: false };
    const make = () =>
      new SyncController({
        request: (request) =>
          link.offline ||
          (link.uploadsFail && request.path.endsWith("/records"))
            ? Promise.reject(new TypeError("Network request failed"))
            : server.request(request),
        keyStore: createSyncKeyStore(secrets, notes.kv),
        state: createKeyValueStateStore(notes.kv, SYNC_STATE_PREFIX),
        kept: notes.kv,
        notes: notes.notes,
        randomBytes: testRandomBytes,
        now: clock.now,
        timers: clock.timersApi,
        random: () => 1,
        paused: options.pause ?? (() => (notes.writable ? null : "historyOff")),
        retentionDays: () => options.retentionDays ?? 0,
      });
    const device = { notes, secrets, link, sync: make(), make };
    return device;
  };
  return { clock, server, phone };
}

type Phone = Awaited<ReturnType<ReturnType<typeof world>["phone"]>>;

/** Adds a note the way the store does: stamped, then a change for sync. */
async function dictate(phone: Phone, text: string) {
  const turn = await phone.notes.add(
    makeTurn({ rawText: text, refinedText: text }),
    (previous) => phone.sync.stamp(previous),
  );
  phone.sync.noteChanged();
  return turn;
}

/** Joins phone `b` to `a`'s vault with the typed code. */
async function pair(a: Phone, b: Phone) {
  const pairing = await a.sync.pairing();
  assert.ok(pairing);
  return b.sync.join(parsePairingCode(pairing.groups.join(" ")));
}

const requests = (server: ReturnType<typeof world>["server"]) =>
  server.log.length;

describe("sync controller: turning on and joining", () => {
  it("stays off and silent without a key", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.start();
    await w.clock.advance(PERIODIC_MS * 3);
    assert.equal(a.sync.view().status, "off");
    assert.equal(requests(w.server), 0, "no request without a key");
  });

  it("turns on, uploads the notes here and shows the code", async () => {
    const w = world();
    const a = await w.phone();
    await dictate(a, "before sync");
    await a.sync.start();
    await a.sync.turnOn();
    assert.equal(a.sync.view().status, "on");
    await w.clock.advance(0);
    const view = a.sync.view();
    assert.equal(view.problem, null);
    assert.equal(view.lastSyncAt, START);
    const vault = w.server.log[0];
    assert.equal(vault?.path, "/v1/vaults");
    const pairing = await a.sync.pairing();
    assert.ok(pairing);
    assert.equal(pairing.groups.length, 14);
    // The QR code holds plain text for Sonolect's scanner, not a link.
    assert.equal(
      pairing.payload,
      `SONOLECT SYNC 1 ${pairing.groups.join("-")}`,
    );
    assert.deepEqual(
      parsePairing(pairing.payload),
      parsePairingCode(pairing.groups.join("")),
    );
    assert.equal(w.server.records(vaultIdOf(a)).length, 1);
  });

  it("joins with a code: both phones end up with every note", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await dictate(a, "from A");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await dictate(b, "from B");
    assert.equal(await pair(a, b), "joined");
    await w.clock.advance(0);
    assert.deepEqual(b.notes.history.map((turn) => turn.rawText).sort(), [
      "from A",
      "from B",
    ]);
    await w.clock.advance(PERIODIC_MS);
    assert.deepEqual(a.notes.history.map((turn) => turn.rawText).sort(), [
      "from A",
      "from B",
    ]);
    assert.equal(await pair(a, b), "alreadyJoined");
  });

  it("does not join a second vault while one is on", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await a.sync.turnOn();
    const pairing = await a.sync.pairing();
    assert.ok(pairing);
    const root = parsePairing(pairing.payload);
    await b.sync.turnOn();
    const own = vaultIdOf(b);
    assert.equal(await pair(a, b), "otherVaultOn");
    assert.equal(vaultIdOf(b), own, "b keeps its own vault");
    assert.equal(await a.sync.join(root), "alreadyJoined");
  });

  it("resumes after a restart with the saved key and state", async () => {
    const w = world();
    const a = await w.phone();
    await dictate(a, "kept");
    await a.sync.turnOn();
    await w.clock.advance(0);
    const before = w.server.head(vaultIdOf(a));
    await a.sync.shutdown();
    await a.notes.restart();
    a.sync = a.make();
    await a.sync.start();
    assert.equal(a.sync.view().status, "on");
    assert.equal(a.sync.view().lastSyncAt, START);
    await w.clock.advance(0);
    assert.equal(w.server.head(vaultIdOf(a)), before, "nothing uploaded again");
  });
});

/** The vault id of a phone that has sync on. */
function vaultIdOf(phone: Phone): string {
  const keyed = phone.notes.kv.data.get("sonolect.mobile.sync.keyMarker");
  assert.ok(keyed);
  return keyed;
}

describe("sync controller: when it syncs", () => {
  it("syncs about 5 s after a local change", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    await dictate(a, "new note");
    await w.clock.advance(CHANGE_DELAY_MS - 1);
    assert.equal(w.server.records(vaultIdOf(a)).length, 0);
    await w.clock.advance(1);
    assert.equal(w.server.records(vaultIdOf(a)).length, 1);
  });

  it("pulls every 2 minutes in the foreground and on coming back", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await dictate(b, "from B");
    await w.clock.advance(CHANGE_DELAY_MS);
    a.sync.setForeground(false);
    await w.clock.advance(PERIODIC_MS * 2);
    assert.equal(a.notes.history.length, 0, "nothing runs in the background");
    a.sync.setForeground(true);
    await w.clock.advance(0);
    assert.equal(a.notes.history.length, 1);
    await dictate(b, "later from B");
    await w.clock.advance(CHANGE_DELAY_MS);
    await w.clock.advance(PERIODIC_MS);
    assert.equal(a.notes.history.length, 2);
  });

  it("sends a change made just before the app leaves the foreground", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    await dictate(a, "quick note");
    a.sync.setForeground(false);
    await w.clock.advance(0);
    assert.equal(w.server.records(vaultIdOf(a)).length, 1);
  });

  it("pauses while history is off, and resumes when it is back", async () => {
    const w = world();
    const a = await w.phone();
    await dictate(a, "note");
    a.notes.writable = false;
    await a.sync.turnOn();
    await w.clock.advance(0);
    assert.equal(a.sync.view().paused, "historyOff");
    assert.equal(w.server.log.length, 0);
    a.notes.writable = true;
    a.sync.refresh();
    assert.equal(a.sync.view().paused, null);
    await w.clock.advance(0);
    assert.equal(w.server.records(vaultIdOf(a)).length, 1);
  });

  it("stays paused while the settings could not be read", () => {
    const ready = { keepsHistory: true, notesReady: true };
    assert.equal(syncPauseFor({ ...ready, settingsUnread: false }), null);
    // Even with history turned on meanwhile, until settings are saved: the
    // stored choice is unknown.
    assert.equal(syncPauseFor({ ...ready, settingsUnread: true }), "settings");
    assert.equal(
      syncPauseFor({
        settingsUnread: true,
        keepsHistory: false,
        notesReady: false,
      }),
      "settings",
    );
    assert.equal(
      syncPauseFor({ ...ready, settingsUnread: false, keepsHistory: false }),
      "historyOff",
    );
    assert.equal(
      syncPauseFor({ ...ready, settingsUnread: false, notesReady: false }),
      "storage",
    );
  });
});

describe("sync controller: failures", () => {
  it("backs off on a server error, then clears the message", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    w.server.failNext(2, 503);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, "server");
    assert.deepEqual(w.clock.pending(), [BACKOFF_BASE_MS]);
    await w.clock.advance(BACKOFF_BASE_MS);
    assert.equal(a.sync.view().problem, "server");
    assert.deepEqual(w.clock.pending(), [BACKOFF_BASE_MS * 2], "doubles");
    // A local change does not cut the wait short.
    await dictate(a, "while failing");
    assert.deepEqual(w.clock.pending(), [BACKOFF_BASE_MS * 2]);
    await w.clock.advance(BACKOFF_BASE_MS * 2);
    assert.equal(a.sync.view().problem, null);
    assert.equal(w.server.records(vaultIdOf(a)).length, 1);
    assert.deepEqual(w.clock.pending(), [PERIODIC_MS]);
  });

  it("waits as long as the server asks after a rate limit, silently", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    w.server.failNext(1, 429);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, null);
    // No Retry-After from the test server: the transport's default minute.
    assert.deepEqual(w.clock.pending(), [60_000]);
    a.sync.setForeground(true);
    assert.deepEqual(w.clock.pending(), [60_000], "the foreground waits too");
  });

  it("says offline in plain words and tries again in the foreground", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    w.server.failNext(3);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, "network");
    a.sync.setForeground(false);
    assert.deepEqual(w.clock.pending(), []);
    a.sync.setForeground(true);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, "network");
    w.server.failNext(0);
    a.sync.setForeground(true);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, null);
  });

  it("stops when the server refuses the key", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    w.server.failNext(1, 409);
    await w.clock.advance(0);
    assert.equal(a.sync.view().problem, "unauthorized");
    assert.equal(a.sync.view().status, "on");
    assert.deepEqual(w.clock.pending(), []);
    const asked = w.server.log.length;
    await dictate(a, "not sent");
    a.sync.setForeground(true);
    await w.clock.advance(PERIODIC_MS * 2);
    assert.equal(w.server.log.length, asked, "no more requests");
    await a.sync.turnOff(false);
    assert.equal(a.sync.view().status, "off");
  });

  it("turns sync off and keeps the notes when another phone deleted the vault", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await dictate(a, "shared");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.sync.turnOff(true);
    assert.equal(a.sync.view().status, "off");
    assert.equal(a.secrets.data.has(SYNC_KEY_ITEM), false);
    await dictate(b, "after the delete");
    await w.clock.advance(CHANGE_DELAY_MS);
    assert.equal(b.sync.view().status, "off");
    assert.equal(b.sync.view().problem, "deleted");
    assert.equal(b.secrets.data.has(SYNC_KEY_ITEM), false);
    assert.equal(b.notes.history.length, 2, "the notes stay");
    assert.equal(a.notes.history.length, 1);
    assert.deepEqual(w.clock.pending(), []);
  });

  it("keeps sync on when the server copy cannot be deleted", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    w.server.failNext(1);
    await assert.rejects(
      a.sync.turnOff(true),
      (error) => error instanceof SyncError && error.kind === "network",
    );
    assert.equal(a.sync.view().status, "on");
    assert.equal(a.sync.view().busy, false);
    assert.ok(await a.sync.pairing());
  });

  it("turns off and keeps the server copy for the other phones", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await dictate(a, "shared");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    const vaultId = vaultIdOf(a);
    await a.sync.turnOff(false);
    assert.equal(a.sync.view().status, "off");
    await dictate(b, "still syncing");
    await w.clock.advance(CHANGE_DELAY_MS);
    assert.equal(b.sync.view().problem, null);
    assert.equal(w.server.records(vaultId).length, 2);
    assert.equal(
      [...a.notes.kv.data.keys()].some((key) =>
        key.startsWith(SYNC_STATE_PREFIX),
      ),
      false,
      "the sync state is forgotten",
    );
  });
});

describe("sync controller: local changes", () => {
  it("stamps with a local clock while off, and the vault's clock while on", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.start();
    assert.equal(a.sync.stamp().d, OFFLINE_DEVICE_ID);
    await a.sync.recordDeletes([{ id: "x" }]); // nothing to record while off
    await a.sync.turnOn();
    const stamp = a.sync.stamp();
    assert.notEqual(stamp.d, OFFLINE_DEVICE_ID);
    const previous = { t: START + 3_600_000, c: 4, d: "zzz" };
    const later = a.sync.stamp(previous);
    assert.ok(later.t > previous.t || later.c > previous.c);
  });

  it("sends a user delete to the other phones", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const note = await dictate(a, "to delete");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    assert.equal(b.notes.history.length, 1);
    await a.sync.recordDeletes([{ id: note.id, hlc: note.hlc }]);
    await a.notes.remove(note.id);
    await w.clock.advance(CHANGE_DELAY_MS);
    await w.clock.advance(PERIODIC_MS);
    assert.equal(b.notes.history.length, 0);
  });

  it("downloads the notes again after they were cleared on this phone only", async () => {
    const w = world();
    const a = await w.phone();
    await dictate(a, "one");
    await dictate(a, "two");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await a.notes.wipe();
    await a.sync.notesClearedLocally();
    await w.clock.advance(0);
    assert.deepEqual(a.notes.history.map((turn) => turn.rawText).sort(), [
      "one",
      "two",
    ]);
    assert.equal(
      w.server.records(vaultIdOf(a)).filter((record) => record.deleted).length,
      0,
      "no tombstones",
    );
  });

  it("a delete not uploaded yet still reaches the others after the notes are cleared here", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "delete me everywhere");
    await dictate(a, "keep me");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    // Offline, the phone deletes a note, then history is turned off and on.
    a.link.offline = true;
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    await w.clock.advance(CHANGE_DELAY_MS);
    await a.notes.wipe();
    await a.sync.notesClearedLocally();
    a.link.offline = false;
    a.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      a.notes.history.map((turn) => turn.rawText),
      ["keep me"],
      "the other notes download again, not the deleted one",
    );
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["keep me"],
    );
  });

  it("turning off with the server copy kept still sends the deletes made here", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "deleted just before turning off");
    await dictate(a, "kept");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    await a.sync.turnOff(false);
    assert.equal(a.sync.view().status, "off");
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
  });

  it("keeps the deletes it could not send when turned off, and sends them on a rejoin of the vault", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "deleted while offline");
    await dictate(a, "kept");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    const code = await b.sync.pairing();
    assert.ok(code);
    a.link.offline = true;
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    await a.sync.turnOff(false);
    assert.equal(a.sync.view().status, "off");
    a.link.offline = false;
    // Another vault does not take them.
    await a.sync.turnOn();
    await w.clock.advance(0);
    await a.sync.turnOff(false);
    // Rejoining the vault sends them, and the note does not come back.
    await a.sync.join(parsePairingCode(code.groups.join("")));
    await w.clock.advance(0);
    assert.deepEqual(
      a.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
  });

  it("a delete made at launch, before the vault is open, still reaches the others", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "deleted at launch");
    await dictate(a, "kept");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.sync.shutdown();
    // The app starts again; the note is deleted before sync has started.
    await a.notes.restart();
    a.sync = a.make();
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    await a.sync.start();
    await w.clock.advance(0);
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
    assert.deepEqual(
      a.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
  });

  it("a delete made while the key cannot be read stays deleted after the notes are cleared here", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "deleted while the key was locked");
    await dictate(a, "kept");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.sync.shutdown();
    // The app starts again and the key cannot be read: the vault stays
    // closed, and the delete is kept for it.
    await a.notes.restart();
    a.secrets.fail = (op) => op === "get";
    a.sync = a.make();
    await a.sync.start();
    assert.equal(a.sync.view().status, "loading");
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    // History turned off and on: the notes and the sync state go.
    await a.notes.wipe();
    await a.sync.notesClearedLocally();
    // Once the key can be read, the notes download again, but not the
    // deleted one, not even as a conflict copy.
    a.secrets.fail = () => false;
    await a.sync.start();
    await w.clock.advance(0);
    assert.equal(a.sync.view().status, "on");
    assert.deepEqual(
      a.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["kept"],
    );
  });

  it("erase all keeping the server copy still sends the deletes made here", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    const gone = await dictate(a, "deleted just before erasing");
    await dictate(a, "kept elsewhere");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.notes.delete([gone.id], "everywhere", (t) =>
      a.sync.recordDeletes(t),
    );
    await a.sync.eraseAll(false);
    assert.equal(a.sync.view().status, "off");
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.deepEqual(
      b.notes.history.map((turn) => turn.rawText),
      ["kept elsewhere"],
    );
  });

  it("shows the notes a run wrote even when the run then failed", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await dictate(a, "made on the first phone");
    await w.clock.advance(CHANGE_DELAY_MS);
    // The second phone pulls it, then its own upload fails.
    await dictate(b, "made on the second phone");
    b.link.uploadsFail = true;
    await w.clock.advance(CHANGE_DELAY_MS);
    assert.equal(b.sync.view().problem, "network");
    assert.deepEqual(b.notes.history.map((turn) => turn.rawText).sort(), [
      "made on the first phone",
      "made on the second phone",
    ]);
  });

  it("erase all deletes the server copy when asked and forgets the key and state", async () => {
    const w = world();
    const a = await w.phone();
    const b = await w.phone();
    await dictate(a, "shared");
    await a.sync.turnOn();
    await w.clock.advance(0);
    await pair(a, b);
    await w.clock.advance(0);
    await a.sync.eraseAll(true);
    assert.equal(a.sync.view().status, "off");
    assert.equal(a.secrets.data.size, 0);
    assert.equal(
      [...a.notes.kv.data.keys()].some((key) =>
        key.startsWith(SYNC_STATE_PREFIX),
      ),
      false,
    );
    b.sync.setForeground(true);
    await w.clock.advance(0);
    assert.equal(b.sync.view().problem, "deleted");
  });

  it("erase all erases nothing when the server copy cannot be deleted", async () => {
    const w = world();
    const a = await w.phone();
    await a.sync.turnOn();
    await w.clock.advance(0);
    w.server.failNext(1, 503);
    await assert.rejects(a.sync.eraseAll(true));
    assert.equal(a.sync.view().status, "on");
    assert.ok(a.secrets.data.has(SYNC_KEY_ITEM));
  });
});

describe("sync controller: messages from a report", () => {
  const empty = {
    pulled: 0,
    pushed: 0,
    conflictCopies: [],
    refused: 0,
    unreadable: 0,
    newerSchema: 0,
    tooLarge: [],
    skippedIds: [],
    invalid: [],
    skippedExpired: 0,
    quotaExceeded: false,
    deferred: false,
    full: null,
    vaultCreated: false,
  };
  it("names a full vault first, then newer notes, then a note too large", () => {
    assert.equal(reportProblem(empty), null);
    assert.equal(reportProblem({ ...empty, tooLarge: ["a"] }), "tooLarge");
    assert.equal(
      reportProblem({ ...empty, tooLarge: ["a"], newerSchema: 1 }),
      "newerSchema",
    );
    assert.equal(
      reportProblem({ ...empty, newerSchema: 1, quotaExceeded: true }),
      "quotaExceeded",
    );
  });
});
