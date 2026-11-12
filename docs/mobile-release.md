# Sonolect mobile release

What a store build of the mobile app (`apps/mobile`) needs, and what the
owner must provide. The app is the phone-only build: `API_FEATURES_ENABLED`
is `false` in `apps/mobile/src/features.ts`, so it talks to no Sonolect
server.

## Environment variables

`apps/mobile/app.config.js` reads these through
`apps/mobile/config/release.cjs`. Nothing in the repo or in CI sets them.

| Variable                      | Used for                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SONOLECT_PRIVACY_POLICY_URL` | The hosted privacy policy. Settings and the onboarding card link to it. It must be an `https://` URL. Unset, the app shows no link.                                                                                         |
| `SONOLECT_RELEASE`            | Set it to `1` for a release built without EAS (a local `expo prebuild` or archive). It makes the policy URL and `SONOLECT_BUILD_NUMBER` required. Do not set it in `eas.json`.                                              |
| `SONOLECT_BUILD_NUMBER`       | The build number of a local release archive: it sets `ios.buildNumber` (CFBundleVersion) and `android.versionCode`. A whole number from 1 to 2100000000, raised for every upload. EAS builds use remote versioning instead. |
| `EAS_BUILD_PROFILE`           | Set by EAS Build, not by you. The `production` profile counts as a release build, so it needs the policy URL too. Other profiles (preview, development) don't.                                                              |
| `EAS_BUILD`                   | Set to `true` by EAS Build on its build servers, not by you. There `SONOLECT_BUILD_NUMBER` is not needed, and the `bundleRelease` signing check is skipped.                                                                 |

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
  the build server. The production build profile in `apps/mobile/eas.json`
  uses the production environment (`"environment": "production"`). Because
  the value is public, the profile's `env` in `eas.json` would also work.
