import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRINGS } from "./i18n";

describe("settings confirmations", () => {
  it("counts notes in Clear history (en)", () => {
    const t = STRINGS.en.settings;
    assert.equal(t.clearHistoryConfirm(1), "Delete the note from this phone?");
    assert.equal(
      t.clearHistoryConfirm(42),
      "Delete all 42 notes from this phone?",
    );
  });

  it("counts notes in Clear history (fr)", () => {
    const t = STRINGS.fr.settings;
    assert.equal(
      t.clearHistoryConfirm(1),
      "Supprimer la note de ce téléphone ?",
    );
    assert.equal(
      t.clearHistoryConfirm(42),
      "Supprimer les 42 notes de ce téléphone ?",
    );
  });

  it("uses the singular and plural when history goes off (en)", () => {
    const t = STRINGS.en.settings;
    assert.equal(
      t.historyOffConfirm(1),
      "Turn off saved history? This deletes 1 note saved on this phone.",
    );
    assert.equal(
      t.historyOffConfirm(2),
      "Turn off saved history? This deletes 2 notes saved on this phone.",
    );
    assert.equal(
      t.ephemeralConfirm(1),
      "Switch to Ephemeral? This deletes 1 note saved on this phone.",
    );
    assert.equal(
      t.ephemeralConfirm(2),
      "Switch to Ephemeral? This deletes 2 notes saved on this phone.",
    );
  });

  it("uses the singular and plural when history goes off (fr)", () => {
    const t = STRINGS.fr.settings;
    assert.equal(
      t.historyOffConfirm(1),
      "Désactiver l'historique ? Cela supprime 1 note enregistrée sur ce téléphone.",
    );
    assert.equal(
      t.historyOffConfirm(2),
      "Désactiver l'historique ? Cela supprime 2 notes enregistrées sur ce téléphone.",
    );
    assert.equal(
      t.ephemeralConfirm(1),
      "Passer en mode éphémère ? Cela supprime 1 note enregistrée sur ce téléphone.",
    );
    assert.equal(
      t.ephemeralConfirm(2),
      "Passer en mode éphémère ? Cela supprime 2 notes enregistrées sur ce téléphone.",
    );
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
