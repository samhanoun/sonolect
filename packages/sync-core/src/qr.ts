import { encode } from "uqr";

export interface QrMatrix {
  /** QR version (1-40). */
  version: number;
  /** Modules per side, without a quiet zone. */
  size: number;
  /** modules[row][column]: true for a dark module. */
  modules: boolean[][];
}

/**
 * The module matrix of a QR code for `text`, with error correction M. Each
 * app draws it itself (SVG on the phone, a canvas or SVG on desktop) with a
 * quiet zone of 4 light modules around it, dark on light.
 */
export function qrMatrix(text: string): QrMatrix {
  const result = encode(text, { ecc: "M", border: 0 });
  return {
    version: result.version,
    size: result.size,
    modules: result.data.map((row) => row.slice()),
  };
}
