/**
 * The desktop app and the phone app sync with each other through the real
 * sync service: each runs its own sync code (see world.ts), so a field one
 * app maps differently from the other, or drops, shows up here.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  NOTE_ID_PATTERN,
  base64urlEncode,
  deriveVaultKeys,
  noteFingerprint,
  parsePairing,
  syncNote,
} from "@sonolect/sync-core";

import {
  type TranscriptSegment,
  segmentsFromCapture,
  segmentsToSave,
  segmentsToText,
} from "../../../apps/desktop/src/segmentEditor";
import { createDesktopNoteStore } from "../../../apps/desktop/src/sync/desktopNotes";
import { LOCAL_CHANGE_DELAY_MS } from "../../../apps/desktop/src/sync/syncController";
import { exportTranscript } from "../../../apps/desktop/src/transcriptExport";
import type { NoteSegment } from "../../../apps/mobile/src/domain";
import { SYNC_COMPANION_PREFIX } from "../../../apps/mobile/src/storageCore";
import { CHANGE_DELAY_MS } from "../../../apps/mobile/src/sync/controller";
import { SYNC_KEY_ITEM } from "../../../apps/mobile/src/sync/keyStore";
import { readScannedCode } from "../../../apps/mobile/src/sync/pairingInput";
import { subtitleCues, toSrt, toVtt } from "../../../apps/mobile/src/subtitles";
import {
  type Desktop,
  type Phone,
  type Server,
  SharedClock,
  startDesktop,
  startFutureClient,
  startPhone,
  startServer,
} from "./world";

const START = Date.parse("2026-11-20T09:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

async function world(limits?: Parameters<typeof startServer>[1]) {
  const clock = new SharedClock(START);
  const server = await startServer(clock, limits);
  cleanups.push(() => server.close());
  const desktop = () => {
    const desk = startDesktop(clock, server);
    cleanups.push(() => desk.close());
    return desk;
  };
  const phone = async (options?: { retentionDays?: number }) => {
    const device = await startPhone(clock, server, options);
    cleanups.push(() => device.close());
    return device;
  };
  return { clock, server, desktop, phone };
}

type World = Awaited<ReturnType<typeof world>>;

/** The desktop turns sync on: a new vault, and its first sync. */
async function turnOnDesktop(w: World, desk: Desktop) {
  await desk.controller.start();
  assert.equal(desk.view().available, true, "this build has a sync server");
  await desk.controller.turnOn();
  await w.clock.advance(0);
  await desk.controller.idle();
  assert.equal(desk.view().phase, "on");
  assert.equal(desk.view().problem, undefined);
}

/** The phone turns sync on: a new vault, and its first sync. */
async function turnOnPhone(w: World, phone: Phone) {
  await phone.controller.start();
  await phone.controller.turnOn();
  await w.clock.advance(0);
  assert.equal(phone.view().status, "on");
  assert.equal(phone.view().problem, null);
}

/**
 * The phone joins the desktop's vault, as Settings does: with the typed
 * code, or with the text of the desktop's QR code, read the way the
 * phone's scanner reads it.
 */
async function phoneJoinsDesktop(
  w: World,
  desk: Desktop,
  phone: Phone,
  how: "typed" | "scanned" = "typed",
) {
  const pairing = await desk.controller.pairing();
  assert.ok(pairing, "the desktop shows its code");
  await phone.controller.start();
  let root: Uint8Array;
  if (how === "typed") {
    root = parsePairing(pairing.groups.join(" "));
  } else {
    const scanned = readScannedCode(pairing.payload);
    if (scanned.kind !== "confirm")
      assert.fail(`the scanner refused the QR text: ${scanned.kind}`);
    root = scanned.root;
  }
  assert.equal(await phone.controller.join(root), "joined");
  await w.clock.advance(0);
  assert.equal(phone.view().status, "on");
  assert.equal(phone.view().problem, null);
}

/** The desktop joins the phone's vault with the text of its QR code, pasted. */
async function desktopJoinsPhone(w: World, phone: Phone, desk: Desktop) {
  const pairing = await phone.controller.pairing();
  assert.ok(pairing, "the phone shows its code");
  await desk.controller.start();
  await desk.controller.join(pairing.payload);
  await w.clock.advance(0);
  await desk.controller.idle();
  assert.equal(desk.view().phase, "on");
  assert.equal(desk.view().problem, undefined);
}

/** A desktop and a phone on one vault, the desktop's, both synced. */
async function paired(w: World) {
  const desk = w.desktop();
  const phone = await w.phone();
  await turnOnDesktop(w, desk);
  await phoneJoinsDesktop(w, desk, phone);
  return { desk, phone };
}

/** What the desktop's sync adapter gives the engine for a note. */
async function desktopNote(desk: Desktop, id: string) {
  return (await createDesktopNoteStore(desk.native.invoke).read(id))?.note;
}

/** The phone's notes with this conflict origin. */
const phoneCopiesOf = (phone: Phone, id: string) =>
  phone.notes.history.filter((turn) => turn.conflictOf === id);

