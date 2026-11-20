import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CaptureStatus } from "./domain";
import { DICTATION_LANGUAGES } from "./domain";
import { STRINGS } from "./i18n";
import {
  LANGUAGE_NOTICE_KINDS,
  NOTICE_ACTIONS,
  NOTICE_KINDS,
  STORAGE_NOTICE_KINDS,
  actionLabel,
  emptyEndOutcome,
  isStorageNotice,
  noticeFor,
  noticeText,
  refineNoticeChange,
  replaceNotice,
  storageBanner,
} from "./notices";
import type { NoticeAction, NoticeKind } from "./notices";

const UI_LANGUAGES = ["en", "fr"] as const;

describe("notices", () => {
  it("has a text for every kind in both languages", () => {
    for (const ui of UI_LANGUAGES) {
      const t = STRINGS[ui];
      for (const kind of NOTICE_KINDS) {
        const text = noticeText(t, noticeFor(kind, "fr-FR"));
        assert.ok(text.trim().length > 0, `${ui}.${kind} is empty`);
        assert.ok(!text.includes("${"), `${ui}.${kind}: ${text}`);
        assert.ok(!text.includes("{"), `${ui}.${kind}: ${text}`);
        assert.ok(!text.includes("undefined"), `${ui}.${kind}: ${text}`);
      }
    }
  });

  it("names the dictation language in the UI language", () => {
    for (const kind of LANGUAGE_NOTICE_KINDS) {
      assert.match(
        noticeText(STRINGS.fr, noticeFor(kind, "fr-FR")),
        /français/,
        kind,
      );
      assert.match(
        noticeText(STRINGS.en, noticeFor(kind, "fr-FR")),
        /French/,
        kind,
      );
      assert.match(
        noticeText(STRINGS.fr, noticeFor(kind, "ar-SA")),
        /arabe/,
        kind,
      );
    }
  });

  it("has a language name for every dictation language", () => {
    for (const ui of UI_LANGUAGES) {
      for (const language of DICTATION_LANGUAGES) {
        assert.ok(STRINGS[ui].languageNames[language].trim().length > 0);
      }
    }
  });

  it("has a label for every action in both languages", () => {
    for (const ui of UI_LANGUAGES) {
      for (const action of NOTICE_ACTIONS) {
        const label = actionLabel(STRINGS[ui], action);
        assert.ok(label.trim().length > 0, `${ui}.${action} is empty`);
      }
    }
    assert.equal(
      actionLabel(STRINGS.fr, "typeInstead"),
      STRINGS.fr.capture.typeInstead,
    );
  });

  it("reuses the permission text for a blocked microphone", () => {
    for (const ui of UI_LANGUAGES) {
      assert.equal(
        noticeText(STRINGS[ui], noticeFor("micBlocked")),
        STRINGS[ui].capture.permissionDenied,
      );
    }
  });

  it("offers the actions the plan sets for each kind", () => {
    const expected: Partial<Record<NoticeKind, NoticeAction[]>> = {
      modelMissing: ["downloadModel", "useServiceOnce", "typeInstead"],
      needsConsent: ["useServiceOnce", "alwaysAllow", "typeInstead"],
      micBlocked: ["openSettings"],
      speechDenied: ["openSettings"],
      speechRestricted: ["typeInstead"],
      unavailable: ["typeInstead"],
      languageNotSupported: ["typeInstead"],
      modelNotSupported: ["useServiceOnce", "dismiss"],
      modelFailed: ["useServiceOnce", "dismiss"],
    };
    for (const kind of NOTICE_KINDS) {
      assert.deepEqual(
        [...noticeFor(kind, "en-US").actions],
        expected[kind] ?? ["dismiss"],
        kind,
      );
    }
  });

  it("keeps the language only when one is given", () => {
    assert.deepEqual(noticeFor("modelMissing", "de-DE"), {
      kind: "modelMissing",
      actions: ["downloadModel", "useServiceOnce", "typeInstead"],
      language: "de-DE",
    });
    assert.equal("language" in noticeFor("busy"), false);
  });

  it("uses the storage texts of the plan", () => {
    assert.equal(
      noticeText(STRINGS.en, noticeFor("storageReadError")),
      "Sonolect couldn't read your saved notes. Nothing was deleted. Restart the app to try again.",
    );
    assert.equal(
      noticeText(STRINGS.fr, noticeFor("storageReadError")),
      "Sonolect n'a pas pu lire vos notes enregistrées. Rien n'a été supprimé. Redémarrez l'app pour réessayer.",
    );
    assert.equal(
      noticeText(STRINGS.en, noticeFor("storageWriteError")),
      "Your latest change couldn't be saved on this phone. Free up some storage and try again.",
    );
    assert.equal(
      noticeText(STRINGS.fr, noticeFor("storageWriteError")),
      "Votre dernière modification n'a pas pu être enregistrée sur ce téléphone. Libérez de l'espace et réessayez.",
    );
  });

  it("tells the storage notices from the dictation ones", () => {
    assert.deepEqual(
      NOTICE_KINDS.filter((kind) => isStorageNotice(kind)),
      [...STORAGE_NOTICE_KINDS],
    );
    assert.deepEqual(
      [...STORAGE_NOTICE_KINDS],
      ["storageReadError", "storageWriteError"],
    );
  });

  it("puts storage notices, or the unread notes, on Library and Settings", () => {
    const writeError = noticeFor("storageWriteError");
    assert.deepEqual(storageBanner(writeError, false), {
      notice: writeError,
      dismissable: true,
    });
    assert.deepEqual(storageBanner(writeError, true), {
      notice: writeError,
      dismissable: true,
    });
    const readError = noticeFor("storageReadError");
    // Settings, dictionary or snippets unread: the user may dismiss it.
    assert.deepEqual(storageBanner(readError, false), {
      notice: readError,
      dismissable: true,
    });
    // Notes unread: it stays until a launch reads them.
    for (const current of [null, readError, noticeFor("busy")]) {
      assert.deepEqual(storageBanner(current, true), {
        notice: readError,
        dismissable: false,
      });
    }
    assert.equal(storageBanner(noticeFor("busy"), false), null);
    assert.equal(storageBanner(null, false), null);
  });

  it("gives every action a single owner in the action list", () => {
    for (const kind of NOTICE_KINDS) {
      const { actions } = noticeFor(kind, "en-US");
      assert.equal(new Set(actions).size, actions.length, kind);
      assert.ok(actions.length > 0, kind);
    }
  });

  it("uses the refinement failure texts", () => {
    assert.equal(
      noticeText(STRINGS.en, noticeFor("refineFailed")),
      "Sonolect couldn't refine this note. It was kept as it was.",
    );
    assert.equal(
      noticeText(STRINGS.fr, noticeFor("refineFailed")),
      "Sonolect n'a pas pu raffiner cette note. Elle est restée inchangée.",
    );
  });
});