- **Local release build**: export `SONOLECT_RELEASE=1`, the URL and
  `SONOLECT_BUILD_NUMBER` (see [Versioning](#versioning)) in the shell that
  runs `expo prebuild` and the native build (`./gradlew bundleRelease`,
  `xcodebuild archive`, `expo run:android --variant release` or
  `expo run:ios --configuration Release`). The native build is when
  `expo-constants` reads the config and puts it into the app, so the URL
  must be set then. Expo also reads `.env` files in `apps/mobile`, which git
  ignores. An archive started from the Xcode app does not see variables
  exported in a terminal, so use a `.env` file there.
- **Check**: in `apps/mobile`, run
  `SONOLECT_RELEASE=1 SONOLECT_BUILD_NUMBER=<n> pnpm exec expo config --type public --json`
  with the URL set. `extra.privacyPolicyUrl` must show it. Without the URL
  the command fails with the message above.

The URL is built into the app. Changing it needs a new build.

## Signing

The Expo template signs release builds with the debug keystore that ships
with every Expo and React Native template. Its private key is public, so
anyone could sign an "update" of `com.sonolect.app` that Android installs
over the real app, with access to its notes. A debug-signed build must never
leave the team, and Google Play refuses it. CI's
`sonolect-android-debug-signed-test-apk` artifact is such a build: internal
testing only. Testers who install it must uninstall it before they can
install a properly signed build, which deletes their notes.

Store builds are signed with the owner's upload key, through one of two
routes. Both are prepared in the repo; EAS is the recommended one.

### Route (a): EAS Build (recommended)

`apps/mobile/eas.json` has two profiles:

- `preview`: internal distribution. Android builds an installable APK, iOS an
  ad hoc build for registered devices.
- `production`: store builds (an Android App Bundle and an iOS archive), with
  remote versioning and the EAS `production` environment.

Steps, in `apps/mobile`:

1. `eas credentials`: for Android, upload the upload key created below
   (Needs owner), or let EAS generate one and enrol it in Play App Signing.
   For iOS, let EAS manage the distribution certificate and the profiles.
2. `eas build --platform all --profile production`.
3. `eas submit --profile production` sends the Android bundle to the
   internal testing track and the iOS build to TestFlight.

EAS signs with the credentials it holds. The `bundleRelease` check of route
(b) is skipped on its build servers (`EAS_BUILD=true`).

### Route (b): Gradle with the upload key

`apps/mobile/plugins/withReleaseSigning.js` adds a block to the generated
`android/app/build.gradle`. It reads four Gradle properties:

| Gradle property               | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `sonolectUploadStoreFile`     | Absolute path of the upload keystore (`.p12` or `.jks`) |
| `sonolectUploadStorePassword` | Keystore password                                       |
| `sonolectUploadKeyAlias`      | Key alias, for example `sonolect-upload`                |
| `sonolectUploadKeyPassword`   | Key password                                            |

Pass them as environment variables (`ORG_GRADLE_PROJECT_sonolectUploadStoreFile`
and so on) or in `~/.gradle/gradle.properties`, never in the repo. When
`sonolectUploadStoreFile` is set, release builds are signed with the upload
key. When it is not, `./gradlew bundleRelease` stops with
`bundleRelease needs the private upload key: ...`, and `assembleRelease`
still builds the debug-signed test APK that CI uses.

A local store bundle, after the variables above are exported:

```bash
cd apps/mobile
SONOLECT_RELEASE=1 SONOLECT_BUILD_NUMBER=<n> pnpm exec expo prebuild --no-install --clean --platform android
cd android && ./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

CI does not build store bundles. To let it, add secrets for the base64
keystore and the passwords, a repository variable for the policy URL, and a
job like this one to `.github/workflows/ci.yml`. Copy the setup steps from
the `mobile-android` job, and protect the secrets with a GitHub environment:

```yaml
mobile-android-store-bundle:
  name: Mobile Android store bundle (upload key)
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: instabox-medium
  timeout-minutes: 60
  environment: release
  env:
    SONOLECT_RELEASE: "1"
    SONOLECT_PRIVACY_POLICY_URL: ${{ vars.SONOLECT_PRIVACY_POLICY_URL }}
    # Must be higher than every build already uploaded.
    SONOLECT_BUILD_NUMBER: ${{ github.run_number }}
  steps:
    # Checkout, Setup pnpm, Setup Node.js, Setup Java, Install dependencies,
    # the Android versions step and Setup Android SDK: as in mobile-android.
    - name: Generate the Android project
      run: pnpm --filter @sonolect/mobile exec expo prebuild --no-install --clean --platform android

    - name: Decode the upload key
      env:
        UPLOAD_KEYSTORE_BASE64: ${{ secrets.SONOLECT_UPLOAD_KEYSTORE_BASE64 }}
      run: echo "$UPLOAD_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP/upload.p12"

    - name: Build the store bundle
      working-directory: apps/mobile/android
      env:
        ORG_GRADLE_PROJECT_sonolectUploadStoreFile: ${{ runner.temp }}/upload.p12
        ORG_GRADLE_PROJECT_sonolectUploadStorePassword: ${{ secrets.SONOLECT_UPLOAD_STORE_PASSWORD }}
        ORG_GRADLE_PROJECT_sonolectUploadKeyAlias: ${{ secrets.SONOLECT_UPLOAD_KEY_ALIAS }}
        ORG_GRADLE_PROJECT_sonolectUploadKeyPassword: ${{ secrets.SONOLECT_UPLOAD_KEY_PASSWORD }}
      run: |
        echo "sdk.dir=$ANDROID_HOME" > local.properties
        ./gradlew bundleRelease --no-daemon

    - name: Upload the store bundle
      uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
      with:
        name: sonolect-android-release-aab
        path: apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
        retention-days: 7
        if-no-files-found: error

    - name: Delete the upload key
      if: always()
      run: rm -f "$RUNNER_TEMP/upload.p12"
```

## Versioning

The user-facing version is `expo.version` in `apps/mobile/app.json`
(`0.2.0`). Each upload to a store also needs a build number higher than the
last one: `versionCode` on Android, `CFBundleVersion` on iOS.

- **EAS builds**: `eas.json` sets `"appVersionSource": "remote"` and
  `"autoIncrement": true` on the production profile. EAS stores the numbers
  and raises them for every production build. Set the starting numbers once
  with `eas build:version:set`, above anything already uploaded. Do not add
  `android.versionCode` or `ios.buildNumber` to `app.json`: EAS ignores them.
- **Local release archives**: set `SONOLECT_BUILD_NUMBER`. `config/release.cjs`
  writes it to `ios.buildNumber` and `android.versionCode`. With
  `SONOLECT_RELEASE=1` outside EAS and no build number, the config fails with
  `Set SONOLECT_BUILD_NUMBER for local release builds (EAS builds use remote versioning)`.
  Check with `SONOLECT_BUILD_NUMBER=7 pnpm exec expo config --type public --json`
  in `apps/mobile`: it shows `"buildNumber":"7"` and `"versionCode":7`.

## How to check a release

- **No transcripts in logcat** (Android): install the release build, run
  `adb logcat -s ExpoSpeechService` and dictate. No dictated text may appear.
  R8 removes `Log.v`, `Log.d` and `Log.i` calls from release builds
  (`plugins/withReleaseLogStripping.js`), and the patched
  `expo-speech-recognition` logs only counts, and only after
  `adb shell setprop log.tag.ExpoSpeechService DEBUG`.
- **Signature** (Android): `apksigner verify --print-certs app-release.apk`,
  or `keytool -printcert -jarfile app-release.aab` for a bundle, shows the
  owner's upload certificate, never `CN=Android Debug`.
- **Permissions**: the merged Android manifest has `RECORD_AUDIO` and no
  `USE_BIOMETRIC` or `USE_FINGERPRINT`; the iOS `Info.plist` has no
  `NSFaceIDUsageDescription`.
- **Native code** (Android): CI checks that its test APK ships only
  `arm64-v8a` libraries, so an x86_64 emulator refuses it with
  `INSTALL_FAILED_NO_MATCHING_ABIS` instead of crashing at launch.

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
   store it as CI secrets for the Gradle route (base64 keystore, store
   password, key alias, key password; see [Signing](#signing)).
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
2. For a local archive, set `SONOLECT_BUILD_NUMBER` and raise it for every
   upload (see [Versioning](#versioning)).

### EAS project

1. `eas login`, then `eas init` in `apps/mobile`. Commit the `projectId` and
   `owner` it adds.
2. Run a preview build per platform (`eas build --profile preview`). CI's
   `Mobile iOS build (simulator, unsigned)` job compiles the
   `expo-speech-recognition` patch for the simulator; the EAS iOS build
   checks a device build too.

### Real-device tests

1. Run the device test matrix of the 2026-11 phone-readiness fix plan on
   real Android phones and iPhones, and report failures.
2. Also run these checks from the review of the fixes:
   - Android 14 on Wi-Fi, _Local first_, language pack missing: tap
     _Download language_, then _Use speech service this time_, say nothing
     and tap _Done_. The screen reads READY with the no-speech notice.
   - A recognizer whose locale query fails: after the failed on-device
     attempt, tap _Download language_. The screen reads READY with the
     download notice.
   - Android 14 on mobile data: _Download language_ reports a scheduled
     download. Join Wi-Fi with Sonolect in front. Once the pack installs, a
     mic tap dictates on the device (lock badge) without leaving the app.
     Repeat on Android 13 after the system dialog, and with _Always allow_
     on.
   - Screen reader on (VoiceOver; TalkBack on Android 13+ and on 11 or 12),
     loudspeaker, no headphones: double-tap the mic, stay silent for 3 s,
     then tap _Done_. Expect the no-speech notice and no new note. Repeat
     while saying one sentence: the note must start with it. If the
     screen reader's words ("Dictation started", "Done" or the French ones)
     appear in a note, the start announcement must finish before the
     microphone opens.

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
