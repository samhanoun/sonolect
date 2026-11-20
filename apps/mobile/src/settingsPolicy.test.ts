import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CompanionSettings } from "./domain";
import { DEFAULT_SETTINGS, keepsHistory } from "./domain";
import { STRINGS } from "./i18n";
import {
  clearHistoryPrompt,
  historyOffConfirmation,
  historyOffPrompt,
  httpsUrlOrNull,
  retentionPrompt,
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

describe("confirmation prompts", () => {
  it("asks about the change and counts the notes in the message", () => {
    assert.deepEqual(
      historyOffPrompt(STRINGS.en, { kind: "ephemeral", count: 3 }),
      {
        title: "Switch to Ephemeral?",
        message: "This deletes 3 notes saved on this phone.",
      },
    );
    assert.deepEqual(
      historyOffPrompt(STRINGS.fr, { kind: "historyOff", count: 1 }),
      {
        title: "Désactiver l'historique ?",
        message: "Cela supprime 1 note enregistrée sur ce téléphone.",
      },
    );
  });

  it("names no count when notes could not be read", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      assert.deepEqual(
        historyOffPrompt(t, {
          kind: "historyOff",
          count: 0,
          notesUnread: true,
        }),
        {
          title: t.settings.historyOffTitle,
          message: t.errorBoundary.deleteNotesMessage,
        },
      );
      assert.deepEqual(clearHistoryPrompt(t, 2, true), {
        title: t.settings.clearHistoryTitle,
        message: t.errorBoundary.deleteNotesMessage,
      });
      assert.doesNotMatch(t.errorBoundary.deleteNotesMessage, /\d/);
    }
  });

  it("has nothing to clear without notes", () => {
    assert.equal(clearHistoryPrompt(STRINGS.en, 0), null);
    assert.deepEqual(clearHistoryPrompt(STRINGS.en, 42), {
      title: "Clear history?",
      message: "This deletes 42 notes saved on this phone.",
    });
  });
});

describe("retention confirmation", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  const note = (id: string, ageDays: number, pinned = false) => ({
    id,
    rawText: id,
    refinedText: id,
    mode: "dictate" as const,
    language: "en-US",
    privacyMode: false,
    createdAt: new Date(now - ageDays * 86_400_000).toISOString(),
    durationMs: 0,
    source: "typed" as const,
    syncState: "local" as const,
    pinned,
  });
  const history = [
    note("a", 0),
    note("b", 10),
    note("c", 40),
    note("d", 60, true),
  ];

  it("asks before a shorter limit deletes notes, and says how many", () => {
    assert.deepEqual(retentionPrompt(STRINGS.en, history, 7, now), {
      title: "Delete older notes?",
      message:
        "This deletes 2 notes older than 7 days now. Pinned notes are kept.",
    });
    assert.deepEqual(retentionPrompt(STRINGS.en, history, 30, now), {
      title: "Delete older notes?",
      message:
        "This deletes 1 note older than 30 days now. Pinned notes are kept.",
    });
    assert.equal(
      retentionPrompt(STRINGS.fr, history, 1, now)?.message,
      "Cela supprime maintenant 2 notes de plus de 1 jour. Les notes épinglées sont conservées.",
    );
  });

  it("asks nothing when the change deletes nothing now", () => {
    assert.equal(retentionPrompt(STRINGS.en, history, 0, now), null);
    assert.equal(retentionPrompt(STRINGS.en, history, 90, now), null);
    assert.equal(retentionPrompt(STRINGS.en, [], 1, now), null);
  });

  it("explains each choice under the setting", () => {
    assert.equal(
      STRINGS.en.settings.retentionHelp(0),
      "Notes stay on this phone until you delete them.",
    );
    assert.equal(
      STRINGS.en.settings.retentionHelp(1),
      "Notes older than 1 day are deleted automatically. Pinned notes are kept.",
    );
    assert.equal(
      STRINGS.fr.settings.retentionHelp(30),
      "Les notes de plus de 30 jours sont supprimées automatiquement. Les notes épinglées sont conservées.",
    );
  });
});

describe("confirmation titles fit an Android alert", () => {
  // react-native's Android Alert shows at most two lines of its title and
  // cuts the rest with an ellipsis (alert_title_layout.xml: singleLine,
  // ellipsize end; DialogTitle.onMeasure raises maxLines to 2 only). On a
  // narrow phone with larger text, two lines hold about 32 characters, so
  // titles stay short questions and what is deleted goes in the message.
  const MAX_TITLE = 32;
  const counts = [1, 2, 42, 999, 123_456];

  it("keeps every confirmation title short, with no count in it", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      const titles = [
        t.settings.clearHistoryTitle,
        t.settings.historyOffTitle,
        t.settings.ephemeralTitle,
        t.settings.eraseTitle,
        t.settings.retentionTitle,
        t.errorBoundary.deleteNotesTitle,
        t.library.deleteConfirm,
        t.capture.discardTitle,
      ];
      for (const title of titles) {
        assert.ok(title.length <= MAX_TITLE, `${ui}: ${title}`);
        assert.doesNotMatch(title, /\d/, `${ui}: ${title}`);
      }
    }
  });

  it("puts every count in the message", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      for (const count of counts) {
        const prompts = [
          historyOffPrompt(t, { kind: "historyOff", count }),
          historyOffPrompt(t, { kind: "ephemeral", count }),
          clearHistoryPrompt(t, count),
        ];
        for (const prompt of prompts) {
          assert.ok(prompt);
          assert.ok(prompt.title.length <= MAX_TITLE, `${ui}: ${prompt.title}`);
          assert.ok(
            prompt.message.includes(String(count)),
            `${ui}: ${prompt.message}`,
          );
        }
      }
    }
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