/**
 * The studio opens a note of the library (appStore's openCapture), lets
 * `change` edit its segments, and saves it back (StudioWorkbench's
 * update_local_capture, with segmentsToSave): returns the transcript it
 * sent.
 */
function studioSave(
  desk: Desktop,
  id: string,
  change: (segments: TranscriptSegment[]) => TranscriptSegment[],
) {
  const capture = desk.capture(id);
  assert.ok(capture, "the note is in the desktop's library");
  const segments = change(
    segmentsFromCapture({
      id,
      durationMs: capture.durationMs ?? 0,
      transcript: capture.transcript ?? null,
      segments: capture.segments ?? null,
    }),
  );
  const transcript = segmentsToText(segments);
  desk.native.edit(id, transcript, segmentsToSave(segments));
  return transcript;
}

const desktopCopiesOf = (desk: Desktop, id: string) =>
  [...desk.native.captures.values()].filter(
    (capture) => capture.conflictOf === id,
  );

/**
 * The server and its log never saw a note's text, the root key, the
 * pairing code, the encryption keys or (in the log) the bearer token.
 */
function assertServerBlind(
  server: Server,
  root: Uint8Array,
  texts: readonly string[],
) {
  const keys = deriveVaultKeys(root);
  const traffic = server.exchanges
    .map((exchange) =>
      [
        exchange.method,
        exchange.path,
        JSON.stringify(exchange.headers),
        exchange.body,
        exchange.answer,
      ].join("\n"),
    )
    .join("\n");
  const log = server.logs.join("\n");
  // The traffic is mostly base64url ciphertext, so a short word made of its
  // letters (such as "Ana") turns up in it by chance in some runs. A text
  // checked here is long enough, or holds a character base64url never uses.
  for (const text of texts)
    assert.ok(
      text.length >= 6 || /[^A-Za-z0-9_-]/.test(text),
      `"${text}" is too short to check: ciphertext may hold it by chance`,
    );
  assert.ok(server.exchanges.length > 0, "the devices talked to the server");
  assert.ok(server.logs.length > 0, "the server logged its requests");
  for (const text of texts) {
    assert.ok(!traffic.includes(text), `no request or answer holds "${text}"`);
    assert.ok(!log.includes(text), `the log never holds "${text}"`);
  }
  for (const [what, secret] of [
    ["root key", base64urlEncode(root)],
    ["encryption key", base64urlEncode(keys.encKey)],
    ["id key", base64urlEncode(keys.idKey)],
  ] as const) {
    assert.ok(!traffic.includes(secret), `the ${what} never leaves a device`);
    assert.ok(!log.includes(secret), `the ${what} is not in the log`);
  }
  assert.ok(!log.includes(keys.authToken), "the log has no bearer token");
  assert.ok(!/authorization/i.test(log), "the log has no Authorization");
  for (const exchange of server.exchanges)
    assert.ok(
      !log.includes(exchange.body) || exchange.body === "",
      "the log has no request body",
    );
  assert.deepEqual(
    server.exchanges.filter((exchange) => exchange.status >= 400),
    [],
    "no request was refused",
  );
}

