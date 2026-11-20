/**
 * "Night" theme: the dark counterpart of the approved desktop Studio palette
 * (forest #1F3429, lime #DDF39A). contrast.test.ts checks text colours for
 * 4.5:1 on `bg`, `surface` and the glass panels, and `lineInteractive` for
 * 3:1 on every background, glass included.
 */
export const colors = {
  bg: "#0B120E",
  bgRaised: "#0E1611",
  surface: "#111A15",
  surfaceStrong: "#16211B",
  /** Decorative dividers and card edges only: too faint for a control. */
  line: "#22302A",
  /**
   * Outlines that show where a control is: text fields, unselected chips and
   * the switch's off track (3:1, WCAG 1.4.11), on glass too.
   */
  lineInteractive: "#70867A",
  lineStrong: "#2E4236",
  forest: "#1F3429",
  lime: "#DDF39A",
  limeSoft: "#EEF9C8",
  /** Selected text in an Android text field: translucent lime. */
  selection: "rgba(221,243,154,0.35)",
  cyan: "#9AE6F3",
  amber: "#F3C99A",
  danger: "#F49A8E",
  text: "#EEF2EA",
  muted: "#93A096",
  onLime: "#0B120E",
} as const;

/**
 * A text field's `selectionColor` for `os` (Platform.OS). On iOS it is the
 * UIKit tint of the caret, the selection handles and the highlight, so it
 * must be opaque or the caret is faint. Android colours the caret and the
 * handles with cursorColor and selectionHandleColor, so `selectionColor`
 * only sets the highlight there and stays translucent.
 */
export function inputSelectionColor(os: string): string {
  return os === "ios" ? colors.lime : colors.selection;
}

/** The brightest point of a panel's sheen: white at this opacity. */
const SHEEN_PEAK = 0.04;

/**
 * Glass: translucent forest panels over an ambient "aurora" backdrop, drawn
 * with React Native's own CSS gradients and shadows (no extra views).
 * contrast.test.ts composites each fill over the brightest point of the
 * backdrop and checks the text and outline colours on the result.
 */
export const glass = {
  /** A panel's fill: cards, the search field, the mode pill. */
  fill: "rgba(20, 31, 25, 0.55)",
  /** A raised panel: notices, onboarding. */
  fillStrong: "rgba(28, 42, 35, 0.70)",
  /** Outline buttons: a breath of light on the glass. */
  control: "rgba(255, 255, 255, 0.045)",
  /** Unselected chips: pressed into the glass, which keeps their outline at 3:1. */
  recess: "rgba(0, 0, 0, 0.12)",
  /** A text field set into a panel: darker than the glass around it. */
  well: "rgba(6, 11, 8, 0.55)",
  /** A selected chip, segment or tab: lime-tinted glass. */
  accent: "rgba(221, 243, 154, 0.16)",
  /** The rim of a selected chip, segment or tab. */
  accentEdge: "rgba(221, 243, 154, 0.42)",
  /** A danger button (Delete): a faint red wash and rim. */
  dangerFill: "rgba(244, 154, 142, 0.06)",
  dangerEdge: "rgba(244, 154, 142, 0.22)",
  /** The tab bar's tint over the blur. */
  bar: "rgba(11, 19, 14, 0.74)",
  /** The tab bar where nothing is blurred: Android 11 and older, Reduce Transparency. */
  barOpaque: "#111A15",
  /**
   * Unselected tab names: brighter than `muted`, because the bar is
   * translucent and a lime button can pass under it.
   */
  tabIdle: "#B9C4BB",
  /** The tint iOS 26 Liquid Glass gets, so the bar keeps the forest hue. */
  liquidTint: "rgba(17, 30, 23, 0.55)",
  /** Panel edges, lit from above. */
  edgeTop: "rgba(238, 249, 200, 0.17)",
  edge: "rgba(214, 236, 214, 0.10)",
  edgeBottom: "rgba(214, 236, 214, 0.06)",
  /** The soft light across the top of a panel, and its brightest point. */
  sheenPeak: `rgba(255, 255, 255, ${SHEEN_PEAK})`,
  sheen: `linear-gradient(170deg, rgba(255, 255, 255, ${SHEEN_PEAK}) 0%, rgba(255, 255, 255, 0.012) 40%, rgba(255, 255, 255, 0) 75%)`,
  /** The highlight across the top of a lime button or the mic. */
  limeSheen:
    "linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.08) 45%, rgba(255, 255, 255, 0) 70%)",
  /** The rim of the lime mic button. */
  orbEdge: "rgba(255, 255, 255, 0.35)",
  /** The faint fill inside the mic's outer ring. */
  ringFill: "rgba(255, 255, 255, 0.015)",
  /** The dashed orbit around the mic while a dictation runs. */
  orbit: "rgba(221, 243, 154, 0.45)",
  /** The light behind the mic: a radial lime glow that fades out. */
  halo: "radial-gradient(circle, rgba(221, 243, 154, 0.26) 0%, rgba(221, 243, 154, 0.09) 34%, rgba(221, 243, 154, 0) 66%)",
  /** Floating chrome: the tab bar. */
  shadow: "0px 12px 32px rgba(0, 0, 0, 0.45)",
  /** The lime glow around the mic and under a primary button. */
  limeGlow: "0px 0px 36px rgba(221, 243, 154, 0.42)",
  buttonGlow: "0px 6px 18px rgba(221, 243, 154, 0.22)",
  /** The soft light around the selected tab. */
  lensGlow: "0px 0px 18px rgba(221, 243, 154, 0.18)",
} as const;

