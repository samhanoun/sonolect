import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generateRootKey, pairingPayload, qrMatrix } from "@sonolect/sync-core";

import {
  hasPlayableAudio,
  rememberAudioless,
  useAudiolessCaptures,
} from "../captureAudio";
import { QrCodeSvg, StudioSync } from "../components/StudioSync";

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

describe("the sync interface", () => {
  it("draws the pairing QR code dark on light, with its quiet zone", () => {
    const root = generateRootKey((n) =>
      crypto.getRandomValues(new Uint8Array(n)),
    );
    const qr = qrMatrix(pairingPayload(root));
    const svg = renderToStaticMarkup(
      createElement(QrCodeSvg, { qr, label: "QR code to join this sync" }),
    );
    const side = qr.size + 8;
    assert.match(svg, new RegExp(`viewBox="0 0 ${side} ${side}"`));
    assert.match(svg, /aria-label="QR code to join this sync"/);
    assert.match(svg, /<rect[^>]*fill="#fff"/);
    const dark = qr.modules.flat().filter(Boolean).length;
    assert.equal(svg.match(/h1v1h-1z/g)?.length, dark);
    // The first module sits inside the quiet zone.
    assert.ok(qr.modules[0]![0]);
    assert.match(svg, /d="M4 4h1v1h-1z/);
  });

  it("shows nothing outside the app in a build without a sync server", () => {
    assert.equal(renderToStaticMarkup(createElement(StudioSync)), "");
  });

  it("keeps play and retry away from notes without audio", () => {
    rememberAudioless([
      { id: "from-phone", hasAudio: false },
      { id: "made-here", hasAudio: true },
      { id: "older-version" },
    ]);
    const ids = useAudiolessCaptures.getState().ids;
    assert.deepEqual([...ids], ["from-phone"]);
    assert.equal(hasPlayableAudio("from-phone", ids), false);
    assert.equal(hasPlayableAudio("made-here", ids), true);
    assert.equal(hasPlayableAudio(undefined, ids), false);
    // The same list again changes nothing (no re-render).
    rememberAudioless([{ id: "from-phone", hasAudio: false }]);
    assert.equal(useAudiolessCaptures.getState().ids, ids);
  });

  it("is wired into the app: lifecycle, settings, library and delete-all", async () => {
    const main = await source("../main.tsx");
    assert.match(main, /useSyncLifecycle\(\)/);
    const workbench = await source("../components/StudioWorkbench.tsx");
    assert.match(workbench, /<StudioSync \/>/);
    assert.match(workbench, /item\.hasAudio !== false &&/);
    assert.match(workbench, /forgetSync: \(\) => sync\.forgetLocal\(\)/);
    assert.match(workbench, /deleteServerCopy: true/);
    const segments = await source("../components/StudioSegments.tsx");
    assert.match(segments, /hasPlayableAudio\(captureId, audioless\)/);
  });
});
