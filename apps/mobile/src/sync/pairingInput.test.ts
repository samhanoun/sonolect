import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PairingError,
  base64urlEncode,
  pairingCode,
  pairingPayload,
} from "@sonolect/sync-core";

import { readScannedCode, readTypedCode } from "./pairingInput";

const root = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);
const key = base64urlEncode(root);
/** The link earlier builds put in the QR code. */
const oldLink = `sonolect://sync/join?v=1&k=${key}`;

describe("a typed code", () => {
  it("takes the 56 characters, with spaces and lower case", () => {
    const typed = pairingCode(root).toLowerCase().replace(/-/g, " ");
    assert.deepEqual(readTypedCode(typed), { kind: "confirm", root });
    assert.deepEqual(readTypedCode(`  ${pairingCode(root)}\n`), {
      kind: "confirm",
      root,
    });
  });

  it("takes the QR code's text, pasted", () => {
    assert.deepEqual(readTypedCode(pairingPayload(root)), {
      kind: "confirm",
      root,
    });
  });

  it("refuses a link, and says why", () => {
    for (const text of [oldLink, "https://sonolect.app/join", "not a code"]) {
      const plan = readTypedCode(text);
      assert.equal(plan.kind, "invalid", text);
      assert.ok(plan.kind === "invalid" && plan.error instanceof PairingError);
    }
    const link = readTypedCode(oldLink);
    assert.equal(
      link.kind === "invalid" && (link.error as PairingError).code,
      "invalid",
    );
  });
});

describe("a scanned QR code", () => {
  it("gives the key of a Sonolect sync code", () => {
    assert.deepEqual(readScannedCode(pairingPayload(root)), {
      kind: "confirm",
      root,
    });
  });

  it("says when the code comes from a newer app", () => {
    assert.deepEqual(readScannedCode(`SONOLECT SYNC 2 ${pairingCode(root)}`), {
      kind: "newer",
    });
  });

  it("refuses links and every other QR code", () => {
    const code = pairingCode(root);
    const typo =
      code.slice(0, 7) + (code[7] === "7" ? "8" : "7") + code.slice(8);
    for (const data of [
      oldLink,
      `sonolect:///sync/join?v=1&k=${key}`,
      "sonolect://dictate",
      "https://example.com/menu",
      "WIFI:T:WPA;S:home;P:secret;;",
      "hello",
      "",
      `SONOLECT SYNC 1 ${typo}`,
    ])
      assert.deepEqual(readScannedCode(data), { kind: "other" }, data);
  });
});
