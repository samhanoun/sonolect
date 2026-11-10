import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DICTATION_LANGUAGES } from "./domain";
import { STRINGS } from "./i18n";
import {
  LANGUAGE_NOTICE_KINDS,
  NOTICE_ACTIONS,
  NOTICE_KINDS,
  actionLabel,
  noticeFor,
  noticeText,
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

  it("gives every action a single owner in the action list", () => {
    for (const kind of NOTICE_KINDS) {
      const { actions } = noticeFor(kind, "en-US");
      assert.equal(new Set(actions).size, actions.length, kind);
      assert.ok(actions.length > 0, kind);
    }
  });
});
