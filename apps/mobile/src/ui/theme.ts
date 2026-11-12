/**
 * "Night" theme: the dark counterpart of the approved desktop Studio palette
 * (forest #1F3429, lime #DDF39A). contrast.test.ts checks text colours for
 * 4.5:1 on `bg` and `surface`, and `lineInteractive` for 3:1 on every
 * background.
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
   * the switch's off track (3:1, WCAG 1.4.11).
   */
  lineInteractive: "#5B7064",
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

export const fonts = {
  display: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_600SemiBold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodyBold: "Inter_600SemiBold",
  mono: "JetBrainsMono_500Medium",
} as const;

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 } as const;
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
