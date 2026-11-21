import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRINGS } from "./i18n";

describe("tab labels", () => {
  it("names the tab and its position for VoiceOver (en)", () => {
    assert.equal(
      STRINGS.en.tabs.a11yLabel("Capture", 1, 4),
      "Capture, tab, 1 of 4",
    );
  });

  it("names the tab and its position for VoiceOver (fr)", () => {
    assert.equal(
      STRINGS.fr.tabs.a11yLabel("Bibliothèque", 2, 4),
      "Bibliothèque, onglet, 2 sur 4",
    );
  });
});

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

/** Every key path of a strings tree, with the type of each leaf. */
function shape(value: unknown, path = ""): string[] {
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => shape(child, path ? `${path}.${key}` : key))
      .sort();
  }
  return [`${path}:${typeof value}`];
}

/** Every string of a tree, with sample arguments for the functions. */
function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const args = Array.from({ length: value.length }, () => "X");
    return [String((value as (...a: string[]) => unknown)(...args))];
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(texts);
  }
  return [];
}

describe("key parity", () => {
  it("gives French every English key, with the same kind of value", () => {
    assert.deepEqual(shape(STRINGS.fr), shape(STRINGS.en));
  });

  it("has no empty text and no em dash in either language", () => {
    for (const ui of ["en", "fr"] as const) {
      for (const text of texts(STRINGS[ui])) {
        assert.ok(text.trim().length > 0, `${ui}: empty text`);
        assert.doesNotMatch(text, /—/, `${ui}: ${text}`);
      }
    }
  });
});

describe("online editing copy", () => {
  it("names what is sent, to whom, with whose key and who pays", () => {
    const help = STRINGS.en.settings.onlineEditing.help;
    for (const word of [
      /text of the note/,
      /OpenRouter/,
      /OpenCode Zen/,
      /your own/,
      /bills your account/,
      /asks before/,
    ]) {
      assert.match(help, word);
    }
    const fr = STRINGS.fr.settings.onlineEditing.help;
    for (const word of [
      /texte de la note/,
      /OpenRouter/,
      /OpenCode Zen/,
      /votre propre/,
      /facture votre compte/,
      /demande avant/,
    ]) {
      assert.match(fr, word);
    }
  });

  it("asks before each note, naming the provider and the model", () => {
    const t = STRINGS.en.settings.onlineEditing;
    assert.equal(t.consentTitle("OpenRouter"), "Send this note to OpenRouter?");
    assert.equal(
      t.consentMessage("Rewrite", "OpenRouter", "openai/gpt-6-mini"),
      "Rewrite sends the text of this note to OpenRouter (openai/gpt-6-mini) with your API key. OpenRouter's terms apply. Nothing else leaves this phone.",
    );
    const fr = STRINGS.fr.settings.onlineEditing;
    assert.equal(
      fr.consentTitle("OpenCode Zen"),
      "Envoyer cette note à OpenCode Zen ?",
    );
    assert.match(
      fr.consentMessage("Réécrire", "OpenCode Zen", "kimi-k3"),
      /^Réécrire envoie le texte de cette note à OpenCode Zen \(kimi-k3\)/,
    );
  });

  it("does not claim the key is never in a backup", () => {
    for (const ui of ["en", "fr"] as const) {
      const note = STRINGS[ui].settings.onlineEditing.keyNote;
      assert.doesNotMatch(note, /backup|sauvegarde/i);
      assert.match(note, /another phone|autre téléphone/);
    }
  });

  it("says Ephemeral always asks", () => {
    assert.match(
      STRINGS.en.settings.onlineEditing.alwaysAllowHelp,
      /Ephemeral always asks/,
    );
    assert.match(
      STRINGS.fr.settings.onlineEditing.alwaysAllowHelp,
      /Éphémère demande toujours/,
    );
  });
});
