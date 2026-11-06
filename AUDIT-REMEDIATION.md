# Audit remediation ledger

Objective: fix every finding in ../AUDIT.md in the combined application. The two original repositories remain reference snapshots; superseded implementations must not be imported back into this app. No audit item is complete solely because a helper test passes.

## Current pass — 6 November 2026

Previous goal work classification: progress. Production auth/CORS defects were reproduced as four failing regressions, then fixed. Seven security tests now pass, including real JWT signatures and invalid issuer/audience/expiry cases. All six existing API smoke suites and the API TypeScript check pass. Audio integration fixtures now use the existing shell-free argv adapter on Windows instead of POSIX shell quoting.

| Finding | Current evidence and required remaining proof |
|---|---|
| 1 Local privacy enforcement | Native and frontend guards were implemented earlier. Still needs an inventory of every content egress path, failure/revocation tests, and packaged-app network observation. |
| 2 Local engine setup | Embedded engine and model path are wired, with real offline fixture evidence. Cancellation, bounded execution and error propagation need further work. |
| 3 Authentication | **Server boundary fixed in this pass:** production forces authentication, fails startup without a verifier, verifies Firebase client JWT signatures/claims, ignores caller identity headers, and isolates verified accounts. Direct startup defaults to production; development binds loopback. Remaining: desktop service login/session integration and removal of legacy build-time/shared-token paths. Direct OpenRouter/OpenCode provider keys remain separate personal native integrations. |
| 4 CORS | **API boundary fixed in this pass:** exact-origin allowlist, unauthenticated permitted preflight, disallowed-origin regression. Remaining: real browser and packaged-webview requests against an authenticated service. |
| 5 Durable recordings | Native persistence/retry/delete exists. Needs crash/restart verification, orphan recovery, bounded retention and export checks. |
| 6 Meaning-preserving cleanup | Prior regression tests cover legitimate words, paragraphs and currency replacement. Needs multilingual, multiline snippets and full pipeline proof. |
| 7 Language propagation | Settings are passed to native/provider paths. Needs multilingual spoken fixtures and automatic detection checks. |
| 8 Cross-app insertion | Open: destination capture, focus restoration, safe per-result insertion, retry/clipboard handling, and Notepad/browser/editor native acceptance tests. |
| 9 Desktop packaging | Static Vite assets embedded in the Windows executable. Needs fresh installed-artifact startup proof with the dev server stopped. |
| 10 Real release backend | Embedded real Whisper is the production path. Needs build gate against stubs and native shortcut/insertion acceptance. Legacy service-worker shell/mock options still need release-policy review. |
| 11 Model/audio lifecycle | Bundled model digest verified and downloader uses checksum/rename. Needs corrupt-install, cancellation, failure and retention lifecycle tests. |
| 12 Native verification/feature claims | Windows compiler repaired and native inference verified earlier. Remaining release gates and unsupported feature claims must be reconciled; helper tests are not speaker-recognition or streaming evidence. |

## Additional tracked release debt from the follow-up audit

- Full-monorepo dependency advisories: most recent audit reported 3 critical / 77 high; resolve against the current lockfile and test affected packages, rather than suppressing advisories or assuming they are unreachable.
- Remaining React asynchronous lifecycle warnings and any new findings from the review.
- Live keyed STT/TTS/editing tests have not used user keys; no paid requests should be silently made.
- Licensing/redistribution provenance remains a publication prerequisite; this goal does not authorize publishing or deployment.
- Code signing, installer/update/rollback checks, account sync and any claimed platform capabilities need scoped verification. No claim of full Wispr Flow parity is made.

The goal remains active. This ledger tracks remaining work; it does not reduce the scope to the fixes completed so far.
