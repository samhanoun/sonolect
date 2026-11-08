#!/usr/bin/env node
// Fails when `pnpm audit` reports a high or critical advisory outside the
// excluded workspaces, unless the advisory is listed in ACCEPTED below.
// Every accepted entry must also appear in docs/security-scan-triage.md.
import { execFileSync } from "node:child_process";

const BLOCKING = new Set(["high", "critical"]);

// apps/mobile is gated on critical only (see docs/security-scan-triage.md).
const EXCLUDED_IMPORTERS = ["apps/mobile"];

const ACCEPTED = new Map([
  ["GHSA-mrhx-c7xc-m3w5", "zod 3 memory exhaustion; fixed only in zod 4"],
]);

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

const report = JSON.parse(runAudit());
const failures = [];

for (const advisory of Object.values(report.advisories ?? {})) {
  if (!BLOCKING.has(advisory.severity)) continue;
  if (ACCEPTED.has(advisory.github_advisory_id)) continue;
  const paths = advisory.findings.flatMap((finding) => finding.paths);
  const relevant = paths.filter(
    (path) =>
      !EXCLUDED_IMPORTERS.some(
        (importer) =>
          path.startsWith(`${importer} `) || path.startsWith(`${importer}>`),
      ),
  );
  if (relevant.length === 0) continue;
  failures.push(
    `${advisory.severity.toUpperCase()} ${advisory.module_name} ${advisory.vulnerable_versions} ` +
      `${advisory.github_advisory_id} ${advisory.title}\n    e.g. ${relevant[0]}`,
  );
}

for (const [id, reason] of ACCEPTED) console.log(`accepted: ${id} (${reason})`);

if (failures.length > 0) {
  console.error(`\n${failures.length} blocking advisories:\n`);
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}
console.log(
  "No blocking high/critical advisories outside excluded workspaces.",
);
