# Sonolect mobile

Expo SDK 58 app (React Native 0.88, React 19.3, New Architecture) for iOS and
Android: capture → refine → library, plus a text-to-speech reader, dictionary,
snippets and privacy controls. Design: the "Night" variant of the desktop
Studio palette (forest `#1F3429`, lime `#DDF39A`), drawn as glass (see
[Mobile glass](../../docs/design-system.md#mobile-glass)).

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
- **Refinement** runs on the phone for _Clean up_, _Summarize_ and _Tasks_
  (filler removal, casing, dictionary, snippets, summary, task list): no
  text leaves the phone for them. _Rewrite_ and _Reply_ need a language
  model. They appear only once the user sets up online editing with their
  own provider key (see [Online editing](#online-editing)), and Sonolect
  asks before each note is sent. The app never invents text on its own.
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
  and reads it again at the next launch. When the settings can't be read,
  the app saves no new note and syncs nothing until settings are saved, so
  a choice such as _Ephemeral_ still holds; edits, pins and deletes of the
  notes already saved are kept. Settings whose value is broken stay unread
  at each launch until then (`createSettingsStore` in
  `src/storageCore.ts`).
  _Clear history_ with sync on also deletes on the other devices the notes
  it could not read. Choosing _Ephemeral_ or turning history off deletes
  the stored notes, after a confirmation that says how many. On Android
  the AsyncStorage database may grow to 64 MB
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

## End-to-end encrypted sync

Notes sync between the user's own devices through `packages/sync-core`, with
no account: a random 32-byte key, shared by QR code or a typed code. The
server stores only ciphertext. Recordings don't sync (the phone keeps none).

- **Segments**: a dictation sends its segments with it, so the desktop gets
  when each part was said and its studio can save the note's subtitles. A
  segment the phone's clock timed carries `approx: true`, which sync-core
  and the desktop keep like any field they do not know. The desktop's
  studio marks the parts it timed by estimate the same way. The phone shows
  a synced note's segments (without speakers) for its _Subtitles_ when they
  all fit its limits (2,000 segments, 200,000 characters, six hours), and
  none otherwise. A note of 0 ms, such as a typed note, or one whose
  segments all last 0 ms, shows none either. The phone never changes a
  synced note's segments: a refine changes the refined text only, and
  another device's segments go back as they came.

- **Off unless the build sets a server**: `EXPO_PUBLIC_SONOLECT_SYNC_URL`
  (`src/features.ts`, checked by `config/release.cjs`). It must be https;
  development builds may also use `http://127.0.0.1`, `http://localhost` or,
  from the Android emulator, `http://10.0.2.2`. A build bundled for
  production (an EAS `preview` build, a release variant) needs https too:
  its config check fails on plain http, which the app would ignore. Without
  it, and on the web, the app shows no sync and makes no sync request. It
  does not depend on `API_FEATURES_ENABLED`.
- **Settings › Sync** turns sync on (QR code and the 56-character code),
  joins with a code, shows the code again and turns sync off (keeping or
  deleting the server copy). The camera app opens the QR code's link,
  `sonolect://sync/join?v=1&k=…`, on `app/sync/join.tsx`, which asks first.
  Every screen with a code says that joining shares every note with
  whoever holds it.
- **Code** (`src/sync/`): `keyStore.ts` keeps the key in SecureStore
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); `noteStore.ts` and `noteMapping.ts`
  map notes to note/1, keeping other devices' fields whole in
  `sonolect.mobile.sync.note.<id>` (split over `<key>~1`… past 1.5 MB);
  `transport.ts` is `fetch` with a 30 s timeout (plus a second per 32 KiB
  sent) and size caps (an answer up to a full page of changes, sync-core's
  `MAX_RESPONSE_BYTES`);
  `keptDeletes.ts` keeps the deletes not uploaded yet when the sync state
  is forgotten (sync turned off with the server copy kept, history turned
  off, notes cleared on this phone), and the next engine of that vault
  sends them; `controller.ts` syncs at launch, in the
  foreground, about 5 s after a change and every 2 minutes, backing off on
  errors. `src/store.ts` stamps each create, edit, refine and pin, and sends
  a delete for a note's _Delete_ and _Clear history_; retention never does.
  _Erase all data_ also forgets the key and the sync state, and offers to
  delete the server copy first.
- **Against a real server**: start `services/sync-service` with
  `SONOLECT_SYNC_STORE=memory PORT=8713`, then run
  `pnpm dlx tsx@4.19.2 src/sync/liveCheck.ts http://127.0.0.1:8713` here:
  two phones in memory send a note, an edit and a delete to each other.

## Phone-only build

This build runs entirely on the phone. The switch is `API_FEATURES_ENABLED`
in `src/features.ts`, and it is `false`.

- **Works**: on-device dictation, the library on the phone, local clean-up,
  Summary, Tasks, the Reader, export (Markdown, plain text or JSON),
  subtitles of a dictated note (SRT or WebVTT, timed by the recognizer where
  it reports word times and by the app's clock otherwise; the WebVTT file
  says when the times are approximate; the clean-up runs over the whole
  dictation, so a sentence or a dictionary phrase that goes on into the next
  cue reads as it does in the note), Copy with the note's paragraphs and lists kept, and automatic
  deletion of old notes (Settings, _Keep notes for_).
- **Hidden**: the API's plaintext sync, _Rewrite_ and _Reply_ through the
  API, audio upload, and
  the Settings API section (URL, token, connection test). The library shows
  no LOCAL / QUEUED / SYNCED labels. _Rewrite_ and _Reply_ through online
  editing do not use the API, so they work in this build.
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

## Online editing

_Rewrite_ and _Reply_ can use a language model with the user's own key, the
same way the desktop Studio does: OpenRouter or OpenCode Zen. The phone
calls the provider directly. No Sonolect server and no Sonolect account are
involved, and the provider bills the user's own account.

- **Off by default.** The chips stay hidden until the user picks a provider
  and a model and saves a key in Settings, _Online editing_. The web
  preview keeps no keys, so there the section is shown with its controls
  disabled.
- **Asks before each note.** A tap on _Rewrite_ or _Reply_ opens a dialog
  that names the provider and the model. Only _Send_ sends the note, and
  only to the provider and model the dialog named. The switch _Send without
  asking each time_ skips the dialog, except in _Ephemeral_, which always
  asks. A note made in _Ephemeral_ is still asked for after the user leaves
  it. Picking another provider turns the switch off again.
- **What is sent.** The text of that one note, after the phone has applied
  the dictionary and snippets, with a fixed instruction for the mode and
  the dictation language. Never the audio, the times of a dictation's
  parts, other notes or the dictionary itself. Notes over 12,000
  characters, or with no text left once cleaned up, are not sent, and the
  app does not ask for them.
- **The key** is kept in SecureStore (iOS Keychain or Android Keystore)
  with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, one item per provider
  (`sonolect.mobile.providerKey.openrouter` and `.opencode`). It stays on
  this phone and is not copied to another phone. On iOS such an item can
  be in a backup of the same phone; Android backups are off
  (`allowBackup: false`). The key is read at launch, only to learn whether
  one is saved (kept as a yes or no), and again when a note is sent. It is
  never kept in app state, AsyncStorage, notices or logs, and Settings only
  shows _Key saved_. _Erase all data_ deletes both keys, and a first launch
  without settings deletes keys an earlier install left in the iOS
  keychain.
- **The model list** is the provider's public catalog. It loads only when
  the user taps _Load models_, and that request carries no key and no note.
  Nothing goes out at launch.
- **Results and failures.** The result replaces the note's text and keeps
  the original, so _Clean up_ brings it back. With sync on, the edited note
  syncs to the user's other devices like any other edit. A dictation keeps
  its segments as they are. They still say the original words, so its
  _Subtitles_ show what was said, and they sync with the original, not
  with the model's text. A rejected key, missing credits, a rate limit, an
  unknown model, a timeout (60 seconds) or no network shows a notice, and
  the note does not change. If the note's text changes while the provider
  answers (an edit on this phone, or a newer version from another device),
  the answer is not used: the newer text stays, and a notice says so.
  Redirects are refused, and the provider's error text is never shown.
- **Code**: `src/onlineRefine.ts` (endpoints, prompts and checks that mirror
  `apps/desktop/src-tauri/src/online.rs`), `src/onlineEdit.ts` (consent
  plan and one send, tested with a mocked fetch), `src/providerKeys.ts`
  (SecureStore items) and `src/ui/OnlineEditingSection.tsx` (Settings).

## Run it

`expo-speech-recognition` is a native module, so use a development build
(Expo Go can't load it; the app then falls back to typed input):

```bash
pnpm --filter @sonolect/mobile exec expo prebuild
pnpm --filter @sonolect/mobile exec expo run:android   # or run:ios on macOS
```

Browser preview (uses the Web Speech API where the browser has it; Export
downloads the file. A note's Share button opens the browser's share dialog
where there is one. Where there is none, as in Firefox, Chrome on Linux or a
page served over plain http, it reads Download and saves the note as a text
file, and so does a browser that refuses to open its dialog, such as in a
frame without `allow="web-share"`):

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

`patches/expo-speech-recognition@58.0.1.patch` (applied by pnpm through
`patchedDependencies` in the root `package.json`) makes on-device recognition
fail closed on iOS, adds `supportsOnDeviceRecognitionForLocale`, and keeps
transcript text out of the Android log. It is tied to that exact version.
When `expo install --fix` moves `expo-speech-recognition` to a new version,
pnpm stops with `ERR_PNPM_PATCH_NOT_APPLIED` and changes nothing. Then make
the patch again:

1. Remove the `expo-speech-recognition@58.0.1` entry from
   `pnpm.patchedDependencies` in the root `package.json`. Keep the old patch
   file for now, and run `pnpm exec expo install --fix` again.
2. Run `pnpm patch expo-speech-recognition@<new>`, and in the folder it
   prints make the changes of the old patch again: the iOS fail-closed
   on-device check and `supportsOnDeviceRecognitionForLocale` (Swift), and
   the Android log change (Kotlin).
3. Run `pnpm patch-commit <folder>`. It writes
   `patches/expo-speech-recognition@<new>.patch` and adds its
   `patchedDependencies` entry. Delete the old patch file.

Do not drop the patch. The app still runs without it (`src/speech.ts` checks
for `supportsOnDeviceRecognitionForLocale`), but an iOS dictation that asks
for on-device recognition could then go to Apple's servers, and the Android
library writes transcripts to its debug log again. CI's
`Mobile iOS build (simulator, unsigned)` job compiles the Swift part.
