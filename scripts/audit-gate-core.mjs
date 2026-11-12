// The rules of the dependency audit gate (scripts/audit-gate.mjs). Pure: it
// reads only the `pnpm audit --json` report, the accepted list and the
// triage doc it is given. Tested by scripts/audit-gate.test.mjs.

/** Severities that fail the gate. */
export const BLOCKING = new Set(["high", "critical"]);

/** `pnpm audit` returned something that is not a usable report. */
export class MalformedReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "MalformedReportError";
  }
}

/** "@expo/cli@58.1.19" -> "@expo/cli", "ws@7.5.10" -> "ws", "apps/mobile" stays. */
export function packageName(segment) {
  const at = segment.indexOf("@", 1);
  return at === -1 ? segment : segment.slice(0, at);
}

/**
 * The parts of a dependency path, with the spaces around ">" and the
 * versions removed: "apps/mobile > expo@58.0.23 > @expo/cli@58.1.19" ->
 * ["apps/mobile", "expo", "@expo/cli"].
 */
export function pathSegments(path) {
  return path.split(">").map((part) => packageName(part.trim()));
}

/** True when `run` occurs in `segments` as consecutive items. */
function containsRun(segments, run) {
  for (let start = 0; start + run.length <= segments.length; start += 1) {
    if (run.every((name, offset) => segments[start + offset] === name)) {
      return true;
    }
  }
  return false;
}

function viaSegments(entry) {
  return entry.via.split(">").map((part) => part.trim());
}

/**
 * True when an accepted entry covers a dependency path: the path starts at
 * the entry's importer and goes through the entry's `via` chain of packages
 * (names without versions, separated by ">"), for example "@expo/cli" or
 * "react-native>ws". The chain may end at the vulnerable package itself, to
 * accept one dependency edge.
 */
export function coversPath(entry, segments) {
  return (
    segments[0] === entry.importer &&
    containsRun(segments.slice(1), viaSegments(entry))
  );
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** The advisories of a report. Throws MalformedReportError on anything else. */
export function advisoriesOf(report) {
  if (!isObject(report)) {
    throw new MalformedReportError("the report is not a JSON object");
  }
  // A failed audit (no lockfile, registry error) must not read as clean.
  if (report.error !== undefined) {
    throw new MalformedReportError(
      `pnpm audit failed: ${JSON.stringify(report.error).slice(0, 500)}`,
    );
  }
  if (!isObject(report.advisories)) {
    throw new MalformedReportError("the report has no advisories object");
  }
  const advisories = Object.values(report.advisories);
  for (const advisory of advisories) {
    const valid =
      isObject(advisory) &&
      isNonEmptyString(advisory.severity) &&
      isNonEmptyString(advisory.github_advisory_id) &&
      isNonEmptyString(advisory.module_name) &&
      Array.isArray(advisory.findings) &&
      advisory.findings.every(
        (finding) =>
          isObject(finding) &&
          Array.isArray(finding.paths) &&
          finding.paths.every((path) => typeof path === "string"),
      );
    if (!valid) {
      throw new MalformedReportError(
        `malformed advisory: ${JSON.stringify(advisory).slice(0, 300)}`,
      );
    }
  }
  return advisories;
}

/** Throws when an accepted entry is incomplete; the gate's own list is wrong. */
export function checkAcceptedList(accepted) {
  if (!Array.isArray(accepted))
    throw new TypeError("ACCEPTED must be an array");
  for (const entry of accepted) {
    const fields = ["id", "importer", "via", "reason", "reviewBy"];
    const missing = fields.filter((field) => !isNonEmptyString(entry?.[field]));
    if (missing.length > 0) {
      throw new TypeError(
        `ACCEPTED entry ${JSON.stringify(entry)} needs ${missing.join(", ")}`,
      );
    }
    if (!/^GHSA(-[0-9a-z]{4}){3}$/.test(entry.id)) {
      throw new TypeError(
        `ACCEPTED entry has a malformed GHSA id: ${entry.id}`,
      );
    }
    for (const name of viaSegments(entry)) {
      if (name === "" || packageName(name) !== name) {
        throw new TypeError(
          `ACCEPTED ${entry.id}: via "${entry.via}" must be package names without versions, separated by ">"`,
        );
      }
    }
  }
}

/**
 * Applies the gate to a `pnpm audit --json` report.
 *
 * - A high or critical advisory fails unless every one of its dependency
 *   paths is covered (coversPath) by an accepted entry with the same GHSA id.
 *   An advisory without any path fails too.
 * - An accepted id that docs/security-scan-triage.md does not mention is
 *   undocumented, which also fails.
 * - An accepted entry that covers no path of this report (its advisory is
 *   gone, or no longer reaches that chain) is stale: a warning only.
 *
 * Returns { failures, acceptedHits, undocumented, stale }. Throws
 * MalformedReportError on a report that is not usable, and TypeError on an
 * incomplete accepted list.
 */
export function evaluateAudit(report, { accepted, triageDoc }) {
  const advisories = advisoriesOf(report);
  checkAcceptedList(accepted);
  if (typeof triageDoc !== "string") {
    throw new TypeError("triageDoc must be the text of the triage doc");
  }

  const used = new Set();
  const failures = [];
  const acceptedHits = [];
  for (const advisory of advisories) {
    if (!BLOCKING.has(advisory.severity)) continue;
    const id = advisory.github_advisory_id;
    const entries = accepted.filter((entry) => entry.id === id);
    const paths = advisory.findings.flatMap((finding) => finding.paths);
    const uncovered = [];
    for (const path of paths) {
      const segments = pathSegments(path);
      const entry = entries.find((candidate) =>
        coversPath(candidate, segments),
      );
      if (entry) used.add(entry);
      else uncovered.push(path);
    }
    const summary = {
      id,
      severity: advisory.severity,
      module: advisory.module_name,
      vulnerableVersions: advisory.vulnerable_versions ?? "",
      title: advisory.title ?? "",
      paths: paths.length,
    };
    if (paths.length === 0 || uncovered.length > 0) {
      failures.push({
        ...summary,
        uncovered: uncovered.length,
        example: uncovered[0] ?? null,
      });
    } else {
      acceptedHits.push(summary);
    }
  }

  const undocumented = [
    ...new Set(
      accepted.map((entry) => entry.id).filter((id) => !triageDoc.includes(id)),
    ),
  ];
  const stale = accepted.filter((entry) => !used.has(entry));
  return { failures, acceptedHits, undocumented, stale };
}