describe("replaceNotice", () => {
  it("takes an error status back to idle with the notice it explained", () => {
    const next = noticeFor("modelInstalled", "fr-FR");
    assert.deepEqual(replaceNotice("error", next), {
      notice: next,
      resetStatus: true,
    });
    assert.deepEqual(replaceNotice("error", null), {
      notice: null,
      resetStatus: true,
    });
  });

  it("leaves any other status alone, a running dictation included", () => {
    const statuses: CaptureStatus[] = [
      "idle",
      "listening",
      "processing",
      "ready",
    ];
    for (const status of statuses) {
      assert.deepEqual(replaceNotice(status, null), {
        notice: null,
        resetStatus: false,
      });
    }
  });
});

describe("emptyEndOutcome", () => {
  it("reads ATTENTION with the error the dictation raised", () => {
    const network = noticeFor("network");
    assert.deepEqual(emptyEndOutcome(network, network), {
      status: "error",
      notice: network,
    });
  });

  it("keeps what replaced the dictation's error", () => {
    const denied = noticeFor("micDenied");
    const blocked = noticeFor("micBlocked");
    assert.deepEqual(emptyEndOutcome(denied, blocked), {
      status: "error",
      notice: blocked,
    });
  });

  it("shows the dictation's error again when it was dismissed", () => {
    const network = noticeFor("network");
    assert.deepEqual(emptyEndOutcome(network, null), {
      status: "error",
      notice: network,
    });
  });

  it("is an empty dictation, not an error, when none was raised", () => {
    const others = [
      null,
      noticeFor("modelInstalled", "fr-FR"),
      noticeFor("modelScheduled"),
      noticeFor("maxDuration"),
      noticeFor("needsModel"),
    ];
    for (const current of others) {
      assert.deepEqual(
        emptyEndOutcome(null, current),
        { status: "idle", notice: noticeFor("noSpeech") },
        current?.kind ?? "none",
      );
    }
  });

  it("never drops a storage notice", () => {
    for (const kind of STORAGE_NOTICE_KINDS) {
      const current = noticeFor(kind);
      assert.deepEqual(emptyEndOutcome(null, current), {
        status: "idle",
        notice: current,
      });
    }
  });
});

describe("refineNoticeChange", () => {
  it("keeps a dictation's notice and its status", () => {
    const network = noticeFor("network");
    for (const status of ["error", "listening", "ready"] as const) {
      assert.equal(refineNoticeChange(network, status, null), null, status);
    }
    assert.equal(
      refineNoticeChange(noticeFor("storageWriteError"), "ready", null),
      null,
    );
    assert.equal(refineNoticeChange(null, "idle", null), null);
  });

  it("clears its own earlier notices", () => {
    for (const kind of ["needsModel", "refineFailed"] as const) {
      assert.deepEqual(refineNoticeChange(noticeFor(kind), "ready", null), {
        notice: null,
        resetStatus: false,
      });
    }
  });

  it("shows its notice, taking an error status back to idle", () => {
    const needsModel = noticeFor("needsModel");
    assert.deepEqual(
      refineNoticeChange(noticeFor("network"), "error", needsModel),
      { notice: needsModel, resetStatus: true },
    );
    const failed = noticeFor("refineFailed");
    assert.deepEqual(refineNoticeChange(null, "ready", failed), {
      notice: failed,
      resetStatus: false,
    });
    assert.deepEqual(refineNoticeChange(null, "listening", failed), {
      notice: failed,
      resetStatus: false,
    });
  });
});
