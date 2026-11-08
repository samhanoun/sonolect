# Security scan triage

Baseline triage from the first full SAST/SCA run (2026-11-08). Update this file
when a finding is accepted rather than fixed, with an owner and a review date.

## Fixed in the baseline PR

| Finding                                                                       | Where                                      | Fix                                               |
| ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| PDF.js arbitrary JS execution on malicious PDF (high)                         | `apps/desktop` `pdfjs-dist@5`              | Upgraded to `pdfjs-dist@^6.5.438`                 |
| Fastify auth/validation bypass and DoS advisories (high)                      | all `services/*`                           | Upgraded to `fastify@^5.12.8`                     |
| xmldom injection/ReDoS advisories (high)                                      | `mammoth` → `@xmldom/xmldom`               | Override `>=0.9.12`, `mammoth@^1.13.0`            |
| Vite / launch-editor / postcss / nanoid / esbuild / browserslist (dev server) | desktop toolchain                          | `vite@^6.4.5` and scoped overrides                |
| `@grpc/grpc-js` auth-context advisory (high)                                  | `services/api` via `@google-cloud/speech`  | Override `^1.14.5`                                |
| Turbo login CSRF / local code execution (low)                                 | root                                       | `turbo@^2.11.10`                                  |
| 3 critical advisories (tar, shell-quote, websocket-driver)                    | `apps/mobile` toolchain                    | Overrides                                         |
| quick-xml DoS (RUSTSEC-2026-0194/0195), tokio and anyhow notices              | desktop `Cargo.lock`                       | `cargo update` of plist, quick-xml, tokio, anyhow |
| Containers run as root (Semgrep `missing-user`)                               | `services/*/Dockerfile`                    | `USER node`                                       |
| Predictable temp file written with follow-symlink semantics                   | `src-tauri/src/main.rs` `transcribe_audio` | `create_new(true)`                                |
| Tray action lookup could resolve inherited `Object.prototype` keys            | `apps/desktop/src/trayIntegration.ts`      | `Object.hasOwn` guard                             |

## Accepted or deferred

| Finding                                                                                                  | Reason                                                                                                                         | Follow-up                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `zod@3` memory exhaustion on oversized constrained input (high, patched only in zod 4)                   | Requires a zod 3 → 4 migration across services and packages. Request bodies are already size-limited by Fastify's `bodyLimit`. | Migrate to zod 4.                                                             |
| ~100 moderate/high advisories in `apps/mobile` (Expo 52, React Native 0.76, Firebase 11 transitive deps) | Build-time tooling and a mobile app that is being rebuilt. Still gated on critical in CI.                                      | Resolve with the new mobile app's dependency set.                             |
| Cloud SQL `require_ssl` (Semgrep)                                                                        | Instance has no public IP (`ipv4_enabled = false`, private network only).                                                      | Consider `ssl_mode = "ENCRYPTED_ONLY"` when connection clients are confirmed. |
| `edge-tts` output path in shared temp dir                                                                | File is created by an external process; read back once and removed.                                                            | Move to a per-run private temp directory.                                     |
| RustSec "unmaintained"/"unsound" notices (gtk3 stack, `unic-*`, `proc-macro-error`, glib)                | Transitive through Tauri 2 on Linux; no fixed versions.                                                                        | Track Tauri upgrades via Dependabot.                                          |
| Semgrep `detect-non-literal-regexp`, `detect-redos` in desktop search/dictionary code                    | False positives: user input passes through `escapeRegex`; patterns have no ambiguous nested quantifiers.                       | None.                                                                         |
| Semgrep `hardcoded-hmac-key` in `billing-service/src/routes.smoke.ts`                                    | Deliberately fake test secret.                                                                                                 | None.                                                                         |
