import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getT, setLocale } from "./i18n";
import {
  localizeNativeMessage,
  nativeMessageTemplates,
} from "./nativeMessages";

const french = <T>(run: () => T): T => {
  setLocale("fr");
  try {
    return run();
  } finally {
    setLocale("en");
  }
};

describe("native message translation", () => {
  it("leaves messages untouched in English", () => {
    assert.equal(
      localizeNativeMessage("No audio was recorded."),
      "No audio was recorded.",
    );
  });

  it("translates a fixed native sentence", () => {
    assert.equal(
      french(() => localizeNativeMessage("No audio was recorded.")),
      "Aucun audio n'a été enregistré.",
    );
  });

  it("keeps the detail of a native sentence that carries one", () => {
    assert.equal(
      french(() =>
        localizeNativeMessage("Model download failed: connection reset"),
      ),
      "Le téléchargement du modèle a échoué : connection reset",
    );
    assert.equal(
      french(() =>
        localizeNativeMessage("Could not delete a.wav: access denied"),
      ),
      "Impossible de supprimer a.wav : access denied",
    );
  });

  it("passes unknown messages through unchanged", () => {
    const unknown = "Something the app has never said before";
    assert.equal(
      french(() => localizeNativeMessage(unknown)),
      unknown,
    );
  });

  it("accepts an explicit translator", () => {
    const t = french(() => getT());
    assert.equal(
      localizeNativeMessage("Unknown model provider.", t),
      "Fournisseur de modèles inconnu.",
    );
  });

  it("only lists sentences the native code really sends", () => {
    const directory = join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "src-tauri",
      "src",
    );
    const rust = readdirSync(directory)
      .filter((name) => name.endsWith(".rs"))
      .map((name) => readFileSync(join(directory, name), "utf8"))
      .join("\n");
    for (const template of nativeMessageTemplates()) {
      // Rust names its placeholders differently, so compare the fixed parts.
      for (const part of template.split(/\{\w+\}/).filter(Boolean)) {
        assert.ok(
          rust.includes(part),
          `No native source sends "${template}" (looked for "${part}")`,
        );
      }
    }
  });
});
