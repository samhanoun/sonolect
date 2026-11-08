# Sonolect mobile

Expo (SDK 52) app for iOS and Android: capture → refine → library, plus a
text-to-speech reader, dictionary, snippets and privacy controls. Design: the
"Night" variant of the desktop Studio palette (forest `#1F3429`, lime `#DDF39A`).

## How it works

- **Speech to text** uses `expo-speech-recognition` (Apple Speech on iOS,
  Android SpeechRecognizer). With privacy set to *Local first* or *Ephemeral*,
  the app asks for on-device recognition; when the phone can't do that, the
  capture screen says the system speech service is used.
- **Refinement** runs locally (filler removal, casing, dictionary, snippets,
  summary, task list). *Rewrite* and *Reply* need a model, so they only produce
  real output when the Sonolect API (`/v1/polish`) is configured. Without it the
  app cleans the text and tells the user so; it never invents text.
- **Sync** (optional): set an API URL in Settings and turn on sync. Only
  `https://` URLs, or `http://` on localhost / private LAN, are accepted. The
  optional access token is stored in SecureStore (Keychain/Keystore).
- **Storage**: settings, history (up to 100 items), dictionary and snippets in
  AsyncStorage. *Ephemeral* mode and turning history off delete stored history.

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
