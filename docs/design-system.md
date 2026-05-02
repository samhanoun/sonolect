# Design System

Sonolect UI tokens live in `packages/ui/config` and are exported from `@sonolect/ui`.

## Token layers

- `colorTokens`: raw palettes for neutral, violet, blue, green, amber, and red.
- `semanticTokens`: product-facing roles such as `surface`, `textPrimary`, `accent`, `danger`, spacing, radii, typography, shadows, motion, and z-index.
- `linearInspiredTokens`: compatibility export for the initial desktop styling work.
- `tailwindPreset`: Tailwind-compatible preset object for apps that use Tailwind.

## Usage

```ts
import { cn, semanticTokens, sonolectTailwindPreset } from "@sonolect/ui";

const className = cn("rounded-lg", isActive && "text-accent");
console.log(semanticTokens.color.surface);
console.log(sonolectTailwindPreset.theme.extend.colors.accent);
```

## Governance

- Prefer semantic tokens over raw hex values in app code.
- Add a token when a value is reused by multiple surfaces or communicates a design decision.
- Avoid removing/renaming tokens without a migration note for desktop and mobile.
- Verify contrast for text/background combinations before shipping.
