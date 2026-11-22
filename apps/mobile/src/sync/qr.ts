import { qrMatrix } from "@sonolect/sync-core";

/** Light modules around the code, as the QR standard asks. */
export const QR_QUIET_ZONE = 4;

/**
 * The QR code of a pairing link as one SVG path (react-native-svg), in
 * module units: a rectangle per run of dark modules in a row, offset by the
 * quiet zone. Draw it dark on light, scaled to `size` modules.
 */
export function qrPath(text: string): { size: number; path: string } {
  const { size, modules } = qrMatrix(text);
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      const run = x - start;
      parts.push(
        `M${start + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h${run}v1h-${run}z`,
      );
    }
  });
  return { size: size + 2 * QR_QUIET_ZONE, path: parts.join("") };
}
