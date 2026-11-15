# Sonolect mobile

Expo SDK 58 app (React Native 0.88, React 19.3, New Architecture) for iOS and
Android: capture → refine → library, plus a text-to-speech reader, dictionary,
snippets and privacy controls. Design: the "Night" variant of the desktop
Studio palette (forest `#1F3429`, lime `#DDF39A`).

## How it works

- **Speech to text** uses `expo-speech-recognition` (Apple Speech on iOS,
  Android SpeechRecognizer). With privacy set to _Local first_ or _Ephemeral_,
  the app asks for on-device recognition; when the phone can't do that, the
  capture screen says the system speech service is used.
- **Refinement** runs locally (filler removal, casing, dictionary, snippets,
  summary, task list). _Rewrite_ and _Reply_ need a model, so they only produce
  real output when the Sonolect API (`/v1/polish`) is configured. Without it the
  app cleans the text and tells the user so; it never invents text.
- **Sync** (optional): set an API URL in Settings and turn on sync. Only
  `https://` URLs, or `http://` on localhost / private LAN, are accepted. The
  optional access token is stored in SecureStore (Keychain/Keystore).
- **Storage**: settings, history (up to 100 items), dictionary and snippets in
  AsyncStorage. _Ephemeral_ mode and turning history off delete stored history.

## Run it

`expo-speech-recognition` is a native module, so use a development build
(Expo Go can't load it; the app then falls back to typed input):

```bash
pnpm --filter @sonolect/mobile exec expo prebuild
pnpm --filter @sonolect/mobile exec expo run:android   # or run:ios on macOS
```

Browser preview (uses the Web Speech API where the browser has it):

```bash
pnpm --filter @sonolect/mobile web
```

Checks: `pnpm --filter @sonolect/mobile typecheck` and `pnpm --filter @sonolect/mobile test`.

## Upgrading Expo

Expo pins the versions of `expo-*`, `react-native*` and React for each SDK, so
Dependabot ignores them (see `.github/dependabot.yml`). Upgrade them together:

```bash
cd apps/mobile
pnpm add expo@~<sdk>.0.0
pnpm exec expo install --fix
```

Then keep the desktop app on the same React version, and run the typecheck,
tests, `expo prebuild --no-install --clean` and a release bundle before opening
the PR. CI installs the Android SDK, build-tools and NDK versions that React
Native's `gradle/libs.versions.toml` asks for, so it needs no edit.

`expo-router` depends on `react-native-drawer-layout`, which asks for
Reanimated and Gesture Handler. The app uses neither, so the root
`package.json` removes them with pnpm overrides. Without that, pnpm installs
an old Reanimated that Expo autolinks into the Android build.
