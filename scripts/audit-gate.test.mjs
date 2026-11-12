import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  MalformedReportError,
  checkAcceptedList,
  coversPath,
  evaluateAudit,
  pathSegments,
} from "./audit-gate-core.mjs";
import { ACCEPTED } from "./audit-gate.mjs";

// Synthetic advisories in the shape of `pnpm audit --json` (pnpm 9).
const ID = "GHSA-aaaa-bbbb-cccc";
const OTHER_ID = "GHSA-dddd-eeee-ffff";
const TOOLING_PATH =
  "apps/mobile > expo@58.0.23 > @expo/cli@58.1.19 > @expo/xcpretty@4.4.7 > bad-yaml@4.1.1";
const NESTED_TOOLING_PATH =
  "apps/mobile > expo-router@58.0.30 > expo@58.0.23 > @expo/cli@58.1.19 > bad-yaml@4.1.1";
const RUNTIME_PATH = "apps/mobile > zustand@5.1.0 > bad-yaml@4.1.1";
const SERVICE_PATH = "services/api > fastify@5.12.8 > bad-yaml@4.1.1";

function advisory(id, severity, paths) {
  return {
    github_advisory_id: id,
    severity,
    module_name: "bad-yaml",
    vulnerable_versions: "<4.3.0",
    title: "bad-yaml: quadratic CPU",
    findings: [{ version: "4.1.1", paths }],
  };
}

function report(...advisories) {
  return {
    actions: [],
    advisories: Object.fromEntries(
      advisories.map((entry, index) => [String(1000 + index), entry]),
    ),
    muted: [],
    metadata: {},
  };
}

function accept(id, via, importer = "apps/mobile") {
  return {
    id,
    importer,
    via,
    reason: "build-time only",
    reviewBy: "Expo SDK 59 upgrade",
  };
}

const DOC = `| ${ID} (high) | build-time only | Expo SDK 59 upgrade. |`;

function evaluate(auditReport, accepted, triageDoc = DOC) {
  return evaluateAudit(auditReport, { accepted, triageDoc });
}

describe("pathSegments", () => {
  it("drops the spaces around > and the versions", () => {
    assert.deepEqual(pathSegments(TOOLING_PATH), [
      "apps/mobile",
      "expo",
      "@expo/cli",
      "@expo/xcpretty",
      "bad-yaml",
    ]);
    assert.deepEqual(
      pathSegments("apps/mobile>expo@58.0.23>@expo/cli@58.1.19"),
      ["apps/mobile", "expo", "@expo/cli"],
    );
  });
});

