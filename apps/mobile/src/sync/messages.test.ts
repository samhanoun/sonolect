import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PairingError, parsePairing } from "@sonolect/sync-core";

import { STRINGS } from "../i18n";
import type { SyncView } from "./controller";
import { pairingErrorText, syncStatusLines } from "./messages";

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
      pairingErrorText(en, refusal("sonolect://sync/join?v=2&k=x")),
      "Update Sonolect to use this code.",
    );
    assert.equal(
      pairingErrorText(en, refusal("sonolect://sync/join?v=1&k=abc")),
      "Check the code: it has 56 characters.",
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
    assert.match(STRINGS.en.sync.joinNotes(1), /This phone's note will sync/);
  });
});
