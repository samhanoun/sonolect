/**
 * "Night" theme: the dark counterpart of the approved desktop Studio palette
 * (forest #1F3429, lime #DDF39A). Text colours are checked for 4.5:1 contrast
 * on `bg` and `surface`.
 */
export const colors = {
  bg: "#0B120E",
  bgRaised: "#0E1611",
  surface: "#111A15",
  surfaceStrong: "#16211B",
  line: "#22302A",
  lineStrong: "#2E4236",
  forest: "#1F3429",
  lime: "#DDF39A",
  limeSoft: "#EEF9C8",
  cyan: "#9AE6F3",
  amber: "#F3C99A",
  danger: "#F49A8E",
  text: "#EEF2EA",
  muted: "#93A096",
  onLime: "#0B120E",
} as const;

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
