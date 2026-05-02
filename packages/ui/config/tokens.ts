export const colorTokens = {
  neutral: {
    0: "#FFFFFF",
    50: "#F8FAFC",
    100: "#F1F5F9",
    200: "#E2E8F0",
    300: "#CBD5E1",
    400: "#94A3B8",
    500: "#64748B",
    600: "#475569",
    700: "#334155",
    800: "#1E293B",
    900: "#0F172A",
    950: "#020617",
  },
  violet: {
    50: "#F5F3FF",
    100: "#EDE9FE",
    200: "#DDD6FE",
    300: "#C4B5FD",
    400: "#A78BFA",
    500: "#8B5CF6",
    600: "#7C3AED",
    700: "#6D28D9",
    800: "#5B21B6",
    900: "#4C1D95",
  },
  blue: {
    500: "#3B82F6",
    600: "#2563EB",
  },
  green: {
    500: "#22C55E",
    600: "#16A34A",
  },
  amber: {
    500: "#F59E0B",
    600: "#D97706",
  },
  red: {
    500: "#EF4444",
    600: "#DC2626",
  },
} as const;

export const semanticTokens = {
  color: {
    background: colorTokens.neutral[950],
    backgroundSubtle: "#08090A",
    surface: "#0D0F12",
    surfaceElevated: "#12151A",
    surfaceOverlay: "#181B21",
    border: "#24272E",
    borderStrong: "#343844",
    textPrimary: "#F4F4F5",
    textSecondary: "#A1A1AA",
    textMuted: "#71717A",
    accent: colorTokens.violet[500],
    accentHover: colorTokens.violet[400],
    accentBlue: colorTokens.blue[500],
    success: colorTokens.green[500],
    warning: colorTokens.amber[500],
    danger: colorTokens.red[500],
  },
  radius: {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "16px",
    xl: "24px",
    full: "9999px",
  },
  spacing: {
    0: "0px",
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px",
    16: "64px",
  },
  typography: {
    fontFamily: {
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
    },
    fontSize: {
      xs: "12px",
      sm: "14px",
      base: "16px",
      lg: "18px",
      xl: "20px",
      "2xl": "24px",
      "3xl": "30px",
      "4xl": "36px",
    },
    lineHeight: {
      tight: "1.15",
      snug: "1.3",
      normal: "1.5",
      relaxed: "1.7",
    },
  },
  shadow: {
    sm: "0 1px 2px rgb(0 0 0 / 0.24)",
    md: "0 10px 30px rgb(0 0 0 / 0.28)",
    glow: "0 0 40px rgb(139 92 246 / 0.28)",
  },
  motion: {
    fast: "120ms",
    normal: "180ms",
    slow: "280ms",
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  },
  zIndex: {
    base: 0,
    dropdown: 1000,
    overlay: 1100,
    modal: 1200,
    toast: 1300,
  },
} as const;

export const linearInspiredTokens = {
  colors: semanticTokens.color,
  radius: semanticTokens.radius,
  motion: semanticTokens.motion,
} as const;

export type ColorTokens = typeof colorTokens;
export type SemanticTokens = typeof semanticTokens;
