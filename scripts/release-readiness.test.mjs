import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const rootPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const desktopPackage = JSON.parse(
  readFileSync(
    new URL("../apps/desktop/package.json", import.meta.url),
    "utf8",
  ),
);
const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const ciWorkflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("release and package readiness", () => {
  it("keeps npm, desktop, and Tauri versions aligned", () => {
    assert.equal(desktopPackage.version, rootPackage.version);
    assert.equal(tauriConfig.version, rootPackage.version);
  });

  it("documents unsigned PR-safe signing and updater readiness", () => {
    assert.match(ciWorkflow, /TAURI_SIGNING_PRIVATE_KEY/);
    assert.match(ciWorkflow, /TAURI_UPDATER_PRIVATE_KEY/);
    assert.match(ciWorkflow, /Release package validation/);
  });

  it("validates macOS and Windows desktop package jobs in CI", () => {
    assert.match(ciWorkflow, /macos-latest/);
    assert.match(ciWorkflow, /windows-latest/);
    assert.match(ciWorkflow, /tauri build --bundles/);
    assert.match(ciWorkflow, /Validate macOS bundle/);
    assert.match(ciWorkflow, /Validate Windows installer/);
  });
});
