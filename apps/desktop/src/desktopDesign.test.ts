import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const mainSource = await readFile(
  new URL("./main.tsx", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("./styles.css", import.meta.url),
  "utf8",
);
const frSource = await readFile(
  new URL("./locales/fr.ts", import.meta.url),
  "utf8",
);
const enSource = await readFile(
  new URL("./locales/en.ts", import.meta.url),
  "utf8",
);

describe("desktop futuristic design shell", () => {
  it("keeps the core voice workflow affordances via i18n keys in the interface", () => {
    // These keys must appear in main.tsx (used via t() calls)
    for (const requiredKey of [
      "sidebar.recordNow",
      "topbar.searchCommand",
      "editor.eyebrow",
      "editor.transformCta",
      "privacy.title",
      "topbar.localFirst",
    ]) {
      assert.match(mainSource, new RegExp(requiredKey));
    }
  });

  it("has all required French strings in the fr locale file", () => {
    for (const requiredText of [
      "Parler maintenant",
      "Rechercher une commande",
      "Transcription éditable",
      "Transformer avec Sonolect",
      "Confidentialité",
      "Local-first",
    ]) {
      assert.match(frSource, new RegExp(requiredText));
    }
  });

  it("has corresponding English strings in the en locale file", () => {
    for (const requiredText of [
      "Record now",
      "Search a command",
      "Editable transcription",
      "Transform with Sonolect",
      "Privacy",
      "Local-first",
    ]) {
      assert.match(enSource, new RegExp(requiredText));
    }
  });

  it("uses a futuristic dark interface language with ambient voice visuals", () => {
    for (const requiredSelector of [
      ".ambient-grid",
      ".neural-orb",
      ".signal-rings",
      ".voice-command-strip",
      ".hologram-frame",
    ]) {
      assert.match(
        stylesSource,
        new RegExp(requiredSelector.replace(".", "\\.")),
      );
    }

    for (const requiredToken of [
      "--bg-void",
      "--accent-cyan",
      "--accent-violet",
      "backdrop-filter",
      "radial-gradient",
    ]) {
      assert.match(stylesSource, new RegExp(requiredToken));
    }
  });
});
