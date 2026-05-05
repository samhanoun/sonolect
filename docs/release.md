# Sonolect release, packaging, and installer QA

This project keeps release validation CI-friendly and PR-safe: macOS and Windows jobs build unsigned native packages by default, while signing and updater credentials are optional secrets for protected release branches/tags.

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

## Optional signing and updater readiness

No secret is required for pull requests. For signed release builds, define only on protected environments/branches:

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

## Manual installer QA checklist

Before publishing a release:

1. Download CI artifacts for macOS and Windows.
2. Install on a clean VM/user account.
3. Launch Sonolect and verify the main window opens to the dashboard.
4. Exercise the command palette (`⌘K`/keyboard equivalent), settings navigation, and transcript editor.
5. Confirm the voice capture button requests microphone permission and handles denial gracefully.
6. If a local Whisper command is configured, record a short clip and confirm a local transcript is produced.
7. If backend API is configured, confirm an audio job is created and the binary upload completes.
8. Confirm app version shown by the installer/artifact matches the release tag.
9. For signed releases, verify platform signature/notarization status before publication.
10. For updater-enabled releases, publish update metadata only after installer smoke tests pass.
