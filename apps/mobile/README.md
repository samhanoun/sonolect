# Sonolect mobile

Expo SDK 58 app (React Native 0.88, React 19.3, New Architecture) for iOS and
Android: capture → refine → library, plus a text-to-speech reader, dictionary,
snippets and privacy controls. Design: the "Night" variant of the desktop
Studio palette (forest `#1F3429`, lime `#DDF39A`).

## How it works

- **Speech to text** uses `expo-speech-recognition` (Apple Speech on iOS,
  Android SpeechRecognizer). With privacy set to _Local first_ or _Ephemeral_,
  dictation runs on the device when the phone can do it for the chosen
  language. Otherwise Sonolect asks before using the system speech service,
  which may send the audio to Apple or Google, unless the user turned on
  _Use the system speech service_ in Settings. _Standard_ always uses the
  system speech service, and Settings and the capture screen say so.
- **Long dictations**: below Android 13 the recognizer ends at every pause,
  and Apple's server recognizer ends after about a minute. The capture loop
  (`src/captureLoop.ts`) starts it again and keeps all the text, until Done,
  an error, 10 minutes or about 9 seconds without speech. Below Android 13,
  expect the system start and stop sound at each restart: the workaround in
  the `expo-speech-recognition` README only works on Android 13+. The screen
  stays on while dictating; leaving the app stops the dictation and keeps
  its text.
- **Refinement** is local only in this build (filler removal, casing,
  dictionary, snippets, summary, task list): no text leaves the phone for it.
  _Rewrite_ and _Reply_ need a model on the Sonolect API (`/v1/polish`), so
  the phone-only build does not offer them. The app never invents text.
- **Sync** is off in the phone-only build (see below): notes stay on the phone
  and nothing is sent to a Sonolect API. With the API turned back on, sync
  needs an API URL in Settings (`https://`, or `http://` on localhost / private
  LAN) and the sync switch. The optional access token is then kept in
  SecureStore (Keychain/Keystore), on this device only and outside backups.
- **Storage**: settings, notes, dictionary and snippets in AsyncStorage, one
  key per note and no limit on how many are kept (`src/storageCore.ts`). No
  recordings are kept: each one is deleted once read, and what is left in
  the app cache is deleted at each start, on _Clear history_ and on _Erase
  all data_. A value that can't be read is never deleted: the app says so
  and reads it again at the next launch. Choosing _Ephemeral_ or turning
  history off deletes the stored notes, after a confirmation that says how
  many. On Android the AsyncStorage database may grow to 64 MB
  (`plugins/withAsyncStorageSize.js`).
- **Languages**: on a first run (and after _Erase all data_) the app
  language and the dictation language follow the phone's preferred
  languages (`src/firstRun.ts`). The iOS microphone and speech prompts are
  translated in `locales/fr.json`. The layout stays left-to-right on phones
  set to a right-to-left language, because the app has no right-to-left UI
  yet (`expo-localization` plugin, `supportsRTL: false`).
- **Privacy policy**: Settings and the onboarding card link to the policy at
  `SONOLECT_PRIVACY_POLICY_URL`. Development builds may leave it unset and
  show no link; release builds fail without it (`config/release.cjs`, see
  [docs/mobile-release.md](../../docs/mobile-release.md)).

## Phone-only build

This build runs entirely on the phone. The switch is `API_FEATURES_ENABLED`
in `src/features.ts`, and it is `false`.

- **Works**: on-device dictation, the library on the phone, local clean-up,
  Summary, Tasks, the Reader and export.
- **Hidden**: sync, _Rewrite_ and _Reply_ through the API, audio upload, and
  the Settings API section (URL, token, connection test). The library shows
  no LOCAL / QUEUED / SYNCED labels.
- **Ignored**: a saved API URL and `EXPO_PUBLIC_SONOLECT_API_URL`. Every API
  call gets its config from `apiConfig()` in `src/features.ts`, which returns
  no URL while the switch is off.
- **Upgrading** from a build with sync keeps every note: queued notes become
  local, sync is turned off and the API URL is removed. A stored access token
  is deleted at every start.

