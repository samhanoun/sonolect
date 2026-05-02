export {
  colorTokens,
  linearInspiredTokens,
  semanticTokens,
} from "../config/tokens";
export type { ColorTokens, SemanticTokens } from "../config/tokens";
export {
  default as tailwindPreset,
  tailwindPreset as sonolectTailwindPreset,
} from "../config/tailwind-preset";

export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");
