import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PairingError,
  base64urlEncode,
  pairingCode,
  pairingLink,
  qrMatrix,
} from "@sonolect/sync-core";

import { joinPlanForLink, joinPlanForText } from "./joinLink";
import { QR_QUIET_ZONE, qrPath } from "./qr";

const URL = "https://sync.example.com";
const root = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);
const key = base64urlEncode(root);

describe("join link", () => {
  it("reads the key from the link's parameters", () => {
    assert.deepEqual(joinPlanForLink(URL, { v: "1", k: key }), {
      kind: "confirm",
      root,
    });
  });

  it("ignores parameters it does not know, and repeated ones after the first", () => {
    assert.deepEqual(
      joinPlanForLink(URL, { v: "1", k: [key, "other"], server: "https://x" }),
      { kind: "confirm", root },
    );
  });

  it("refuses a damaged link or one from a newer app", () => {
    for (const [params, code] of [
      [{ v: "1" }, "key"],
      [{ v: "1", k: "abc" }, "key"],
      [{ v: "2", k: key }, "version"],
      [{}, "version"],
    ] as const) {
      const plan = joinPlanForLink(URL, params);
      assert.equal(plan.kind, "invalid");
      assert.ok(plan.kind === "invalid" && plan.error instanceof PairingError);
      assert.equal(
        plan.kind === "invalid" && (plan.error as PairingError).code,
        code,
      );
    }
  });

  it("goes nowhere in a build without a sync server", () => {
    assert.deepEqual(joinPlanForLink(null, { v: "1", k: key }), {
      kind: "unavailable",
    });
    assert.deepEqual(joinPlanForText(null, pairingCode(root)), {
      kind: "unavailable",
    });
  });

  it("takes a typed code, with spaces and lower case, or a whole link", () => {
    const typed = pairingCode(root).toLowerCase().replace(/-/g, " ");
    assert.deepEqual(joinPlanForText(URL, typed), { kind: "confirm", root });
    assert.deepEqual(joinPlanForText(URL, `  ${pairingLink(root)}\n`), {
      kind: "confirm",
      root,
    });
    assert.equal(joinPlanForText(URL, "not a code").kind, "invalid");
  });
});

describe("QR code", () => {
  it("draws every dark module once, inside a quiet zone", () => {
    const link = pairingLink(root);
    const { size, path } = qrPath(link);
    const matrix = qrMatrix(link);
    assert.equal(matrix.size, 37);
    assert.equal(size, 37 + 2 * QR_QUIET_ZONE);
    // Paint the runs back into a grid and compare.
    const painted = Array.from({ length: matrix.size }, () =>
      Array<boolean>(matrix.size).fill(false),
    );
    for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(run); i += 1)
        painted[Number(y) - QR_QUIET_ZONE]![Number(x) - QR_QUIET_ZONE + i] =
          true;
    }
    assert.deepEqual(painted, matrix.modules);
  });
});