describe("desktop and phone sync through the sync service", () => {
  it("a phone with notes joins a desktop's vault: both end with every note", async () => {
    const w = await world();
    const desk = w.desktop();
    const phone = await w.phone();
    const deskId = desk.native.record("Desk note from before sync.");
    await phone.dictate("Phone note from before sync.");
    await w.clock.advance(1_000);

    await turnOnDesktop(w, desk);
    assert.equal(
      w.server.exchanges.filter(
        (exchange) =>
          exchange.method === "POST" &&
          exchange.path === "/v1/vaults" &&
          exchange.status === 201,
      ).length,
      1,
      "the desktop created the vault",
    );
    await phoneJoinsDesktop(w, desk, phone);
    assert.deepEqual(
      phone.notes.history.map((turn) => turn.rawText).sort(),
      ["Desk note from before sync.", "Phone note from before sync."],
      "the phone has both notes",
    );

    await desk.sync();
    assert.deepEqual(desk.native.transcripts(), [
      "Desk note from before sync.",
      "Phone note from before sync.",
    ]);
    const fromPhone = [...desk.native.captures.values()].find(
      (capture) => capture.id !== deskId,
    )!;
    assert.equal(fromPhone.origin, "mobile");
    assert.equal(fromPhone.hasAudio, false, "notes come without audio");
    assert.equal(desk.capture(deskId)?.hasAudio, true, "the desktop keeps its");
    assert.equal(phone.turn(deskId)?.source, "remote");
    assert.ok(desk.notesChanged() > 0, "the desktop library was refreshed");

    // Nothing more to do: another round sends no note again.
    const before = w.server.exchanges.length;
    await desk.sync();
    await phone.sync();
    const writes = w.server.exchanges
      .slice(before)
      .filter((exchange) => exchange.path.endsWith("/records"));
    assert.deepEqual(writes, [], "nothing is uploaded twice");

    assertServerBlind(w.server, desk.root(), [
      "Desk note from before sync",
      "Phone note from before sync",
    ]);
  });

  it("a phone joins a desktop's vault by scanning its QR code", async () => {
    const w = await world();
    const desk = w.desktop();
    const phone = await w.phone();
    desk.native.record("Desk note.");
    await phone.dictate("Phone note.");
    await turnOnDesktop(w, desk);

    await phoneJoinsDesktop(w, desk, phone, "scanned");
    assert.equal(
      base64urlEncode(
        parsePairing((await phone.controller.pairing())!.payload),
      ),
      base64urlEncode(desk.root()),
      "one vault, one key",
    );
    await desk.sync();
    assert.deepEqual(desk.native.transcripts(), ["Desk note.", "Phone note."]);
    assert.deepEqual(phone.notes.history.map((turn) => turn.rawText).sort(), [
      "Desk note.",
      "Phone note.",
    ]);
  });

  it("a desktop with notes joins a phone's vault by its QR text", async () => {
    const w = await world();
    const phone = await w.phone();
    const desk = w.desktop();
    await phone.dictate("Phone first.");
    await turnOnPhone(w, phone);
    desk.native.record("Desktop first.");

    await desktopJoinsPhone(w, phone, desk);
    assert.deepEqual(desk.native.transcripts(), [
      "Desktop first.",
      "Phone first.",
    ]);
    await phone.sync();
    assert.deepEqual(phone.notes.history.map((turn) => turn.rawText).sort(), [
      "Desktop first.",
      "Phone first.",
    ]);
    assert.equal(
      base64urlEncode(desk.root()),
      base64urlEncode(
        parsePairing((await phone.controller.pairing())!.payload),
      ),
      "one vault, one key",
    );
  });

  it("a phone back after two months finishes its full pass under the rate limit", async () => {
    // Two records a page and four requests a minute per vault: a full pass
    // over nine notes needs five pages, so the limit stops it part way.
    const w = await world({ maxPageRecords: 2, vaultRequestsPerMinute: 4 });
    const { desk, phone } = await paired(w);
    const deskTexts = Array.from(
      { length: 9 },
      (_, index) => `Desktop note number ${index + 1}.`,
    );
    for (const text of deskTexts) desk.native.record(text);
    await desk.sync();
    await phone.sync();
    // Each device reads the notes in pages, a minute at a time.
    await w.clock.advance(5 * 60_000);
    assert.deepEqual(
      phone.notes.history.map((turn) => turn.rawText).sort(),
      [...deskTexts].sort(),
      "the phone has the desktop's notes",
    );

    // The desktop is closed, and the phone is offline for two months.
    await desk.close();
    phone.network.offline = true;
    await phone.dictate("Phone note written while away.");
    await w.clock.advance(60_000);
    w.clock.time += 61 * DAY;
    phone.network.offline = false;

    const back = w.server.exchanges.length;
    await phone.sync();
    const first = w.server.exchanges.slice(back);
    assert.ok(
      first.some((exchange) => /\/changes\?since=0&/.test(exchange.path)),
      "the phone starts a full pass",
    );
    const limited = first.findIndex((exchange) => exchange.status === 429);
    assert.ok(limited >= 0, "the rate limit stops it part way");

    // It tries again after Retry-After, where it stopped, then uploads.
    await w.clock.advance(61_000);
    const after = w.server.exchanges.slice(back + limited + 1);
    assert.deepEqual(
      after.filter((exchange) => /\/changes\?since=0&/.test(exchange.path)),
      [],
      "the pass does not start over",
    );
    assert.ok(
      after.some(
        (exchange) =>
          exchange.method === "POST" &&
          exchange.path.endsWith("/records") &&
          exchange.status === 200,
      ),
      "the phone uploaded its note",
    );
    assert.equal(phone.view().problem, null);
    assert.deepEqual(
      phone.notes.history.map((turn) => turn.rawText).sort(),
      [...deskTexts, "Phone note written while away."].sort(),
      "the phone kept every note",
    );
  });

  it("a desktop capture reaches the phone with every field, and the phone's edit, refine and pin come back", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);

    const id = desk.native.record("Call the bakery about the order.", {
      durationMs: 4_200,
      language: "fr-FR",
      title: "Bakery",
      segments: [
        {
          startMs: 0,
          endMs: 1_900,
          text: "Call the bakery",
          speaker: "Ana Lindqvist",
        },
        {
          startMs: 1_900,
          endMs: 4_200,
          text: "about the order.",
          speaker: "Ben",
        },
      ],
    });
    assert.match(id, NOTE_ID_PATTERN);
    const uploadsBefore = w.server.exchanges.filter((exchange) =>
      exchange.path.endsWith("/records"),
    ).length;
    // The desktop uploads it by itself, once the change has settled.
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS - 1);
    assert.equal(
      w.server.exchanges.filter((exchange) =>
        exchange.path.endsWith("/records"),
      ).length,
      uploadsBefore,
      "not before the debounce",
    );
    await w.clock.advance(1);
    await desk.controller.idle();
    assert.equal(desk.view().problem, undefined);

    await phone.sync();
    const turn = phone.turn(id);
    assert.ok(turn, "the capture is on the phone");
    assert.equal(turn.rawText, "Call the bakery about the order.");
    assert.equal(turn.refinedText, turn.rawText);
    assert.equal(turn.language, "fr-FR");
    assert.equal(turn.durationMs, 4_200);
    assert.equal(turn.createdAt, new Date(START).toISOString());
    assert.equal(turn.mode, "dictate");
    assert.equal(turn.source, "remote");
    assert.equal(turn.pinned, undefined);
    assert.ok(turn.hlc, "with its sync version");
    // What the phone would send back is what the desktop sent: the title,
    // the segments and their speakers, the origin, the dates.
    const sent = await desktopNote(desk, id);
    assert.deepEqual(await phone.syncedNote(id), sent);
    assert.deepEqual(sent, {
      createdAt: new Date(START).toISOString(),
      rawText: "Call the bakery about the order.",
      title: "Bakery",
      language: "fr-FR",
      durationMs: 4_200,
      origin: "desktop",
      segments: [
        {
          startMs: 0,
          endMs: 1_900,
          text: "Call the bakery",
          speaker: "Ana Lindqvist",
        },
        {
          startMs: 1_900,
          endMs: 4_200,
          text: "about the order.",
          speaker: "Ben",
        },
      ],
    });

    // An edit on the phone goes out by itself after its debounce.
    await w.clock.advance(10_000);
    await phone.change(id, {
      rawText: "Call the bakery about Saturday's order.",
    });
    await w.clock.advance(CHANGE_DELAY_MS);
    assert.equal(phone.view().problem, null);
    await desk.sync();
    let capture = desk.capture(id)!;
    assert.equal(capture.transcript, "Call the bakery about Saturday's order.");
    assert.equal(
      capture.title,
      "Bakery",
      "the title the phone cannot show stays",
    );
    assert.deepEqual(
      capture.segments.map((segment) => segment.speaker),
      ["Ana Lindqvist", "Ben"],
      "the segments the phone cannot show stay",
    );
    assert.equal(capture.hasAudio, true, "the desktop keeps its recording");
    assert.equal(capture.language, "fr-FR");

    // A refine and a pin.
    await w.clock.advance(10_000);
    await phone.change(id, {
      refinedText: "Call the bakery about Saturday's order, please.",
      mode: "rewrite",
    });
    await w.clock.advance(1_000);
    await phone.change(id, { pinned: true });
    await phone.sync();
    await desk.sync();
    capture = desk.capture(id)!;
    assert.equal(
      capture.refinedText,
      "Call the bakery about Saturday's order, please.",
    );
    assert.equal(capture.mode, "rewrite");
    assert.equal(capture.pinned, true);
    assert.equal(capture.transcript, "Call the bakery about Saturday's order.");
    assert.deepEqual(await desktopNote(desk, id), await phone.syncedNote(id));
    // The phone's changes were stamped after the desktop's version.
    assert.ok(capture.hlc && turn.hlc && capture.hlc.t > turn.hlc.t);

    // Unpinning on the phone comes back too.
    await phone.change(id, { pinned: false });
    await phone.sync();
    await desk.sync();
    assert.notEqual(desk.capture(id)!.pinned, true);

    assertServerBlind(w.server, desk.root(), [
      "Call the bakery",
      "Saturday",
      "Bakery",
      "Ana Lindqvist",
    ]);
  });

  it("a desktop edit of a cleaned-up phone dictation is what the phone shows", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const { id } = await phone.dictate("um so buy milk", {
      refinedText: "Buy milk.",
    });
    await phone.sync();
    await desk.sync();
    assert.equal(desk.capture(id)?.transcript, "um so buy milk");
    assert.equal(desk.capture(id)?.refinedText, "Buy milk.");

    await w.clock.advance(10_000);
    desk.native.edit(id, "Buy oat milk and eggs.");
    await desk.sync();
    await phone.sync();
    const turn = phone.turn(id);
    assert.equal(
      turn?.refinedText,
      "Buy oat milk and eggs.",
      "the phone shows it",
    );
    assert.equal(turn?.rawText, "Buy oat milk and eggs.");
  });

  it("a studio save that changes no word keeps the phone's refined text", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const { id } = await phone.dictate(
      "Um so buy milk. Then call Ana about Friday.",
      { refinedText: "Buy milk, then call Ana about Friday." },
    );
    await phone.sync();
    await desk.sync();
    assert.equal(
      desk.capture(id)?.refinedText,
      "Buy milk, then call Ana about Friday.",
    );

    // Only a speaker named: the studio still sends its own spacing back.
    await w.clock.advance(10_000);
    const sent = studioSave(desk, id, (segments) =>
      segments.map((segment, index) =>
        index === 0 ? { ...segment, speaker: "Ana" } : segment,
      ),
    );
    assert.notEqual(sent, "Um so buy milk. Then call Ana about Friday.");
    await desk.sync();
    await phone.sync();
    assert.equal(
      desk.capture(id)?.refinedText,
      "Buy milk, then call Ana about Friday.",
    );
    assert.equal(desk.capture(id)?.segments?.[0]?.speaker, "Ana");
    assert.equal(
      phone.turn(id)?.refinedText,
      "Buy milk, then call Ana about Friday.",
      "the phone still shows its refined text",
    );
    assert.equal(phone.turn(id)?.rawText, sent);

    // A word edited in the studio: both apps show the edit.
    await w.clock.advance(10_000);
    const edited = studioSave(desk, id, (segments) =>
      segments.map((segment, index) =>
        index === 0 ? { ...segment, text: "Um so buy oat milk." } : segment,
      ),
    );
    await desk.sync();
    await phone.sync();
    assert.equal(desk.capture(id)?.refinedText, undefined);
    assert.equal(phone.turn(id)?.refinedText, edited);
    assert.equal(phone.turn(id)?.rawText, edited);
  });

  it("deletes go both ways and stay deleted", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const fromDesk = desk.native.record("Delete me on the desktop.");
    const kept = desk.native.record("Keep me.");
    const fromPhone = (await phone.dictate("Delete me on the phone.")).id;
    await desk.sync();
    await phone.sync();
    await desk.sync();
    assert.ok(phone.turn(fromDesk) && phone.turn(kept));
    assert.ok(desk.capture(fromPhone));

    // The desktop's delete goes out after its debounce.
    await w.clock.advance(10_000);
    desk.native.deleteByUser(fromDesk);
    await w.clock.advance(LOCAL_CHANGE_DELAY_MS);
    await desk.controller.idle();
    assert.equal(desk.native.deletes.size, 0, "the engine took the delete");
    await phone.sync();
    assert.equal(phone.turn(fromDesk), undefined, "gone on the phone");
    assert.ok(phone.turn(kept), "the other note stays");

    // The phone's delete, likewise.
    await w.clock.advance(10_000);
    await phone.delete(fromPhone);
    await w.clock.advance(CHANGE_DELAY_MS);
    await desk.sync();
    assert.equal(desk.capture(fromPhone), undefined, "gone on the desktop");
    assert.ok(desk.capture(kept));

    // Neither comes back, after a restart of the phone too.
    await w.clock.advance(60_000);
    await phone.notes.restart();
    await phone.sync();
    await desk.sync();
    await phone.sync();
    assert.deepEqual(phone.ids(), [kept]);
    assert.deepEqual(desk.ids(), [kept]);
    assert.equal(
      (await phone.notes.kv.getItem(`${SYNC_COMPANION_PREFIX}${fromDesk}`)) ??
        null,
      null,
      "nothing of the deleted note is left on the phone",
    );
  });

  it("a phone's delete not uploaded yet survives history going off and on", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const gone = desk.native.record("Delete me everywhere.");
    const kept = desk.native.record("Keep me.");
    await desk.sync();
    await phone.sync();
    assert.ok(phone.turn(gone) && phone.turn(kept));

    // Offline, the phone deletes the note; an hour later history goes off
    // and on again, and only then is the phone back online.
    phone.network.offline = true;
    await phone.delete(gone);
    await w.clock.advance(CHANGE_DELAY_MS);
    await w.clock.advance(60 * 60_000);
    await phone.historyOffAndOn();
    phone.network.offline = false;
    await phone.sync();
    await desk.sync();
    assert.equal(phone.turn(gone), undefined, "not back on the phone");
    assert.ok(phone.turn(kept), "the other note downloads again");
    assert.equal(desk.capture(gone), undefined, "deleted on the desktop");
    assert.ok(desk.capture(kept));
  });

  it("a conflict keeps the phone's losing text as a copy on the phone", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const id = desk.native.record("Shared note.");
    await desk.sync();
    await phone.sync();

    // Both change it before either syncs; the desktop's change is later.
    await w.clock.advance(10_000);
    await phone.change(id, { rawText: "Phone's version." });
    await w.clock.advance(1_000);
    desk.native.edit(id, "Desktop's version.");
    await desk.sync();
    await phone.sync();

    assert.equal(phone.turn(id)?.rawText, "Desktop's version.", "later wins");
    const copies = phoneCopiesOf(phone, id);
    assert.equal(copies.length, 1, "the phone kept its text as a copy");
    assert.equal(copies[0]!.rawText, "Phone's version.");
    assert.match(copies[0]!.id, NOTE_ID_PATTERN);
    assert.ok(copies[0]!.id.startsWith(`${id}-c`));

    // The copy reaches the desktop, without audio.
    await desk.sync();
    const onDesk = desktopCopiesOf(desk, id);
    assert.equal(onDesk.length, 1);
    assert.equal(onDesk[0]!.id, copies[0]!.id);
    assert.equal(onDesk[0]!.transcript, "Phone's version.");
    assert.equal(onDesk[0]!.hasAudio, false);
    assert.equal(desk.capture(id)?.transcript, "Desktop's version.");
    assert.equal(desk.capture(id)?.hasAudio, true);
  });

  it("a conflict keeps the desktop's losing text as a copy on the desktop", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const id = (await phone.dictate("Shared note.")).id;
    await phone.sync();
    await desk.sync();

    await w.clock.advance(10_000);
    desk.native.edit(id, "Desktop's version.");
    await w.clock.advance(1_000);
    await phone.change(id, { rawText: "Phone's version." });
    await phone.sync();
    await desk.sync();

    assert.equal(
      desk.capture(id)?.transcript,
      "Phone's version.",
      "later wins",
    );
    const copies = desktopCopiesOf(desk, id);
    assert.equal(copies.length, 1, "the desktop kept its text as a copy");
    assert.equal(copies[0]!.transcript, "Desktop's version.");
    assert.ok(copies[0]!.id.startsWith(`${id}-c`));

    await phone.sync();
    const onPhone = phoneCopiesOf(phone, id);
    assert.equal(onPhone.length, 1);
    assert.equal(onPhone[0]!.id, copies[0]!.id);
    assert.equal(onPhone[0]!.rawText, "Desktop's version.");
    assert.equal(phone.turn(id)?.rawText, "Phone's version.");
    // Both devices hold the same two notes, and a further round changes nothing.
    await desk.sync();
    assert.deepEqual(desk.ids(), phone.ids());
  });

  it("fields one app does not know survive the other app's edits", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);

    // privacyMode is the phone's: the desktop has no place for it.
    const privateId = (
      await phone.dictate("Private memo.", { privacyMode: true })
    ).id;
    // A later app version writes fields neither app knows.
    const future = await startFutureClient(w.clock, w.server, desk.root());
    const futureId = "future_note_1";
    const futureNote = syncNote({
      createdAt: "2026-11-19T08:00:00.000Z",
      rawText: "Water the plants.",
      durationMs: 2_000,
      origin: "watch",
      source: "wrist",
      segments: [
        {
          startMs: 0,
          endMs: 2_000,
          text: "Water the plants.",
          confidence: 0.91,
          words: [{ w: "Water", at: 0 }],
        },
      ],
      color: "teal",
      tags: ["home", "errand"],
      reminder: { at: "2026-11-21T08:00:00.000Z", repeat: false },
    });
    future.notes.put(futureId, futureNote, future.engine.stamp());
    await w.clock.track(future.engine.sync());
    await phone.sync();
    await desk.sync();
    assert.equal(desk.capture(privateId)?.extra?.privacyMode, true);
    assert.deepEqual(desk.capture(futureId)?.extra, {
      color: "teal",
      tags: ["home", "errand"],
      reminder: { at: "2026-11-21T08:00:00.000Z", repeat: false },
    });
    assert.equal(phone.turn(futureId)?.source, "remote", "shown as remote");

    // The desktop edits both, the phone pins both.
    await w.clock.advance(10_000);
    desk.native.edit(privateId, "Private memo, edited on the desktop.");
    desk.native.edit(futureId, "Water the plants and the herbs.");
    await desk.sync();
    await phone.sync();
    assert.equal(phone.turn(privateId)?.privacyMode, true, "still private");
    await w.clock.advance(10_000);
    await phone.change(privateId, { pinned: true });
    await phone.change(futureId, { pinned: true });
    await phone.sync();
    await desk.sync();
    assert.equal(desk.capture(privateId)?.extra?.privacyMode, true);
    assert.equal(desk.capture(privateId)?.pinned, true);

    // The later version reads its note back whole, with both edits.
    await w.clock.track(future.engine.sync());
    const back = future.notes.get(futureId)?.note;
    assert.deepEqual(back, {
      ...futureNote,
      rawText: "Water the plants and the herbs.",
      pinned: true,
      updatedAt: back?.updatedAt,
    });
    assert.ok(back?.updatedAt, "with the desktop's edit time");
    assert.deepEqual(future.notes.get(privateId)?.note.privacyMode, true);
    await future.engine.close();
  });

  it("a phone dictation's segments reach the desktop, whose studio saves them as subtitles", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    // As the phone's capture loop records them: what was said, when, and
    // one part its clock timed.
    const segments: NoteSegment[] = [
      { startMs: 400, endMs: 1_300, text: "um so buy milk" },
      { startMs: 1_900, endMs: 2_600, text: "and bread.", approx: true },
      { startMs: 3_200, endMs: 4_100, text: "Then call Ana" },
    ];
    const rawText = segments.map((segment) => segment.text).join(" ");
    const refinedText = "Buy milk and bread. Then call Ana.";
    const { id } = await phone.dictate(rawText, {
      refinedText,
      durationMs: 4_500,
      segments,
    });
    await phone.sync();
    await desk.sync();
    const capture = desk.capture(id);
    assert.ok(capture, "the dictation is on the desktop");
    assert.equal(capture.transcript, rawText);
    assert.deepEqual(capture.segments, segments, "every time, and approx");
    // Both apps give their engine the same note: one content hash.
    const onDesk = await desktopNote(desk, id);
    const onPhone = await phone.syncedNote(id);
    assert.ok(onDesk && onPhone);
    assert.deepEqual(onDesk, onPhone);
    assert.equal(noteFingerprint(onDesk), noteFingerprint(onPhone));

    // The studio opens it with the phone's times and saves it as SRT.
    const opened = segmentsFromCapture({
      id,
      durationMs: capture.durationMs,
      transcript: capture.transcript,
      segments: capture.segments,
    });
    assert.deepEqual(
      opened.map((segment) => [segment.startMs, segment.endMs]),
      segments.map((segment) => [segment.startMs, segment.endMs]),
    );
    const srt = exportTranscript({
      format: "srt",
      transcript: segmentsToText(opened),
      segments: opened,
    }).content;
    assert.match(srt, /^1\n00:00:00,400 --> 00:00:01,300\num so buy milk/);
    assert.match(srt, /3\n00:00:03,200 --> 00:00:04,100\nThen call Ana/);

    // A studio save that changes no word (a speaker named) keeps the
    // phone's refined text and approx mark; the phone shows the same
    // segments, and sends the speaker back.
    await w.clock.advance(10_000);
    studioSave(desk, id, (list) =>
      list.map((segment, index) =>
        index === 0 ? { ...segment, speaker: "Sam Okafor" } : segment,
      ),
    );
    await desk.sync();
    await phone.sync();
    assert.equal(desk.capture(id)?.refinedText, refinedText);
    assert.equal(desk.capture(id)?.segments[1]?.approx, true);
    const turn = phone.turn(id);
    assert.equal(turn?.refinedText, refinedText);
    assert.deepEqual(turn?.segments, segments, "the speaker is not shown");
    assert.deepEqual(await phone.syncedNote(id), await desktopNote(desk, id));
    assert.deepEqual(phoneCopiesOf(phone, id), []);
    assert.deepEqual(desktopCopiesOf(desk, id), []);

    assertServerBlind(w.server, desk.root(), [
      "um so buy milk",
      "Then call Ana",
      "Sam Okafor",
    ]);
  });

  it("a desktop note's segments are the phone's subtitles, and go back as they came", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    const segments = [
      { startMs: 0, endMs: 1_900, text: "Call the bakery", speaker: "Ana" },
      {
        startMs: 2_400,
        endMs: 4_200,
        text: "about the order.",
        speaker: "Ben",
        confidence: 0.8,
      },
    ];
    const id = desk.native.record("Call the bakery about the order.", {
      durationMs: 4_200,
      segments,
    });
    await desk.sync();
    await phone.sync();
    const turn = phone.turn(id);
    assert.ok(turn, "the note is on the phone");
    assert.deepEqual(turn.segments, [
      { startMs: 0, endMs: 1_900, text: "Call the bakery" },
      { startMs: 2_400, endMs: 4_200, text: "about the order." },
    ]);
    // The phone's Subtitles of it: real times, so no approximate note.
    const cues = subtitleCues(turn.segments!);
    assert.equal(
      toSrt(cues),
      "1\n00:00:00,000 --> 00:00:01,900\nCall the bakery\n\n2\n00:00:02,400 --> 00:00:04,200\nabout the order.\n",
    );
    assert.ok(!toVtt(cues).includes("NOTE"));

    // The phone pins it, then the desktop edits it, before either syncs.
    // The pin changed no content, so the desktop's later edit wins with no
    // conflict copy on either side.
    await w.clock.advance(10_000);
    await phone.change(id, { pinned: true });
    await w.clock.advance(1_000);
    desk.native.edit(id, "Call the bakery about Saturday's order.");
    await phone.sync();
    await desk.sync();
    await phone.sync();
    assert.deepEqual(desktopCopiesOf(desk, id), []);
    assert.deepEqual(phoneCopiesOf(phone, id), []);
    assert.equal(
      phone.turn(id)?.rawText,
      "Call the bakery about Saturday's order.",
    );
    assert.deepEqual(desk.capture(id)?.segments, segments, "as they came");

    // A refine on the phone leaves the segments as they are.
    await w.clock.advance(10_000);
    await phone.change(id, {
      mode: "summarize",
      refinedText: "Bakery: Saturday's order.",
    });
    await phone.sync();
    await desk.sync();
    assert.equal(desk.capture(id)?.refinedText, "Bakery: Saturday's order.");
    assert.deepEqual(desk.capture(id)?.segments, segments);
    assert.deepEqual(desktopCopiesOf(desk, id), []);
  });

  it("a note the studio timed by estimate says so, and a typed note gets no subtitles", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    // A typed note lasts 0 ms; a dictation from before Subtitles has a
    // length but no segments.
    const typed = (
      await phone.dictate("Buy milk. Call Ana.", {
        source: "typed",
        durationMs: 0,
      })
    ).id;
    const older = (
      await phone.dictate("Buy milk. Call Ana. Then ship it.", {
        durationMs: 12_000,
      })
    ).id;
    await phone.sync();
    await desk.sync();

    // The studio opens each without times, spreads its sentences over the
    // note's length, and saves a fixed word.
    await w.clock.advance(10_000);
    for (const id of [typed, older]) {
      studioSave(desk, id, (list) =>
        list.map((segment, index) =>
          index === 0 ? { ...segment, text: "Buy oat milk." } : segment,
        ),
      );
    }
    await desk.sync();
    await phone.sync();

    const typedOnDesk = desk.capture(typed)?.segments ?? [];
    assert.equal(typedOnDesk.length, 2);
    assert.ok(
      typedOnDesk.every(
        (segment) => segment.approx === true && segment.endMs === 0,
      ),
      "estimates, of 0 ms",
    );
    assert.equal(phone.turn(typed)?.rawText, "Buy oat milk.\n\nCall Ana.");
    assert.equal(phone.turn(typed)?.segments, undefined, "no Subtitles");

    const olderOnPhone = phone.turn(older)?.segments;
    assert.ok(olderOnPhone, "the older dictation has Subtitles");
    assert.deepEqual(
      olderOnPhone.map((segment) => segment.text),
      ["Buy oat milk.", "Call Ana.", "Then ship it."],
    );
    assert.equal(olderOnPhone.at(-1)?.endMs, 12_000);
    assert.ok(
      olderOnPhone.every((segment) => segment.approx === true),
      "the WebVTT file says the times are approximate",
    );

    // A pin on the phone sends the studio's segments back as they came.
    await w.clock.advance(10_000);
    await phone.change(typed, { pinned: true });
    await phone.sync();
    await desk.sync();
    assert.equal(desk.capture(typed)?.pinned, true);
    assert.deepEqual(desk.capture(typed)?.segments, typedOnDesk);
    for (const id of [typed, older]) {
      assert.deepEqual(await phone.syncedNote(id), await desktopNote(desk, id));
      assert.deepEqual(desktopCopiesOf(desk, id), []);
      assert.deepEqual(phoneCopiesOf(phone, id), []);
    }
  });

  it("a pin on the phone keeps every segment and the whole transcript of a long desktop note", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    // About 11 hours of speech, every segment timed: over 1.5 MB of
    // segments, and a transcript longer than the phone shows.
    const words = ["the", "budget", "next", "quarter", "plan", "we", "should"];
    let seed = 1;
    const word = () => {
      seed = (seed * 48271) % 2147483647;
      return words[seed % words.length]!;
    };
    const segments = Array.from({ length: 6_500 }, (_, index) => ({
      startMs: index * 6_000,
      endMs: index * 6_000 + 5_900,
      text: `${Array.from({ length: 18 }, word).join(" ")}.`,
      speaker: index % 2 ? "Ana" : "Ben",
    }));
    const transcript = segments.map((segment) => segment.text).join(" ");
    const id = desk.native.record(transcript, {
      segments,
      durationMs: 6_500 * 6_000,
    });
    await desk.sync();
    assert.equal(desk.view().problem, undefined);
    await phone.sync();
    assert.ok(phone.turn(id), "the phone has the note");
    assert.equal(
      phone.turn(id)?.segments,
      undefined,
      "too many for the phone's subtitles",
    );

    // The user pins it on the phone: a change of metadata only.
    await w.clock.advance(10_000);
    await phone.change(id, { pinned: true });
    await phone.sync();
    await desk.sync();
    const back = desk.native.note(id);
    assert.equal(back?.pinned, true);
    assert.equal(back?.transcript, transcript, "the whole transcript");
    assert.deepEqual(back?.segments, segments, "every segment");
    assert.deepEqual(desktopCopiesOf(desk, id), []);
    assert.deepEqual(phoneCopiesOf(phone, id), []);
  });

  it("retention stays on each device: no deletes elsewhere, old notes not imported", async () => {
    const w = await world();
    const desk = w.desktop();
    const phone = await w.phone({ retentionDays: 30 });
    await turnOnDesktop(w, desk);
    const old = desk.native.record("An old note.", {
      createdAtMs: START - 40 * DAY,
    });
    const recent = desk.native.record("A recent note.");
    await desk.sync();
    await phoneJoinsDesktop(w, desk, phone);
    assert.equal(phone.turn(old), undefined, "past the phone's retention");
    assert.ok(phone.turn(recent));

    // The desktop's retention removes a note there only.
    desk.native.purge(recent);
    await desk.sync();
    await phone.sync();
    assert.ok(phone.turn(recent), "the phone keeps it");
  });

  it("deleting the server copy on the phone turns the desktop off, notes kept", async () => {
    const w = await world();
    const { desk, phone } = await paired(w);
    desk.native.record("Stays on the desktop.");
    await desk.sync();
    await phone.sync();

    await phone.controller.turnOff(true);
    assert.equal(phone.view().status, "off");
    assert.equal(await phone.secrets.getItem(SYNC_KEY_ITEM), null);
    await desk.sync();
    assert.equal(desk.view().phase, "off");
    assert.equal(desk.view().problem?.kind, "deleted");
    assert.equal(desk.native.key, null, "the desktop forgot the key");
    assert.equal(desk.native.state.size, 0, "and its sync state");
    assert.deepEqual(desk.native.transcripts(), ["Stays on the desktop."]);
    assert.equal(phone.notes.history.length, 1, "the phone keeps its notes");
  });
});
