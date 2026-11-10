import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DICTATION_LANGUAGES } from "./domain";
import { STRINGS } from "./i18n";
import {
  LANGUAGE_NOTICE_KINDS,
  NOTICE_ACTIONS,
  NOTICE_KINDS,
  STORAGE_NOTICE_KINDS,
  actionLabel,
  isStorageNotice,
  noticeFor,
  noticeText,
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
});