describe("evaluateAudit", () => {
  it("fails a high advisory on an apps/mobile runtime path", () => {
    const result = evaluate(report(advisory(ID, "high", [RUNTIME_PATH])), []);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].id, ID);
    assert.equal(result.failures[0].example, RUNTIME_PATH);
    assert.deepEqual(result.acceptedHits, []);
  });

  it("accepts the same advisory on an accepted tooling path", () => {
    const accepted = [accept(ID, "expo>@expo/cli")];
    const result = evaluate(
      report(advisory(ID, "high", [TOOLING_PATH])),
      accepted,
    );
    assert.deepEqual(result.failures, []);
    assert.deepEqual(
      result.acceptedHits.map((hit) => [hit.id, hit.paths]),
      [[ID, 1]],
    );
    assert.deepEqual(result.undocumented, []);
    assert.deepEqual(result.stale, []);
  });

  it("accepts a chain anywhere after the importer, versions ignored", () => {
    const result = evaluate(
      report(advisory(ID, "high", [TOOLING_PATH, NESTED_TOOLING_PATH])),
      [accept(ID, "@expo/cli")],
    );
    assert.deepEqual(result.failures, []);
    assert.equal(result.acceptedHits[0].paths, 2);
  });

  it("accepts one dependency edge that ends at the vulnerable package", () => {
    const edge = "apps/mobile > react-native@0.88.1 > bad-yaml@4.1.1";
    const result = evaluate(report(advisory(ID, "high", [edge])), [
      accept(ID, "react-native>bad-yaml"),
    ]);
    assert.deepEqual(result.failures, []);
  });

  it("fails the same GHSA when another path is not accepted", () => {
    const result = evaluate(
      report(advisory(ID, "high", [TOOLING_PATH, RUNTIME_PATH])),
      [accept(ID, "expo>@expo/cli")],
    );
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].uncovered, 1);
    assert.equal(result.failures[0].paths, 2);
    assert.equal(result.failures[0].example, RUNTIME_PATH);
  });

  it("needs the chain in order and without gaps", () => {
    const result = evaluate(
      report(advisory(ID, "high", [NESTED_TOOLING_PATH])),
      [accept(ID, "expo-router>@expo/cli"), accept(ID, "@expo/cli>expo")],
    );
    assert.equal(result.failures.length, 1);
  });

  it("matches only the entry's importer and GHSA id", () => {
    const otherImporter = evaluate(
      report(advisory(ID, "high", [SERVICE_PATH])),
      [accept(ID, "fastify")],
    );
    assert.equal(otherImporter.failures.length, 1);

    const otherId = evaluate(report(advisory(ID, "high", [TOOLING_PATH])), [
      accept(OTHER_ID, "@expo/cli"),
    ]);
    assert.equal(otherId.failures.length, 1);
  });

  it("fails an unaccepted critical advisory anywhere", () => {
    for (const path of [SERVICE_PATH, RUNTIME_PATH, TOOLING_PATH]) {
      const result = evaluate(report(advisory(ID, "critical", [path])), []);
      assert.equal(result.failures.length, 1, path);
      assert.equal(result.failures[0].severity, "critical");
    }
  });

  it("never fails on moderate or low advisories", () => {
    const result = evaluate(
      report(
        advisory(ID, "moderate", [RUNTIME_PATH]),
        advisory(OTHER_ID, "low", [SERVICE_PATH]),
      ),
      [],
    );
    assert.deepEqual(result.failures, []);
  });

  it("fails a high advisory that has no dependency path", () => {
    const result = evaluate(report(advisory(ID, "high", [])), [
      accept(ID, "@expo/cli"),
    ]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].example, null);
  });

  it("reports an accepted id missing from the triage doc as undocumented", () => {
    const result = evaluate(
      report(advisory(OTHER_ID, "high", [TOOLING_PATH])),
      [accept(OTHER_ID, "@expo/cli")],
    );
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.undocumented, [OTHER_ID]);
  });

  it("only warns about a stale accepted id", () => {
    const stale = accept(OTHER_ID, "@expo/cli");
    const result = evaluate(
      report(advisory(ID, "moderate", [RUNTIME_PATH])),
      [stale],
      `${DOC}\n| ${OTHER_ID} | build-time only | Expo SDK 59 upgrade. |`,
    );
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.undocumented, []);
    assert.deepEqual(result.stale, [stale]);
  });

  it("throws on a malformed report", () => {
    const good = advisory(ID, "high", [RUNTIME_PATH]);
    for (const bad of [
      null,
      [],
      "{}",
      {},
      { advisories: null },
      { advisories: [] },
      { error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" }, advisories: {} },
      { advisories: { 1: { ...good, findings: undefined } } },
      { advisories: { 1: { ...good, severity: undefined } } },
      { advisories: { 1: { ...good, github_advisory_id: "" } } },
      { advisories: { 1: { ...good, findings: [{ paths: "a > b" }] } } },
      { advisories: { 1: { ...good, findings: [{ paths: [42] }] } } },
    ]) {
      assert.throws(() => evaluate(bad, []), MalformedReportError);
    }
  });
});

describe("checkAcceptedList", () => {
  it("refuses incomplete entries", () => {
    const entry = accept(ID, "@expo/cli");
    for (const bad of [
      { ...entry, reason: "" },
      { ...entry, reviewBy: undefined },
      { ...entry, importer: " " },
      { ...entry, id: "CVE-2026-0001" },
      { ...entry, via: "@expo/cli@58.1.19" },
      { ...entry, via: "expo>>@expo/cli" },
    ]) {
      assert.throws(() => checkAcceptedList([bad]), TypeError);
    }
    assert.throws(() => checkAcceptedList(undefined), TypeError);
  });
});

describe("ACCEPTED in scripts/audit-gate.mjs", () => {
  const triageDoc = readFileSync(
    new URL("../docs/security-scan-triage.md", import.meta.url),
    "utf8",
  );

  it("is well formed, and every id is in docs/security-scan-triage.md", () => {
    checkAcceptedList(ACCEPTED);
    const result = evaluateAudit(report(), { accepted: ACCEPTED, triageDoc });
    assert.deepEqual(result.undocumented, []);
  });

  it("covers its own apps/mobile chain and no runtime path", () => {
    for (const entry of ACCEPTED) {
      assert.equal(entry.importer, "apps/mobile", entry.id);
      assert.ok(
        coversPath(entry, pathSegments(`apps/mobile > ${entry.via}`)),
        entry.id,
      );
      assert.ok(
        !coversPath(entry, pathSegments(RUNTIME_PATH)),
        `${entry.id} via ${entry.via} covers a runtime path`,
      );
    }
  });
});
