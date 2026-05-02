import { semanticTokens } from "./tokens";

export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        background: semanticTokens.color.background,
        surface: semanticTokens.color.surface,
        "surface-elevated": semanticTokens.color.surfaceElevated,
        border: semanticTokens.color.border,
        accent: semanticTokens.color.accent,
        success: semanticTokens.color.success,
        warning: semanticTokens.color.warning,
        danger: semanticTokens.color.danger,
      },
      borderRadius: semanticTokens.radius,
      spacing: semanticTokens.spacing,
      fontFamily: semanticTokens.typography.fontFamily,
      fontSize: semanticTokens.typography.fontSize,
      lineHeight: semanticTokens.typography.lineHeight,
      boxShadow: semanticTokens.shadow,
      transitionDuration: {
        fast: semanticTokens.motion.fast,
        normal: semanticTokens.motion.normal,
        slow: semanticTokens.motion.slow,
      },
      transitionTimingFunction: {
        expressive: semanticTokens.motion.easing,
      },
      zIndex: semanticTokens.zIndex,
    },
  },
} as const;

export default tailwindPreset;
