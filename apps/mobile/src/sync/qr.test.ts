import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pairingPayload, qrMatrix } from "@sonolect/sync-core";

import { QR_QUIET_ZONE, qrPath } from "./qr";

const root = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

describe("QR code", () => {
  it("draws every dark module once, inside a quiet zone", () => {
    const text = pairingPayload(root);
    const { size, path } = qrPath(text);
    const matrix = qrMatrix(text);
    assert.equal(matrix.size, 33);
    assert.equal(size, 33 + 2 * QR_QUIET_ZONE);
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
