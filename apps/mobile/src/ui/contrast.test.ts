import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrastRatio, relativeLuminance } from "./contrast";
import { colors } from "./theme";

const close = (actual: number, expected: number) =>
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${actual.toFixed(3)} is not ${expected}`,
  );

describe("contrastRatio", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
    assert.equal(contrastRatio(colors.bg, colors.bg), 1);
  });

  it("does not depend on the order of the colours", () => {
    assert.equal(
      contrastRatio(colors.text, colors.bg),
      contrastRatio(colors.bg, colors.text),
    );
  });

  it("reads #RGB and #RRGGBB in either case", () => {
    assert.equal(relativeLuminance("#fff"), 1);
    assert.equal(relativeLuminance("#000"), 0);
    assert.equal(
      relativeLuminance("#ddf39a"),
      relativeLuminance(colors.lime.toUpperCase()),
    );
    // The WCAG example: mid grey #777777 on white is just under 4.5:1.
    close(contrastRatio("#777", "#FFF"), 4.48);
  });

  it("refuses anything that is not a hex colour", () => {
    assert.throws(() => contrastRatio(colors.selection, colors.bg));
    assert.throws(() => contrastRatio("#12345", colors.bg));
    assert.throws(() => contrastRatio("lime", colors.bg));
  });
});

describe("theme contrast", () => {
  it("lineInteractive outlines reach 3:1 on every background", () => {
    const measured = {
      bg: 3.56,
      bgRaised: 3.46,
      surface: 3.34,
      surfaceStrong: 3.11,
    } as const;
    for (const [background, expected] of Object.entries(measured)) {
      const ratio = contrastRatio(
        colors.lineInteractive,
        colors[background as keyof typeof measured],
      );
      assert.ok(ratio >= 3, `lineInteractive on ${background}: ${ratio}`);
      close(ratio, expected);
    }
  });

  it("text, muted and lime reach 4.5:1 on bg and surface", () => {
    for (const foreground of ["text", "muted", "lime"] as const) {
      for (const background of ["bg", "surface"] as const) {
        const ratio = contrastRatio(colors[foreground], colors[background]);
        assert.ok(
          ratio >= 4.5,
          `${foreground} on ${background}: ${ratio.toFixed(2)}`,
        );
      }
    }
  });
});
