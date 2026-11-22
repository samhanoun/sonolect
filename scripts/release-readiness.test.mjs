import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

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

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({
    name,
    workflow: parse(readFileSync(new URL(name, workflowsDir), "utf8")),
  }));

const osvScannerJob = parse(
  readFileSync(new URL("security.yml", workflowsDir), "utf8"),
).jobs["osv-scanner"];

// Runs the "Scan lockfiles" step the way GitHub runs a step without a
// shell (bash -e), with a stand-in scanner that exits with the given code.
const runOsvScanStep = (scannerExitCode) => {
  const step = osvScannerJob.steps.find(
    (candidate) => candidate.name === "Scan lockfiles",
  );
  assert.ok(step, "The osv-scanner job has a Scan lockfiles step");
  const dir = mkdtempSync(join(tmpdir(), "sonolect-osv-step-"));
  try {
    writeFileSync(
      join(dir, "osv-scanner"),
      `#!/usr/bin/env bash\necho '{}' > osv.sarif\nexit ${scannerExitCode}\n`,
    );
    chmodSync(join(dir, "osv-scanner"), 0o755);
    writeFileSync(join(dir, "step.sh"), step.run);
    return spawnSync("bash", ["-e", "step.sh"], { cwd: dir, encoding: "utf8" })
      .status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("CI workflows", () => {
  it("gives every job a timeout, so a hung step cannot hold a runner for 6 hours", () => {
    const missing = workflows.flatMap(({ name, workflow }) =>
      Object.entries(workflow.jobs)
        .filter(([, job]) => job["timeout-minutes"] === undefined)
        .map(([id]) => `${name}: ${id}`),
    );
    assert.deepEqual(missing, []);
  });

  it("tolerates only the osv-scanner exit code for vulnerabilities found", () => {
    assert.equal(runOsvScanStep(0), 0, "no vulnerabilities");
    assert.equal(runOsvScanStep(1), 0, "vulnerabilities found");
    assert.equal(runOsvScanStep(127), 127, "general error");
    assert.equal(runOsvScanStep(128), 128, "no packages found");
  });

  it("fails the osv-scanner job when the scan wrote no SARIF", () => {
    const keep = osvScannerJob.steps.find(
      (step) => step.name === "Keep SARIF as artifact",
    );
    assert.equal(keep?.with?.path, "osv.sarif");
    assert.equal(keep.with["if-no-files-found"], "error");
  });
});
