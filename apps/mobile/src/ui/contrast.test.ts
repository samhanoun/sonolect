import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contrastRatio, over, relativeLuminance } from "./contrast";
import { aurora, colors, glass, inputSelectionColor } from "./theme";

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
      bg: 4.86,
      bgRaised: 4.71,
      surface: 4.55,
      surfaceStrong: 4.24,
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

describe("over", () => {
  it("mixes a translucent colour into what is behind it", () => {
    assert.equal(over("rgba(255, 255, 255, 1)", "#000000"), "#FFFFFF");
    assert.equal(over("rgba(255, 255, 255, 0)", "#123456"), "#123456");
    assert.equal(over("rgba(255, 255, 255, 0.5)", "#000"), "#808080");
  });

  it("refuses a top colour that is not rgba()", () => {
    assert.throws(() => over(colors.lime, colors.bg));
  });
});

/**
 * The brightest the backdrop gets: every aurora peak stacked on `bg`. No
 * point of the screen has all three, so real backgrounds are darker.
 */
const backdrop = over(
  aurora.lime,
  over(aurora.cyan, over(aurora.forest, colors.bg)),
);
/** A glass panel at the top of its sheen, over the brightest backdrop. */
const panel = over(glass.sheenPeak, over(glass.fill, backdrop));
const panelStrong = over(glass.sheenPeak, over(glass.fillStrong, backdrop));

describe("glass contrast", () => {
  it("text colours reach 4.5:1 on the backdrop and on glass panels", () => {
    for (const [name, background] of Object.entries({
      backdrop,
      panel,
      panelStrong,
    })) {
      for (const foreground of [
        "text",
        "muted",
        "lime",
        "cyan",
        "amber",
        "danger",
      ] as const) {
        const ratio = contrastRatio(colors[foreground], background);
        assert.ok(
          ratio >= 4.5,
          `${foreground} on ${name}: ${ratio.toFixed(2)}`,
        );
      }
    }
  });

  it("control outlines reach 3:1 on glass, chips and fields included", () => {
    const backgrounds = {
      backdrop,
      panel,
      panelStrong,
      // An unselected chip, on the backdrop or in a card.
      chipOnBackdrop: over(glass.recess, backdrop),
      chipInCard: over(glass.recess, panelStrong),
      // A text field set into a card (Settings).
      fieldInCard: over(glass.well, panelStrong),
    };
    for (const [name, background] of Object.entries(backgrounds)) {
      const ratio = contrastRatio(colors.lineInteractive, background);
      assert.ok(ratio >= 3, `lineInteractive on ${name}: ${ratio.toFixed(2)}`);
    }
  });

  it("selected chips and segments keep lime and text at 4.5:1", () => {
    const selected = over(glass.accent, panelStrong);
    for (const foreground of ["lime", "text"] as const) {
      const ratio = contrastRatio(colors[foreground], selected);
      assert.ok(ratio >= 4.5, `${foreground}: ${ratio.toFixed(2)}`);
    }
  });

  it("the tab bar's names reach 4.5:1 even with lime or white under it", () => {
    // The bar's own tint, over the brightest things that scroll under it.
    // iOS adds its material and Android its blur, which only darken this.
    for (const under of [colors.lime, colors.text, colors.bg]) {
      const bar = over(glass.bar, under);
      const idle = contrastRatio(glass.tabIdle, bar);
      const lens = contrastRatio(colors.lime, over(glass.accent, bar));
      assert.ok(idle >= 4.5, `idle tab over ${under}: ${idle.toFixed(2)}`);
      assert.ok(lens >= 4.5, `selected tab over ${under}: ${lens.toFixed(2)}`);
    }
    // No blur (Android 11 and older, Reduce Transparency): a solid bar.
    assert.ok(contrastRatio(glass.tabIdle, glass.barOpaque) >= 4.5);
    assert.ok(
      contrastRatio(colors.lime, over(glass.accent, glass.barOpaque)) >= 4.5,
    );
  });

  it("outline and danger buttons keep their labels at 4.5:1", () => {
    for (const [name, background] of Object.entries({
      backdrop,
      panel,
      panelStrong,
    })) {
      const outline = contrastRatio(
        colors.text,
        over(glass.control, background),
      );
      const danger = contrastRatio(
        colors.danger,
        over(glass.dangerFill, background),
      );
      assert.ok(outline >= 4.5, `outline on ${name}: ${outline.toFixed(2)}`);
      assert.ok(danger >= 4.5, `danger on ${name}: ${danger.toFixed(2)}`);
    }
  });

  it("primary buttons keep their dark label at 4.5:1 under the sheen", () => {
    const lit = over("rgba(255, 255, 255, 0.38)", colors.lime);
    assert.ok(contrastRatio(colors.onLime, lit) >= 4.5);
    assert.match(glass.limeSheen, /rgba\(255, 255, 255, 0\.38\) 0%/);
  });

  it("the sheen gradient starts at the peak the tests use", () => {
    assert.ok(glass.sheen.includes(`${glass.sheenPeak} 0%`));
  });
});

describe("inputSelectionColor", () => {
  it("is an opaque tint that reaches 3:1 on every background on iOS", () => {
    // UIKit draws the caret and the selection handles in this colour.
    const tint = inputSelectionColor("ios");
    assert.match(tint, /^#[0-9A-F]{6}$/i);
    for (const background of [
      "bg",
      "bgRaised",
      "surface",
      "surfaceStrong",
    ] as const) {
      const ratio = contrastRatio(tint, colors[background]);
      assert.ok(ratio >= 3, `caret on ${background}: ${ratio.toFixed(2)}`);
    }
  });

  it("keeps the translucent highlight on Android", () => {
    assert.equal(inputSelectionColor("android"), colors.selection);
  });
});
