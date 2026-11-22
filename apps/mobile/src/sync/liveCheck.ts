/**
 * Two phones against a running sync server, from Node: the real note-store
 * adapter, key store, state store, fetch transport and controller, with
 * in-memory AsyncStorage and SecureStore. Not part of the app or the unit
 * tests (it needs a server). Run it from apps/mobile:
 *
 *   SONOLECT_SYNC_STORE=memory PORT=8713 node ../../services/sync-service/dist/index.js
 *   pnpm dlx tsx@4.19.2 src/sync/liveCheck.ts http://127.0.0.1:8713
 *
 * It checks that a note goes across, an edit comes back, a delete
 * propagates, and that turning sync off with the server copy deleted turns
 * the other phone's sync off with its notes kept. It prints no key, token
 * or note text.
 */
import assert from "node:assert/strict";

import {
  checkSyncServerUrl,
  createKeyValueStateStore,
  parsePairing,
} from "@sonolect/sync-core";

import { SYNC_STATE_PREFIX } from "../storageCore";
import { SyncController } from "./controller";
import { createSyncKeyStore } from "./keyStore";
import {
  MemorySecrets,
  TestPhone,
  makeTurn,
  testRandomBytes,
} from "./testSupport";
import { systemTimers } from "./timers";
import { createFetchRequester } from "./transport";

interface LivePhone {
  name: string;
  phone: TestPhone;
  secrets: MemorySecrets;
  sync: SyncController;
  requests: number;
}

async function livePhone(name: string, baseUrl: string): Promise<LivePhone> {
  const phone = new TestPhone();
  await phone.load();
  const secrets = new MemorySecrets();
  const live: LivePhone = {
    name,
    phone,
    secrets,
    requests: 0,
    sync: undefined as unknown as SyncController,
  };
  const request = createFetchRequester({
    baseUrl,
    fetch: (url, init) => {
      live.requests += 1;
      return fetch(url, init);
    },
    timers: systemTimers,
  });
  live.sync = new SyncController({
    request,
    keyStore: createSyncKeyStore(secrets, phone.kv),
    state: createKeyValueStateStore(phone.kv, SYNC_STATE_PREFIX),
    kept: phone.kv,
    notes: phone.notes,
    randomBytes: testRandomBytes,
    now: Date.now,
    timers: systemTimers,
    paused: () => null,
    retentionDays: () => 0,
  });
  await live.sync.start();
  return live;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until `done` holds, checking every 50 ms. */
async function until(what: string, done: () => boolean, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await delay(50);
  }
}

/** Waits for the next finished run of a phone (started by its own timers). */
async function nextRun(live: LivePhone, why: string): Promise<number> {
  const before = live.sync.view().lastSyncAt ?? 0;
  const started = Date.now();
  await until(
    `${live.name}: ${why}`,
    () =>
      !live.sync.view().syncing && (live.sync.view().lastSyncAt ?? 0) > before,
  );
  assert.equal(live.sync.view().problem, null, `${live.name}: ${why}`);
  return Date.now() - started;
}

/** The app comes to the foreground: the phone syncs now. */
async function foreground(live: LivePhone, why: string): Promise<void> {
  live.sync.setForeground(true);
  await nextRun(live, why);
}

const stamp =
  (live: LivePhone) => (previous?: Parameters<SyncController["stamp"]>[0]) =>
    live.sync.stamp(previous);

export async function runLiveCheck(rawUrl: string): Promise<string[]> {
  const check = checkSyncServerUrl(rawUrl, { allowLocalHttp: true });
  if (!check.ok) throw new Error(`not a sync server URL (${check.reason})`);
  const log: string[] = [];
  const a = await livePhone("phone A", check.url);
  const b = await livePhone("phone B", check.url);
  try {
    // Phone A has a note before sync is on; B has its own.
    const early = await a.phone.add(makeTurn({ rawText: "before sync" }), null);
    const own = await b.phone.add(makeTurn({ rawText: "b's own" }), null);

    await a.sync.turnOn();
    await nextRun(a, "first upload");
    const pairing = await a.sync.pairing();
    assert.ok(pairing, "phone A shows a code");
    assert.equal(pairing.groups.length, 14);
    log.push("phone A turned sync on and showed a 14-group code");

    // B joins with the text the QR code carries, as its scanner reads it.
    assert.equal(await b.sync.join(parsePairing(pairing.payload)), "joined");
    await nextRun(b, "join");
    assert.ok(b.phone.get(early.id), "A's early note reached B");
    await foreground(a, "pull B's own note");
    assert.ok(a.phone.get(own.id), "B's own note reached A");
    log.push("phone B joined: each phone has the other's note");

    // A note goes across: A dictates, its sync runs about 5 s later.
    const note = await a.phone.add(
      makeTurn({ rawText: "buy milk", refinedText: "Buy milk." }),
      stamp(a),
    );
    a.sync.noteChanged();
    const waited = await nextRun(a, "debounced upload");
    await foreground(b, "pull the new note");
    assert.equal(b.phone.get(note.id)?.refinedText, "Buy milk.");
    log.push(
      `a note went from A to B (A synced ${Math.round(waited / 100) / 10} s after the change)`,
    );

    // An edit comes back: B refines and pins it.
    await b.phone.edit(
      note.id,
      { refinedText: "Buy oat milk.", pinned: true },
      stamp(b),
    );
    b.sync.noteChanged();
    await nextRun(b, "upload the edit");
    await foreground(a, "pull the edit");
    assert.equal(a.phone.get(note.id)?.refinedText, "Buy oat milk.");
    assert.equal(a.phone.get(note.id)?.pinned, true);
    log.push("B's edit (refined text and pin) came back to A");

    // A delete propagates: A deletes the note (a user delete: a tombstone).
    await a.phone.delete([note.id], "everywhere", (tombstones) =>
      a.sync.recordDeletes(tombstones),
    );
    await nextRun(a, "upload the delete");
    await foreground(b, "pull the delete");
    assert.equal(b.phone.get(note.id), undefined, "the note is gone on B");
    assert.ok(b.phone.removedShown.includes(note.id));
    // Stored notes match what is shown, after a restart too.
    await b.phone.restart();
    assert.equal(b.phone.get(note.id), undefined, "and stays gone on B");
    assert.ok(b.phone.get(early.id) && b.phone.get(own.id));
    log.push("A's delete removed the note on B, and it stays removed");

    // Turning sync off on A, deleting the server copy: B turns sync off
    // on its next run and keeps its notes.
    await a.sync.turnOff(true);
    assert.equal(a.sync.view().status, "off");
    assert.equal(a.secrets.data.size, 0, "A forgot the key");
    b.sync.setForeground(true);
    await until(
      "B sees the deleted sync",
      () => b.sync.view().status === "off",
    );
    assert.equal(b.sync.view().problem, "deleted");
    assert.equal(b.secrets.data.size, 0, "B forgot the key");
    assert.ok(b.phone.get(early.id) && b.phone.get(own.id), "B kept its notes");
    log.push(
      'A turned sync off and deleted the server copy: B says "This sync was deleted.", forgot the key and kept its notes',
    );
    log.push(`requests: A ${a.requests}, B ${b.requests}`);
    return log;
  } finally {
    await a.sync.shutdown();
    await b.sync.shutdown();
  }
}

if (require.main === module) {
  const url = process.argv[2] ?? "http://127.0.0.1:8713";
  runLiveCheck(url).then(
    (lines) => {
      for (const line of lines) console.log(`ok - ${line}`);
    },
    (error: unknown) => {
      console.error(
        `not ok - ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    },
  );
}