/**
 * The ambient light behind every screen: soft glows on `bg`. Each colour is
 * the peak of a radial gradient that fades to transparent; the test stacks
 * all three peaks, which no point of the screen does.
 */
export const aurora = {
  /** Top left. */
  lime: "rgba(221, 243, 154, 0.09)",
  /** Right edge. */
  cyan: "rgba(154, 230, 243, 0.05)",
  /** Bottom, under the tab bar. */
  forest: "rgba(31, 52, 41, 0.12)",
} as const;

/**
 * Radial gradients for the backdrop, built from `aurora`. `live` lights the
 * mic while it listens; it stays behind the orb, where no muted text sits
 * (the status turns lime while listening).
 */
export const auroraGradients = {
  lime: `radial-gradient(circle at 8% -4%, ${aurora.lime} 0%, rgba(221, 243, 154, 0) 55%)`,
  cyan: `radial-gradient(circle at 105% 38%, ${aurora.cyan} 0%, rgba(154, 230, 243, 0) 45%)`,
  forest: `radial-gradient(circle at 50% 110%, ${aurora.forest} 0%, rgba(31, 52, 41, 0) 60%)`,
  live: "radial-gradient(circle at 50% 30%, rgba(221, 243, 154, 0.08) 0%, rgba(221, 243, 154, 0) 34%)",
} as const;

/** Motion: one spring for anything that moves, short fades elsewhere. */
export const motion = {
  /** Snappy, barely overshooting: tab and segment indicators. */
  spring: { stiffness: 320, damping: 26, mass: 0.9 },
  /** Press feedback on buttons, chips and tabs. */
  press: { stiffness: 520, damping: 30, mass: 0.6 },
  pressedScale: 0.96,
  /** Entrance fade for screens and cards, in ms. */
  enter: 360,
  /** Stagger between items that enter together, in ms. */
  stagger: 45,
} as const;

export const fonts = {
  display: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_600SemiBold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodyBold: "Inter_600SemiBold",
  mono: "JetBrainsMono_500Medium",
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export function modeColor(mode: string): string {
  switch (mode) {
    case "summarize":
      return colors.cyan;
    case "reply":
    case "rewrite":
      return colors.amber;
    default:
      return colors.lime;
  }
}
