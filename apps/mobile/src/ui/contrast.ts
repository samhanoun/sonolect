/**
 * WCAG 2.x colour contrast, for checking the theme in tests (ux-26). Pure:
 * no React Native imports.
 */

type Rgb = [red: number, green: number, blue: number];

/** The channels of a #RGB or #RRGGBB colour, each from 0 to 1. */
function channels(color: string): Rgb {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!digits) throw new Error(`Not a #RGB or #RRGGBB colour: ${color}`);
  const hex =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join("")
      : digits;
  const channel = (start: number) =>
    parseInt(hex.slice(start, start + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}

/** An sRGB channel without its gamma curve. */
function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(color: string): number {
  const [red, green, blue] = channels(color);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/**
 * The WCAG contrast ratio of two colours, from 1 to 21; the order does not
 * matter. Text needs 4.5:1 (SC 1.4.3), and the outline of a control 3:1
 * (SC 1.4.11).
 */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The channels and alpha of rgba(r, g, b, a), each from 0 to 1. */
function rgba(color: string): [...Rgb, number] {
  const match =
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d*\.?\d+)\s*\)$/i.exec(
      color.trim(),
    );
  if (!match) throw new Error(`Not an rgba() colour: ${color}`);
  const [, red, green, blue, alpha] = match.map(Number) as number[];
  return [red! / 255, green! / 255, blue! / 255, alpha!];
}

/**
 * The opaque #RRGGBB seen when a translucent rgba() colour is drawn over
 * `bottom` (#RGB or #RRGGBB), as a view's background is drawn over what is
 * behind it. Over this result, contrastRatio checks glass.
 */
export function over(top: string, bottom: string): string {
  const [red, green, blue, alpha] = rgba(top);
  const base = channels(bottom);
  return `#${[red, green, blue]
    .map((channel, index) => {
      const mixed = channel * alpha + base[index]! * (1 - alpha);
      return Math.round(mixed * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")
    .toUpperCase()}`;
}
