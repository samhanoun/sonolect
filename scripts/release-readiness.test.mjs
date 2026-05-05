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

const releaseDocs = readFileSync(
  new URL("../docs/release.md", import.meta.url),
  "utf8",
);

describe("release and package readiness", () => {
  it("keeps npm, desktop, and Tauri versions aligned", () => {
    assert.equal(desktopPackage.version, rootPackage.version);
    assert.equal(tauriConfig.version, rootPackage.version);
  });

  it("documents unsigned PR-safe signing and updater readiness", () => {
    assert.match(releaseDocs, /TAURI_SIGNING_PRIVATE_KEY/);
    assert.match(releaseDocs, /TAURI_UPDATER_PRIVATE_KEY/);
    assert.match(releaseDocs, /latest\.json/);
    assert.match(releaseDocs, /version/);
    assert.match(releaseDocs, /pub_date/);
    assert.match(releaseDocs, /signature/);
    assert.match(ciWorkflow, /Release package validation/);
    assert.doesNotMatch(ciWorkflow, /APPLE_CERTIFICATE:/);
  });

  it("configures updater metadata without committing signing secrets", () => {
    assert.equal(
      tauriConfig.bundle.createUpdaterArtifacts,
      false,
      "Default desktop builds stay unsigned/PR-safe; protected release jobs can opt in with --config.",
    );
    assert.ok(
      tauriConfig.plugins?.updater,
      "Tauri updater plugin config exists",
    );
    assert.match(tauriConfig.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/);
    assert.doesNotMatch(
      Buffer.from(tauriConfig.plugins.updater.pubkey, "base64").toString(
        "utf8",
      ),
      /PLACEHOLDER|TODO|SONOLECT_UPDATER_PUBLIC_KEY/i,
    );
    assert.ok(
      tauriConfig.plugins.updater.endpoints.some((endpoint) =>
        endpoint.includes("latest.json"),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(tauriConfig),
      /PRIVATE_KEY|BEGIN [A-Z ]+ KEY/,
    );
  });

  it("keeps release dry-run validation in CI secret-free for PRs", () => {
    assert.equal(
      rootPackage.scripts["release:dry-run"],
      "pnpm test:release-readiness",
    );
    assert.match(ciWorkflow, /Release readiness dry-run validation/);
    assert.match(ciWorkflow, /pnpm release:dry-run/);
    assert.doesNotMatch(ciWorkflow, /TAURI_SIGNING_PRIVATE_KEY:/);
    assert.doesNotMatch(ciWorkflow, /TAURI_UPDATER_PRIVATE_KEY:/);
  });

  it("validates macOS and Windows desktop package jobs in CI", () => {
    assert.match(ciWorkflow, /macos-latest/);
    assert.match(ciWorkflow, /windows-latest/);
    assert.match(ciWorkflow, /tauri build --bundles/);
    assert.match(ciWorkflow, /Validate macOS bundle/);
    assert.match(ciWorkflow, /Validate Windows installer/);
  });

  it("runs GitHub-hosted Node checks on active LTS/current versions", () => {
    assert.doesNotMatch(ciWorkflow, /node-version:\s*20\b/);
    assert.doesNotMatch(ciWorkflow, /node-version:\s*\[20,/);
    assert.match(ciWorkflow, /node-version:\s*\[22, 24\]/);
  });
});
