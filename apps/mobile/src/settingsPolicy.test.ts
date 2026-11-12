import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings } from "./domain";
import { DEFAULT_SETTINGS, keepsHistory } from "./domain";
import { STRINGS } from "./i18n";
import {
  clearHistoryTitle,
  historyOffConfirmation,
  historyOffTitle,
  httpsUrlOrNull,
} from "./settingsPolicy";

const localFirst: CompanionSettings = {
  ...DEFAULT_SETTINGS,
  privacyLevel: "local_first",
  saveHistory: true,
};
const ephemeral: CompanionSettings = {
  ...localFirst,
  privacyLevel: "ephemeral",
};

describe("keepsHistory", () => {
  it("keeps notes unless history is off or the level is Ephemeral", () => {
    assert.equal(keepsHistory(localFirst), true);
    assert.equal(
      keepsHistory({ ...localFirst, privacyLevel: "standard" }),
      true,
    );
    assert.equal(keepsHistory({ ...localFirst, saveHistory: false }), false);
    assert.equal(keepsHistory(ephemeral), false);
  });
});

describe("historyOffConfirmation", () => {
  it("asks before going from Local first to Ephemeral with notes", () => {
    assert.deepEqual(historyOffConfirmation(localFirst, ephemeral, 3), {
      kind: "ephemeral",
      count: 3,
    });
  });

  it("asks before turning Save history off", () => {
    assert.deepEqual(
      historyOffConfirmation(
        localFirst,
        { ...localFirst, saveHistory: false },
        1,
      ),
      { kind: "historyOff", count: 1 },
    );
  });

  it("asks from Standard too", () => {
    const standard = { ...localFirst, privacyLevel: "standard" as const };
    assert.deepEqual(
      historyOffConfirmation(standard, { ...standard, saveHistory: false }, 2),
      { kind: "historyOff", count: 2 },
    );
    assert.deepEqual(historyOffConfirmation(standard, ephemeral, 2), {
      kind: "ephemeral",
      count: 2,
    });
  });

  it("does not ask when no note would be deleted", () => {
    assert.equal(historyOffConfirmation(localFirst, ephemeral, 0), null);
    assert.equal(
      historyOffConfirmation(
        localFirst,
        { ...localFirst, saveHistory: false },
        0,
      ),
      null,
    );
  });

  it("does not ask when history stays on or was already off", () => {
    assert.equal(historyOffConfirmation(ephemeral, localFirst, 5), null);
    assert.equal(
      historyOffConfirmation(
        localFirst,
        { ...localFirst, privacyLevel: "standard" },
        5,
      ),
      null,
    );
    const historyOff = { ...localFirst, saveHistory: false };
    assert.equal(historyOffConfirmation(historyOff, ephemeral, 5), null);
    assert.equal(
      historyOffConfirmation(
        ephemeral,
        { ...ephemeral, saveHistory: false },
        5,
      ),
      null,
    );
  });

  it("asks when saved notes could not be read, even with none shown", () => {
    assert.deepEqual(historyOffConfirmation(localFirst, ephemeral, 0, true), {
      kind: "ephemeral",
      count: 0,
      notesUnread: true,
    });
    assert.equal(historyOffConfirmation(ephemeral, localFirst, 0, true), null);
  });
});

describe("confirmation titles", () => {
  it("names the count and the change", () => {
    assert.equal(
      historyOffTitle(STRINGS.en, { kind: "ephemeral", count: 3 }),
      "Switch to Ephemeral? This deletes 3 notes saved on this phone.",
    );
    assert.equal(
      historyOffTitle(STRINGS.fr, { kind: "historyOff", count: 1 }),
      "Désactiver l'historique ? Cela supprime 1 note enregistrée sur ce téléphone.",
    );
  });

  it("names no count when notes could not be read", () => {
    for (const ui of ["en", "fr"] as const) {
      assert.equal(
        historyOffTitle(STRINGS[ui], {
          kind: "historyOff",
          count: 0,
          notesUnread: true,
        }),
        STRINGS[ui].errorBoundary.deleteNotesConfirm,
      );
      assert.equal(
        clearHistoryTitle(STRINGS[ui], 2, true),
        STRINGS[ui].errorBoundary.deleteNotesConfirm,
      );
    }
  });

  it("has nothing to clear without notes", () => {
    assert.equal(clearHistoryTitle(STRINGS.en, 0), null);
    assert.equal(
      clearHistoryTitle(STRINGS.en, 42),
      "Delete all 42 notes from this phone?",
    );
  });
});

describe("httpsUrlOrNull", () => {
  it("accepts an https URL", () => {
    assert.equal(
      httpsUrlOrNull("https://example.org/privacy"),
      "https://example.org/privacy",
    );
    assert.equal(
      httpsUrlOrNull("  https://example.org/fr/privacy?v=2#data \n"),
      "https://example.org/fr/privacy?v=2#data",
    );
    assert.equal(httpsUrlOrNull("HTTPS://example.org"), "HTTPS://example.org");
  });

  it("refuses anything else", () => {
    for (const value of [
      null,
      undefined,
      42,
      {},
      "",
      "   ",
      "http://example.org/privacy",
      "https://",
      "https:example.org",
      "https:// example.org",
      "https://example.org/a b",
      "https://user@example.org/",
      "not a url",
      "javascript:alert(1)",
      "mailto:privacy@example.org",
    ]) {
      assert.equal(httpsUrlOrNull(value), null, String(value));
    }
  });
});
