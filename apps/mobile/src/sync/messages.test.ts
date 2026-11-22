import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PairingError, SyncError, parsePairing } from "@sonolect/sync-core";

import { STRINGS } from "../i18n";
import type { SyncView } from "./controller";
import { actionErrorText, pairingErrorText, syncStatusLines } from "./messages";

const en = STRINGS.en;
const on: SyncView = {
  status: "on",
  syncing: false,
  busy: false,
  lastSyncAt: undefined,
  problem: null,
  paused: null,
};

const refusal = (text: string): unknown => {
  try {
    parsePairing(text);
  } catch (error) {
    return error;
  }
  throw new Error("accepted");
};

describe("sync messages", () => {
  it("says what went wrong in the contract's words", () => {
    const problem = (p: SyncView["problem"]) =>
      syncStatusLines(en, { ...on, problem: p }, String).problem;
    assert.equal(
      problem("unauthorized"),
      "This sync key is not accepted by the server.",
    );
    assert.equal(problem("deleted"), "This sync was deleted.");
    assert.equal(problem("tooLarge"), "A note is too large to sync.");
    assert.equal(problem("server"), "Sync is unavailable right now.");
    assert.equal(
      problem("network"),
      "Offline. Notes will sync when you're back online.",
    );
    assert.equal(
      problem("quotaExceeded"),
      "Sync storage is full. Delete notes to sync new ones.",
    );
    assert.equal(problem("newerSchema"), "Update Sonolect to sync every note.");
    assert.equal(problem(null), null);
  });

  it("names a refused code in the contract's words", () => {
    assert.equal(
      pairingErrorText(en, refusal("hello")),
      "Check the code: it has 56 characters.",
    );
    assert.equal(
      pairingErrorText(en, refusal("sonolect://other")),
      "This is not a Sonolect sync code.",
    );
    assert.equal(
      pairingErrorText(en, refusal(`SONOLECT SYNC 2 ${"0".repeat(56)}`)),
      "Update Sonolect to use this code.",
    );
    // The link earlier builds put in the QR code is not a code.
    assert.equal(
      pairingErrorText(
        en,
        refusal(
          "sonolect://sync/join?v=1&k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        ),
      ),
      "This is not a Sonolect sync code.",
    );
    assert.equal(
      pairingErrorText(en, refusal("U".repeat(56))),
      "Check the code: it has 56 characters.",
    );
    assert.equal(
      pairingErrorText(en, new PairingError("typo", "x")),
      "A character is wrong.",
    );
    assert.equal(
      pairingErrorText(en, new Error("other")),
      "This is not a Sonolect sync code.",
    );
  });

  it("says why turning on or joining failed", () => {
    const text = (error: unknown) => actionErrorText(en, error);
    assert.equal(
      text(new SyncError("network", "offline")),
      "Offline. Notes will sync when you're back online.",
    );
    assert.equal(
      text(new SyncError("unauthorized", "refused", { status: 409 })),
      "This sync key is not accepted by the server.",
    );
    assert.equal(
      text(new SyncError("gone", "deleted", { code: "vault_deleted" })),
      "This sync was deleted.",
    );
    assert.equal(
      text(new SyncError("rateLimited", "slow down")),
      "Sync is unavailable right now.",
    );
    assert.equal(text(new Error("keychain")), "Sync is unavailable right now.");
  });

  it("shows the last sync, a run in progress, or a pause", () => {
    const at = (view: Partial<SyncView>) =>
      syncStatusLines(en, { ...on, ...view }, (ms) => `@${ms}`);
    assert.deepEqual(at({}), { status: "Not synced yet.", problem: null });
    assert.deepEqual(at({ lastSyncAt: 5 }), {
      status: "Last synced @5.",
      problem: null,
    });
    assert.equal(at({ syncing: true, lastSyncAt: 5 }).status, "Syncing…");
    assert.equal(
      at({ paused: "historyOff" }).problem,
      "Paused while Save history is off.",
    );
    assert.equal(
      at({ paused: "settings" }).problem,
      "Paused: Sonolect couldn't read its settings. Check them, or restart the app to try again.",
    );
    assert.equal(
      at({ paused: "historyOff", problem: "network" }).problem,
      "Offline. Notes will sync when you're back online.",
    );
    assert.deepEqual(
      syncStatusLines(en, { ...on, status: "off", problem: "deleted" }, String),
      { status: null, problem: "This sync was deleted." },
    );
  });

  it("has every sync text in French too", () => {
    const walk = (enValue: unknown, frValue: unknown, path: string) => {
      if (typeof enValue === "function") {
        assert.equal(typeof frValue, "function", path);
        return;
      }
      if (typeof enValue === "string") {
        assert.equal(typeof frValue, "string", path);
        assert.notEqual(frValue, "", path);
        return;
      }
      for (const key of Object.keys(enValue as object))
        walk(
          (enValue as Record<string, unknown>)[key],
          (frValue as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
    };
    walk(STRINGS.en.sync, STRINGS.fr.sync, "sync");
    assert.match(STRINGS.fr.sync.joinNotes(2), /2 notes/);
    assert.equal(
      STRINGS.en.sync.joinNotes(1),
      "This phone's note will be copied into this sync.",
    );
    assert.equal(
      STRINGS.en.sync.joinNotes(3),
      "This phone's 3 notes will be copied into this sync.",
    );
    assert.equal(
      STRINGS.fr.sync.joinNotes(3),
      "Les 3 notes de ce téléphone seront copiées dans cette synchronisation.",
    );
  });

  it("tells the other phone to scan the QR code in Sonolect, with the app's own labels", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      assert.ok(t.sync.codeHelp.includes(`(${t.tabs.settings}, `), ui);
      assert.ok(t.sync.codeHelp.includes(`, ${t.sync.scanCode})`), ui);
    }
    assert.match(STRINGS.en.sync.codeHelp, /not with the camera app/);
    assert.match(STRINGS.fr.sync.codeHelp, /pas avec l'app Appareil photo/);
  });

  it("says how to allow the camera: Scan code asks again, or the phone's settings once refused for good", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      assert.ok(t.sync.cameraNeeded.includes(t.sync.scanCode), ui);
      assert.doesNotMatch(t.sync.cameraNeeded, /settings|réglages/i, ui);
      assert.match(t.sync.cameraDenied, /settings|réglages/i, ui);
    }
  });

  it("says which note a conflict copy comes from, in both languages", () => {
    assert.equal(
      STRINGS.en.library.conflictCopyOf("Nov 20, 09:30"),
      "Conflict copy of the note from Nov 20, 09:30: it was changed on two devices, and both versions are kept.",
    );
    assert.match(STRINGS.fr.library.conflictCopyOf("20 nov."), /du 20 nov\. :/);
    assert.notEqual(STRINGS.fr.library.conflictCopyOfGone, "");
  });
});
