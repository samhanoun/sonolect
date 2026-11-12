# Sonolect mobile release

What a store build of the mobile app (`apps/mobile`) needs, and what the
owner must provide. The app is the phone-only build: `API_FEATURES_ENABLED`
is `false` in `apps/mobile/src/features.ts`, so it talks to no Sonolect
server.

## Environment variables

`apps/mobile/app.config.js` reads these through
`apps/mobile/config/release.cjs`. Nothing in the repo or in CI sets them.

| Variable                      | Used for                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SONOLECT_PRIVACY_POLICY_URL` | The hosted privacy policy. Settings and the onboarding card link to it. It must be an `https://` URL. Unset, the app shows no link.                            |
| `SONOLECT_RELEASE`            | Set it to `1` for a release built without EAS (a local `expo prebuild` or archive). It makes the policy URL required.                                          |
| `EAS_BUILD_PROFILE`           | Set by EAS Build, not by you. The `production` profile counts as a release build, so it needs the policy URL too. Other profiles (preview, development) don't. |

Development builds, `expo start`, the web export and the CI jobs run without
these variables. They build normally and show no policy link.

## Why a release build fails without the policy URL

The app records the microphone and can hand audio to the system speech
service, so both stores require a privacy policy inside the app:

- App Review Guideline 5.1.1(i): a link to the privacy policy in App Store
  Connect and within the app, easy to find.
- Google Play User Data policy: a privacy policy in the Play Console and
  inside the app, for an app that uses the microphone.

A release build without the URL would be rejected, and a placeholder URL
would be a broken link. So `config/release.cjs` stops the build instead,
with this message:

```text
SONOLECT_PRIVACY_POLICY_URL is required for release builds (App Review 5.1.1(i), Google Play User Data policy). See docs/mobile-release.md.
```

A URL that is not `https://` stops every build, release or not:
`SONOLECT_PRIVACY_POLICY_URL must be an https:// URL`.

## Setting the policy URL

- **EAS Build**: add `SONOLECT_PRIVACY_POLICY_URL` to the EAS production
  environment with `eas env:create`, with plain-text visibility: the URL is
  public, and `eas build` reads `app.config.js` on your computer before the
  upload, which secret variables are not available to. It reads it again on
  the build server. The production build profile in `eas.json` must use the
  production environment (`"environment": "production"`). Because the value
  is public, the profile's `env` in `eas.json` also works.
- **Local release build**: export both variables in the shell that runs
  `expo prebuild` and the native build (`./gradlew bundleRelease`,
  `xcodebuild archive`, `expo run:android --variant release` or
  `expo run:ios --configuration Release`). The native build is when
  `expo-constants` reads the config and puts it into the app, so the URL
  must be set then. Expo also reads `.env` files in `apps/mobile`, which git
  ignores. An archive started from the Xcode app does not see variables
  exported in a terminal, so use a `.env` file there.
- **Check**: in `apps/mobile`, run
  `SONOLECT_RELEASE=1 pnpm exec expo config --type public --json` with the
  URL set. `extra.privacyPolicyUrl` must show it. Without the URL the command
  fails with the message above.

The URL is built into the app. Changing it needs a new build.

## What the owner must provide

The code side is done in the repo. These need the owner's accounts, keys or
decisions.

### Privacy policy

1. Write the policy for the phone-only build. It must say that notes stay on
   the phone, and that dictation runs on the device or through Apple's or
   Google's speech service: always with _Standard_, and with _Local first_
   or _Ephemeral_ only with the user's consent. It must say that
   there are no Sonolect servers in this build, explain _Erase all data_,
   and give a contact.
2. Host it at an `https://` URL.
3. Set `SONOLECT_PRIVACY_POLICY_URL` in the EAS production environment
   (`eas env:create`), and in CI if CI ever builds releases.
4. Use the same URL in App Store Connect and in the Play Console.

### Store privacy declarations

1. Fill in Play Data safety and the App Store App Privacy labels (see below).
   With the API off, the developer receives no data.
2. Decide, with legal advice if needed, how to declare the hand-off of audio
   to the OS speech service (Google or Apple).

### Android upload key and Google Play

1. Create the upload key once and keep it out of git:
   `keytool -genkeypair -v -storetype PKCS12 -keystore sonolect-upload.p12 -alias sonolect-upload -keyalg RSA -keysize 4096 -validity 10000`.
2. Either let EAS hold it (`eas credentials`, the recommended route), or
   store it as CI secrets for a Gradle signing route (base64 keystore, store
   password, key alias, key password).
3. Create the Play Console app `com.sonolect.app` and enrol in Play App
   Signing. Upload the first AAB to the internal testing track.

### Apple developer account and App Store Connect

1. Enrol in the Apple Developer Program and share the Team ID.
2. Create the App Store Connect record for `com.sonolect.app` and a
   TestFlight internal group.
3. Let EAS manage certificates and profiles (`eas credentials`).

### Versioning

1. Use EAS remote versioning, and set the starting build numbers with
   `eas build:version:set`.
2. Raise the build number for every upload of a local archive.

### EAS project

1. `eas login`, then `eas init` in `apps/mobile`. Commit the `projectId` and
   `owner` it adds.
2. Run a preview build per platform (`eas build --profile preview`). The iOS
   build is also the compile check for the `expo-speech-recognition` patch.

### Real-device tests

1. Run the device test matrix of the 2026-11 phone-readiness fix plan on
   real Android phones and iPhones, and report failures.

## Store privacy declarations: what the build does

Facts for Play Data safety and App Store App Privacy. They describe this
phone-only build; turning the API back on changes them.

- **No Sonolect servers.** The build has no account, no analytics, no crash
  reporting and no ads. No transcript, note, dictionary entry or recording is
  sent to the developer.
- **Microphone audio** goes to the speech recognizer of the phone:
  - on the device, when the phone can recognize the chosen language there;
  - otherwise to the system speech service (Apple Speech on iOS, the Android
    system recognizer, usually Google's), which may send the audio to Apple
    or Google. With privacy set to _Standard_ this is always the route. With
    _Local first_ or _Ephemeral_ it happens only after the user agrees, for
    one dictation or with _Use the system speech service_ turned on in
    Settings.
- **Notes, dictionary and snippets** stay on the phone (AsyncStorage).
  Android backups are off (`allowBackup: false`). _Ephemeral_ saves nothing.
  _Clear history_ and _Erase all data_ delete them.
- **Recordings** are not kept: each one is deleted once read, and leftovers
  in the app cache are deleted at the next start.
- **Read aloud** uses the phone's voices. Android voices that need the
  network are not offered.
- **Copy, Share and Export** happen only when the user taps them, and go to
  the app the user picks.
- **Permissions**: microphone (`RECORD_AUDIO` on Android), and on iOS
  microphone and speech recognition, with English and French prompts.

Open question for the owner: whether the hand-off of audio to the OS speech
service counts as data collected or shared on either form. The developer
never receives that audio; Apple or Google process it under their own terms,
and in _Local first_ and _Ephemeral_ only with the user's consent.