The API code (`src/localApi.ts`, `src/audioCapture.ts`) still compiles and its
tests still run, so the switch can be turned back on.

### Before turning the API back on

The phone-only build cannot reach these findings from the 2026-11-08
phone-readiness audit, so they are parked here. Fix them first:

- [ ] android-1, ios-3: cleartext HTTP to a LAN API is blocked in release
      builds.
- [ ] security-1: LAN API mode sends the access token, transcripts, dictionary
      and raw audio unencrypted, with no warning or opt-in.
- [ ] security-11: LAN API mode triggers the iOS Local Network alert at launch
      with no purpose string.
- [ ] security-7: the `http://` private-address check accepts public DNS names
      that merely start with a private prefix.
- [ ] data-3: the startup merge with the API drops phone notes that have not
      reached the server.
- [ ] data-5: API calls have no timeout, and notes are written to disk only
      after every queued upload finishes.
- [ ] data-6: deleting, clearing or refining a note is never sent to the API,
      so deleted notes come back and refines duplicate.
- [ ] data-7: overlapping sync passes upload the same note several times, and
      startup sync undoes recent changes.
- [ ] data-8: the repo's API server binds 127.0.0.1 in development and requires
      Firebase ID tokens otherwise, so a phone cannot use it.
- [ ] data-9: audio sent to the API is saved as a "Transcribing on the
      Sonolect API…" note that is never replaced.
- [ ] data-10: Rewrite and Reply call the API only when sync is on, and the
      user is told to connect an API that is already connected.
- [ ] data-11: the connection test says "Connected." for servers that reject
      every request, and sync failures are never shown.
- [ ] data-12: the API URL allow-list accepts public hosts that start with
      private-IP digits and rejects common LAN/VPN addresses.
- [ ] speech-8: recorded audio is read fully into JS and base64-encoded twice
      for upload; iOS files are 48 kHz float32 (~11.5 MB/min).
- [ ] speech-10: audio upload has no timeout, so PROCESSING can hang for
      minutes with the mic button disabled and no Cancel.
- [ ] ux-8: with sync on, deleting a note or clearing history only affects the
      phone, and the next launch downloads the deleted notes again.
- [ ] ux-9: a saved API URL is ignored unless the separate sync switch is on,
      while "Test connection" reports success.
- [ ] ux-24: the English placeholder "Transcribing on the Sonolect API…" is
      saved as the note's text.
- [ ] ux-27: processing and refining have no timeout or cancel on a slow or
      unreachable API.
- [ ] ios-8: iOS recordings are WAV bytes in a .caf file, uploaded as
      audio/x-caf. (They are now deleted once read, see speech-7.)
- [ ] data-2: ask the server for pages of at most 100 notes (the API rejects
      a larger `limit`) and follow `nextCursor`. `mergeTranscriptHistory`
      still keeps only the newest 100 notes, and the next save deletes the
      others from the phone: remove that cap.
- [ ] security-6: run notes from the API through `sanitizeTurn`
      (`src/storageCore.ts`) before they reach the history. Saving already
      cleans them, but the screens render them first.
- [ ] security-8: add the reinstall marker. At startup, when both
      `sonolect.mobile.installed` and the settings key are missing from
      AsyncStorage, delete the SecureStore token, then write the marker. A
      token found at startup should also be saved once more, so it gets the
      `WHEN_UNLOCKED_THIS_DEVICE_ONLY` class (`saveApiToken` deletes and
      re-creates the item with it).
- [ ] security-4: split the sync switch into "Sync transcripts" and "Upload
      audio for cloud transcription", say in Settings that the API refines
      text with Google Vertex AI Gemini, and ask before turning sync on
      uploads the existing notes. Update the privacy copy and
      `docs/mobile-release.md` (store declarations, privacy policy) to match.
- [ ] ux-22: the API URL placeholder `https://api.example.com` suggests a
      public cloud URL (use a LAN example such as `http://192.168.1.20:8080`),
      and the token placeholder `••••••••` looks like a saved token (use an
      i18n "Optional").

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
