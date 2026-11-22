import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { ar } from "../locales/ar";
import { de } from "../locales/de";
import { en, type LocaleKeys } from "../locales/en";
import { es } from "../locales/es";
import { fr } from "../locales/fr";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** The strings sync adds: its settings, its errors, and the native messages it can show. */
const syncKeys = (Object.keys(en) as LocaleKeys[]).filter(
  (key) =>
    key.startsWith("studio.sync.") ||
    key.startsWith("native.sync") ||
    key === "studio.privacy.problemSync" ||
    key === "studio.library.synced" ||
    key === "studio.library.noAudio" ||
    key === "studio.library.conflictOf" ||
    key === "studio.library.conflictCopy",
);

describe("sync strings", () => {
  it("are in every language, with the same placeholders", () => {
    assert.ok(syncKeys.length > 40);
    const locales: [string, Partial<Record<LocaleKeys, string>>][] = [
      ["fr", fr],
      ["ar", ar],
      ["de", de],
      ["es", es],
    ];
    for (const [name, strings] of locales)
      for (const key of syncKeys) {
        const text = strings[key];
        assert.ok(text, `${name} has no ${key}`);
        assert.deepEqual(
          placeholders(text),
          placeholders(en[key]),
          `${name} ${key}`,
        );
      }
  });

  it("say to scan the QR code with Sonolect on the phone, not the camera app", () => {
    assert.match(
      en["studio.sync.codeHint"],
      /with Sonolect \(Settings, Sync, Scan code\), not with the camera app\./,
    );
    assert.match(
      fr["studio.sync.codeHint"],
      /avec Sonolect \(Réglages, Synchronisation, Scanner un code\), pas avec l'app Appareil photo\./,
    );
    // The field takes a code: no link carries the key.
    for (const strings of [en, fr, ar, de, es])
      assert.doesNotMatch(
        strings["studio.sync.joinLabel"] ?? "",
        /link|lien|enlace|رابط/i,
      );
  });

  it("warn that a code shares every note, on each screen that shows or takes one", () => {
    assert.equal(
      en["studio.sync.warning"],
      "Joining shares every note with whoever holds this code.",
    );
    assert.ok(!en["studio.sync.warning"].includes("\n"));
  });
});
