# Sonolect release, packaging, and installer QA

This project keeps release validation CI-friendly and PR-safe: macOS and Windows jobs build unsigned native packages by default, while signing and updater credentials are optional secrets for protected release branches/tags.

Only the native installers ship. The browser preview of the desktop Studio (`pnpm --filter @sonolect/desktop dev`) is a developer tool. It is not packaged or hosted. Outside one developer setup with a Sonolect API, it cannot record or transcribe ([voice-capture-device-readiness.md](voice-capture-device-readiness.md#browser-preview)).

## Versioning

- Keep these versions identical for every release:
  - `package.json` `version`
  - `apps/desktop/package.json` `version`
  - `apps/desktop/src-tauri/tauri.conf.json` `version`
- Validate alignment locally with:

```bash
npx --yes pnpm@9.15.0 test:release-readiness
```

## Package validation in CI

The `Release package validation` job in `.github/workflows/ci.yml` runs on:

- `macos-latest`: `pnpm --filter @sonolect/desktop tauri build --bundles dmg`
- `windows-latest`: `pnpm --filter @sonolect/desktop tauri build --bundles nsis,msi`

The jobs then perform installer sanity checks:

- macOS: verifies a non-empty `.dmg` exists, runs `hdiutil verify`, and attempts `codesign --verify` while accepting unsigned PR artifacts.
- Windows: verifies non-empty `.msi`/`.exe` installers exist and prints `Get-AuthenticodeSignature` output without failing unsigned PR artifacts.
- Both platforms upload short-retention artifacts for manual QA.

Linux `.deb` and `.AppImage` are already covered by the existing desktop Tauri build path.

After its build, each job also runs the speaker detection tests (`speakers`, `fbank`, `model_download`), including the ones that need the speaker model, with `cargo test --release` and the same `tauri/custom-protocol` feature as the build. Its compiled dependencies are reused, so this is much cheaper than a separate test job: on Linux, the test build after a release build took 19 s, and the 28 tests 4 s. It matters because tract chooses its SIMD code per CPU, and only Ubuntu runs Rust tests otherwise.

## Note sync in release builds

Sync is compiled in but hidden unless the build sets `SONOLECT_SYNC_URL`, the `https://` URL of the hosted sync server ([sync-setup.md](sync-setup.md)). Both the webview build (`apps/desktop/vite.config.ts`) and the Rust build (`option_env!` in `apps/desktop/src-tauri/src/sync.rs`) read it at build time, so set it in the environment of the whole `tauri build`. A release build ignores a URL that is not https and then has no sync. The URL is public, so a repository variable is enough: to ship sync from CI, add `SONOLECT_SYNC_URL: ${{ vars.SONOLECT_SYNC_URL }}` to the `env` of the release job. Today's `Release package validation` job builds without it, so its packages have no sync.

The phone reads `EXPO_PUBLIC_SONOLECT_SYNC_URL` instead; see [mobile-release.md](mobile-release.md). All devices that should sync together need builds with the same server.

## Downloadable models

The installers ship no model. The app downloads two, each only when the user asks, and only into its local data folder (`models/`):

| Model                                                                                                | Size              | Where the pin is                                            | Asked for                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Whisper Base (`ggml-base.bin`)                                                                       | 147,951,465 bytes | `MODEL` in `apps/desktop/src-tauri/src/local_engine.rs`     | Settings                                   |
| Speaker model, CAM++ from 3D-Speaker (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`) | 28,281,165 bytes  | `SPEAKER_MODEL` in `apps/desktop/src-tauri/src/speakers.rs` | Settings, or the first **Detect speakers** |

Each pin is a `PinnedModel`: the URL, the size and the SHA-256. A download that does not match both is thrown away, and the speaker model is checked again before every load.

The speaker model URL today is the sherpa-onnx release on GitHub: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` (the upstream tag really is spelt `recongition`). To serve it from a mirror, such as an asset on a release of this repository:

1. Upload the exact same file. Check it first: `sha256sum` must print `53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b`.
2. Change only `url` in `SPEAKER_MODEL`. Keep `sha256` and `size`: they pin the file, not the host.
3. CI reads the URL and the SHA-256 from that constant (the `Find the pinned speaker model` steps in `.github/workflows/ci.yml`), so its model tests then download from the mirror too.

A new model file is a different change: it needs a new `sha256` and `size`, new reference fixtures (`apps/desktop/src-tauri/fixtures/make-speaker-fixtures.py`) and a check of its licence.

Before the first release with speaker detection, confirm that the model's licence allows redistribution if it is mirrored. The 3D-Speaker code is Apache-2.0; the model card on modelscope.cn could not be checked when the feature was built.

## Optional signing and updater readiness

No secret is required for pull requests. PR package validation remains unsigned and the `Release readiness dry-run validation` step runs `pnpm release:dry-run` without exporting signing secrets. For signed release builds, define secrets only on protected environments/branches:

- Tauri/updater:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - `TAURI_UPDATER_PRIVATE_KEY`
  - `TAURI_UPDATER_PRIVATE_KEY_PASSWORD`
- Apple notarization/signing:
  - `APPLE_CERTIFICATE`
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_SIGNING_IDENTITY`
  - `APPLE_ID`
  - `APPLE_PASSWORD`
  - `APPLE_TEAM_ID`

Keep secret values redacted in logs and never commit generated keys/certificates.

## Updater manifest checklist

Tauri updater metadata is configured in `apps/desktop/src-tauri/tauri.conf.json` with a public update endpoint at `https://github.com/samhanoun/sonolect/releases/latest/download/latest.json`. Updater artifact generation is disabled by default so local and PR builds stay unsigned/secret-free; protected release jobs must explicitly enable it with Tauri `--config` after loading the real signing private key. Before publishing an updater-enabled release:

- Generate signed updater artifacts on a protected release runner; do not generate or expose private keys in PR jobs.
- Publish `latest.json` only after installer smoke tests pass.
- Confirm manifest `version` exactly matches the release tag and all package config versions.
- Confirm `pub_date` is an ISO-8601 timestamp for the release publication time.
- Confirm every platform entry points to the final downloadable installer/archive and includes the updater `signature` generated by Tauri.
- Confirm rollback/re-publish behavior is understood before replacing an existing `latest.json`.

## Manual installer QA checklist

Before publishing a release:

1. Download CI artifacts for macOS and Windows.
2. Install on a clean VM/user account.
3. Launch Sonolect and verify the main window opens to the dashboard.
4. Exercise the command palette (`⌘K`/keyboard equivalent), settings navigation, and transcript editor.
5. Confirm the voice capture button requests microphone permission and handles denial gracefully.
6. If a local Whisper command is configured, record a short clip and confirm a local transcript is produced.
7. If backend API is configured, confirm an audio job is created and the binary upload completes.
8. Sync: in a build with `SONOLECT_SYNC_URL`, Settings shows **Sync between devices**; turn sync on, pair a second device with the code and confirm that a note, an edit and a delete reach it ([sync-setup.md](sync-setup.md#10-pair-two-devices)). In a build without it, Settings shows no sync section.
9. Confirm app version shown by the installer/artifact matches the release tag.
10. For signed releases, verify platform signature/notarization status before publication.
11. For updater-enabled releases, publish update metadata only after installer smoke tests pass.
12. Speaker detection, on Windows, macOS and Linux: open a saved recording of an hour or so with several voices, choose **Segments**, then **Detect speakers**. Confirm the download question gives the size, that the status line shows progress, that **Cancel** stops it and changes no names, even when pressed at 99%, and note the time taken and the app's peak memory. For comparison, `sonolect_desktop --detect-speakers` took about 41 s and 141 MB of memory for 59 minutes of audio on 4 Linux cores. Rename a speaker in the legend, save, and check that an export carries the names.
