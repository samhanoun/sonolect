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

describe("desktop futuristic design shell", () => {
  it("keeps the core voice workflow affordances in the redesigned interface", () => {
    for (const requiredText of [
      "Parler maintenant",
      "Rechercher une commande",
      "Transcription éditable",
      "Transformer avec Sonolect",
      "Confidentialité",
      "Actions agentiques",
      "Local-first",
    ]) {
      assert.match(mainSource, new RegExp(requiredText));
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
