import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRINGS } from "./i18n";

describe("settings confirmations", () => {
  it("counts the notes deleted, singular and plural (en)", () => {
    const t = STRINGS.en.settings;
    assert.equal(
      t.deleteNotesMessage(1),
      "This deletes 1 note saved on this phone.",
    );
    assert.equal(
      t.deleteNotesMessage(2),
      "This deletes 2 notes saved on this phone.",
    );
    assert.equal(
      t.deleteNotesMessage(42),
      "This deletes 42 notes saved on this phone.",
    );
  });

  it("counts the notes deleted, singular and plural (fr)", () => {
    const t = STRINGS.fr.settings;
    assert.equal(
      t.deleteNotesMessage(1),
      "Cela supprime 1 note enregistrée sur ce téléphone.",
    );
    assert.equal(
      t.deleteNotesMessage(2),
      "Cela supprime 2 notes enregistrées sur ce téléphone.",
    );
    assert.equal(
      t.deleteNotesMessage(42),
      "Cela supprime 42 notes enregistrées sur ce téléphone.",
    );
  });

  it("says that deleting every note or erasing can't be undone", () => {
    assert.match(
      STRINGS.en.errorBoundary.deleteNotesMessage,
      /can't be undone/,
    );
    assert.match(STRINGS.en.settings.eraseMessage, /can't be undone/);
    assert.match(STRINGS.fr.errorBoundary.deleteNotesMessage, /irréversible/);
    assert.match(STRINGS.fr.settings.eraseMessage, /irréversible/);
  });
});

describe("privacy copy", () => {
  it("names the speech services wherever audio may leave the phone", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      for (const text of [t.onboarding.body, t.settings.privacyHelp.standard]) {
        assert.match(text, /Google/);
        assert.match(text, /Apple/);
      }
    }
  });

  it("no longer promises that nothing leaves the phone", () => {
    for (const ui of ["en", "fr"] as const) {
      const t = STRINGS[ui];
      const copy = [
        t.onboarding.body,
        t.settings.about,
        ...Object.values(t.settings.privacyHelp),
      ].join("\n");
      assert.doesNotMatch(copy, /API/);
      assert.doesNotMatch(copy, /nothing leaves|rien n'en sort/i);
      assert.doesNotMatch(copy, /leave the screen|en quittant l'écran/i);
    }
  });
});
