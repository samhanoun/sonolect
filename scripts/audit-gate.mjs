#!/usr/bin/env node
// Fails when `pnpm audit` reports a high or critical advisory in any
// workspace, apps/mobile included (security-12), unless every dependency
// path of the advisory is covered by an ACCEPTED entry below. Every accepted
// id must also appear in docs/security-scan-triage.md. The rules are in
// scripts/audit-gate-core.mjs and tested by scripts/audit-gate.test.mjs
// (`pnpm test:audit-gate`).
//
// Exit codes: 0 clean, 1 blocking or undocumented advisories, 2 when
// `pnpm audit` did not return a usable report.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { evaluateAudit, MalformedReportError } from "./audit-gate-core.mjs";

const TRIAGE_DOC = new URL("../docs/security-scan-triage.md", import.meta.url);

const BUILD_TIME_ONLY =
  "build-time only: runs in the Expo/Metro CLI on a developer machine or CI, not in the app bundle";
const REVIEW_BY = "Expo SDK 59 upgrade";

function buildTimeOnly(id, via) {
  return {
    id,
    importer: "apps/mobile",
    via,
    reason: BUILD_TIME_ONLY,
    reviewBy: REVIEW_BY,
  };
}

// Each entry accepts one advisory on the dependency paths that go through
// `via` (package names, ">" between them; see coversPath). Filled from a
// live `pnpm audit --json` on 2026-11-12: every high advisory then reached
// only the Expo and Metro tooling of apps/mobile. The release bundles'
// source maps (expo export --source-maps) contain none of these packages.
export const ACCEPTED = [
  // ws 7.5.10: memory exhaustion in the WebSocket servers of the dev tools.
  buildTimeOnly("GHSA-96hv-2xvq-fx4p", "metro>ws"),
  buildTimeOnly("GHSA-96hv-2xvq-fx4p", "@react-native/dev-middleware>ws"),
  {
    id: "GHSA-96hv-2xvq-fx4p",
    importer: "apps/mobile",
    via: "react-devtools-core>ws",
    reason:
      "dev tooling only: the standalone React DevTools server uses ws; release bundles contain no react-devtools-core",
    reviewBy: REVIEW_BY,
  },
  {
    id: "GHSA-96hv-2xvq-fx4p",
    importer: "apps/mobile",
    via: "react-native>ws",
    reason:
      "not in the app bundle: react-native declares ws for its dev tooling, no react-native file requires it, and the release bundles contain no ws",
    reviewBy: REVIEW_BY,
  },
  // js-yaml 4.1.1 in @expo/xcpretty (formats Xcode build logs).
  buildTimeOnly("GHSA-52cp-r559-cp3m", "@expo/cli>@expo/xcpretty"),
  buildTimeOnly("GHSA-5p4m-2wfm-xmqj", "@expo/cli>@expo/xcpretty"),
  buildTimeOnly("GHSA-2883-xcg3-v3hh", "@expo/cli>@expo/xcpretty"),
  // node-forge 1.4.0 in the Expo CLI (code signing certificates, dev HTTPS).
  buildTimeOnly("GHSA-86w9-cpqp-85rv", "@expo/cli"),
  buildTimeOnly("GHSA-7wch-p9px-956x", "@expo/cli"),
  buildTimeOnly("GHSA-jc66-7q78-782g", "@expo/cli"),
  buildTimeOnly("GHSA-8hrf-8g6f-7xwp", "@expo/cli"),
  buildTimeOnly("GHSA-hqq3-7jhf-c5jx", "@expo/cli"),
  buildTimeOnly("GHSA-5x38-2vff-x55p", "@expo/cli"),
  buildTimeOnly("GHSA-rhr8-3pm8-cq29", "@expo/cli"),
  buildTimeOnly("GHSA-6qrw-m8cv-hcxf", "@expo/cli"),
  // compression 1.8.1 in the Expo CLI dev server.
  buildTimeOnly("GHSA-vc2v-76pw-4v95", "@expo/cli"),
];

function runAudit() {
  try {
    return execFileSync("pnpm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // pnpm audit exits non-zero when it finds anything; the JSON is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

function describe(advisory) {
  return `${advisory.severity.toUpperCase()} ${advisory.module} ${advisory.vulnerableVersions} ${advisory.id} ${advisory.title}`;
}

function main() {
  let result;
  try {
    let report;
    try {
      report = JSON.parse(runAudit());
    } catch (error) {
      throw new MalformedReportError(
        `pnpm audit printed no JSON: ${error.message}`,
      );
    }
    result = evaluateAudit(report, {
      accepted: ACCEPTED,
      triageDoc: readFileSync(TRIAGE_DOC, "utf8"),
    });
  } catch (error) {
    if (error instanceof MalformedReportError) {
      console.error(
        `pnpm audit did not return a usable report: ${error.message}`,
      );
      process.exit(2);
    }
    throw error;
  }
  const { failures, acceptedHits, undocumented, stale } = result;

  for (const hit of acceptedHits) {
    console.log(`accepted: ${describe(hit)} (${hit.paths} paths)`);
  }
  for (const entry of stale) {
    console.warn(
      `warning: stale ACCEPTED entry ${entry.id} via ${entry.via} matches no path; remove it from scripts/audit-gate.mjs and docs/security-scan-triage.md`,
    );
  }

  let failed = false;
  if (undocumented.length > 0) {
    failed = true;
    console.error(
      `\nACCEPTED ids missing from docs/security-scan-triage.md: ${undocumented.join(", ")}`,
    );
  }
  if (failures.length > 0) {
    failed = true;
    console.error(`\n${failures.length} blocking advisories:\n`);
    for (const failure of failures) {
      const where = failure.example
        ? `${failure.uncovered} of ${failure.paths} paths not accepted, e.g. ${failure.example}`
        : "no dependency path in the report";
      console.error(`- ${describe(failure)}\n    ${where}`);
    }
  }
  if (failed) process.exit(1);
  console.log("No blocking high/critical advisories.");
}

// Run only as a script, so the test can import ACCEPTED.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
