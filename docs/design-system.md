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

## Mobile glass

The mobile app (`apps/mobile`) draws the "Night" palette as glass:
translucent forest panels over a soft "aurora" backdrop, and a floating tab
bar that blurs the page under it.

- **Code**: tokens `glass`, `aurora`, `auroraGradients` and `motion` in
  `apps/mobile/src/ui/theme.ts`; `GlassScreen`, `GlassBar`, `PressableScale`
  and `FadeIn` in `src/ui/glass.tsx`; the tab bar in `src/ui/GlassTabBar.tsx`.
- **Tab bar material**: Liquid Glass on iOS 26 (`expo-glass-effect`), a
  system blur on older iOS and on the web (`expo-blur`), and a GPU blur of
  the page in front on Android 12 and newer. Android 11 and older get an
  opaque bar instead of a slow software blur.
- **Hiding the bar**: it slides away while the keyboard is up, and on a
  screen that sets `tabBarStyle: { display: "none" }` (a full-screen sheet),
  as the stock bar would. A screen that isn't one of the four tabs lights no
  tab.
- **Panels** (cards, notices, the search field) are translucent fills with a
  soft sheen and edges lit from above, drawn with React Native's own
  `backgroundImage` gradients and `boxShadow`, so they add no views.
- **Accessibility**: Reduce Transparency (iOS) makes the tab bar and the
  panels opaque. Reduce Motion stops the springs, the orbit around the mic
  and the entrance fades. `src/ui/contrast.test.ts` lays every glass fill
  over the brightest point of the backdrop and checks 4.5:1 for text and
  3:1 for control outlines (`colors.lineInteractive`).
- **Battery**: the backdrop is static. The orbit and the pulse around the
  mic run only while it listens or works.
- **Screenshots**: [`docs/screenshots/mobile-glass/`](screenshots/mobile-glass/)
  (web build at 390×844); `before/` holds the flat screens it replaced.

The web build can't show these, so check them on phones: Liquid Glass on
iOS 26, the blur on Android 12+ and the opaque bar on Android 11, Reduce
Transparency and Reduce Motion, and scrolling with the blur on a low-end
Android phone.
