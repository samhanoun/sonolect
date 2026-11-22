# Sonolect Security and Privacy

## Principles

- **Least privilege**: services use dedicated service accounts and only receive the minimum IAM roles needed.
- **Tenant isolation**: Firestore and Storage rules require authenticated user ownership or tenant membership.
- **No secrets in source**: Terraform creates Secret Manager placeholders only; secret versions must be populated through approved operational channels.
- **Private by default**: Cloud Storage enforces uniform bucket-level access and public access prevention. Production API ingress should be fronted by an API gateway, load balancer, or IAP where possible.
- **Auditability**: CI runs typecheck/lint/test, Rust fmt/clippy/test, JSON/YAML validation, Terraform formatting, SAST (CodeQL, Semgrep), SCA (OSV-Scanner, `pnpm audit`, `cargo audit`, Dependency Review), and secret scanning (Gitleaks). See [SECURITY.md](../SECURITY.md) for the full matrix.

## Data classification

| Class        | Examples                                 | Controls                                                      |
| ------------ | ---------------------------------------- | ------------------------------------------------------------- |
| Public       | marketing content, public config         | read-only rules, no credentials                               |
| Internal     | logs, metrics, deployment metadata       | IAM-gated access, retention policies                          |
| User content | audio, transcripts, agent outputs        | tenant/user scoped rules, private buckets, deletion workflows |
| Synced notes | sealed sync records, vault metadata      | end-to-end encrypted; the server holds no key (see below)     |
| Secrets      | API keys, JWT keys, provider credentials | Secret Manager, no repository storage, rotation runbooks      |

## Desktop app boundary

- The bundled interface runs under a Content Security Policy (`app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`): scripts and styles only from the app itself, and network connections only to Tauri IPC and loopback (`localhost`/`127.0.0.1`, for a local `VITE_SONOLECT_API_URL`). Every online request (OpenRouter, OpenCode, Edge voices, note sync) goes through the Rust side, which refuses the provider requests while **Local only** is selected. Note sync is a separate switch: the Rust side sends sync requests only to the server built into the app, and only while sync is on. If a build points `VITE_SONOLECT_API_URL` at a remote host, add that origin to `connect-src`.
- File paths are chosen natively: recordings live in the app's local data folder, and a model path from the interface must be a GGML Whisper file before it reaches whisper.cpp.
- Models are downloaded by the Rust side, and only when the user asks: the Whisper model from Settings, the speaker model from Settings or on the first **Detect speakers**, after a prompt that gives its size. Each one is pinned in the code by URL, size and SHA-256 (`PinnedModel` in `apps/desktop/src-tauri/src/model_download.rs`). A download is written to a `.part` file and moved into place only when both match, and the request carries no audio, transcript or identifier. **Local only** does not block these two downloads, since they send nothing of the user's: they are an exception to the rule above.
- The speaker model is checked against its pin again each time it is loaded, and parsed from those verified bytes in memory, so a replaced or damaged file never reaches the ONNX parser (`tract-onnx`, pure Rust, built without its default features). A file that fails the check is deleted, and the download is offered again. Detection reads a saved recording that the interface names by id only, never by path, with the same WAV and Ogg Opus readers as transcription, and refuses the recording still in progress.
- System audio is recorded natively, straight into the recording in progress, and never passes through the interface. The interface chooses no device, path or command: it can only ask for the default playback device to be fed into the recording it started, and only the recorder process the app started is ever stopped.
- Dictations pasted into other apps are kept out of Windows clipboard history and the cloud clipboard, and the previous clipboard text is restored afterwards.
- Settings > Privacy & retention deletes recordings after a chosen number of days, and **Delete all my data** removes recordings, transcripts, saved provider keys, dictionary, snippets and preferences. When sync is on it also forgets the sync key and the sync state, and first offers to delete the server copy.

## Mobile app boundary

- In the phone-only build (`API_FEATURES_ENABLED` is `false` in `apps/mobile/src/features.ts`), the app sends nothing to the Sonolect API. Only a build with a sync server talks to one, and then only to send ciphertext (see [Note sync](#note-sync)). Dictation may use the system speech service (Apple or Google) only after the user agrees, as the app's Settings and Capture screen say.
- **Online editing (phone to provider).** _Rewrite_ and _Reply_ can call OpenRouter or OpenCode Zen directly from the phone, with the user's own key. No Sonolect server is in the path. The feature is off by default and needs a provider, a model and a saved key. Each note is sent only after the user taps _Send_ in a dialog that names the provider and the model. An opt-in setting, _Send without asking each time_, skips the dialog, but never in _Ephemeral_, and never for a note made in _Ephemeral_. The request goes over HTTPS to the fixed endpoints of `apps/mobile/src/onlineRefine.ts` (the same ones as `apps/desktop/src-tauri/src/online.rs`). It refuses redirects, sends no cookies and times out after 60 seconds. It uses Expo's fetch (`apps/mobile/src/providerFetch.ts`), because React Native's global fetch follows redirects whatever the request says.
- **What is sent.** The text of that one note, after the dictionary and snippets were applied on the phone, a fixed instruction and the dictation language tag. The note is fenced between `<note>` tags and the model is told it is text to edit, not instructions; a result only replaces the note's text, the original is kept, and nothing is ever run. Never the audio, the times of a dictation's parts, other notes or the dictionary itself. Notes over 12,000 characters, or with no text left once cleaned up, are not sent. The provider's error text is never shown or stored; failures map to fixed notices.
- **Where the keys are.** One SecureStore item per provider (`sonolect.mobile.providerKey.openrouter` and `sonolect.mobile.providerKey.opencode`), written with delete-then-set and `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: in the iOS Keychain or the Android Keystore, readable only while the phone is unlocked, and never moved to another phone. On iOS such an item can be part of a backup of the same phone; Android backups are off (`allowBackup: false` in `apps/mobile/app.json`). A key is read from SecureStore at launch, only to learn whether one is saved (the app keeps a yes or no), and again to send a note. It never goes into app state, AsyncStorage, notices or logs. The web preview stores no key. **Erase all data** deletes both items, and a launch that finds no settings deletes keys left in the iOS keychain by an earlier install. A rooted or jailbroken phone can still expose the key, as with any app that keeps a user's own key.
- **Model catalogs** are the providers' public lists. They load only when the user taps _Load models_, without a key or a note. Nothing goes out at launch.

## API cost controls

The paid `/v1/transcribe` and `/v1/polish` routes are limited per verified account (30 requests per minute by default, `aiRouteLimits` in `createApp`). The limit is checked before the request body is read, and `/v1/transcribe` stops reading at 10 MiB, Google's limit for synchronous recognition (413 `audio_too_large` past it). Polish input is capped at 20,000 characters, 200 dictionary entries and a one-line style preset of 256 characters (a longer preset, or one with a line break, gets 422, never a silent drop), and provider errors are logged rather than returned. The limit is held in memory per instance, so with several Cloud Run instances the effective budget is per instance; move it to a shared store (Firestore or Redis) before relying on it for billing.

## Production mode

In production the API and the agent, audio, billing and worker services never answer with made-up results and never take data they would lose. The full list of routes is in [api.md](api.md#what-production-serves). The sync service follows it too: in production it refuses the in-memory store and keeps vaults in SQLite or Firestore (see [Note sync](#note-sync)).

- The API does not register its preview routes in production: the profile, audio job, transcript, command, quota and sync manifest routes. They keep data only in the process, so a restart or a second instance loses it, and some answer with fixed values. `SONOLECT_API_PREVIEW_ROUTES=1` turns them on; leave it unset on Cloud Run.
- The agent, audio, billing and worker services answer 501 `not_implemented` or 503 `not_configured` where they would otherwise return a placeholder or keep data only in memory: a local "rewrite" without a provider key, a mock transcript, a template summary, a command or task that never runs, usage events and plan changes. The Stripe webhook answers 501 too, so Stripe retries the event instead of dropping it.
- The API treats every `NODE_ENV` except `development` and `test` as production, unset and empty included. The internal services treat an unset `NODE_ENV` as development, so their images set `NODE_ENV=production`.

## Internal services

The `agent`, `audio`, `billing` and `worker` services are internal: they are called by the API gateway or by background jobs, never by an app. Each one requires a shared service token (`Authorization: Bearer`, configured with `SONOLECT_SERVICE_TOKENS`) and refuses to start in production without one. The end user is named in the `x-user-id` header, and a request whose body or path names a different user is rejected with 403. The Stripe webhook is the one route without a service token; it verifies the Stripe signature on the raw request body instead. Outside production the services stay open for local development and bind to `127.0.0.1` only. Their stores are in memory, so they are scaffolding for the hosted product and are not wired to the apps yet. The platform root module (`infra/terraform`) deploys only `api` and `worker`. The sync service, which is public, has a root of its own (`infra/terraform/sync`, see [sync-setup.md](sync-setup.md)).

## Note sync

Note sync is end-to-end encrypted. The apps call `services/sync-service` directly; `packages/sync-core` holds the keys, the envelope, the protocol and the sync engine. Its README has the full threat model.

- **A vault is a random 32-byte root key.** There is no account. HKDF derives the vault id, the bearer token, the encryption key and the record-id key from it. The apps keep the root key in the OS keychain (desktop) or `expo-secure-store` (mobile).
- **The server only ever sees:** vaultId, the bearer authToken (one per vault, shared by every device in it; the server stores only its SHA-256), record ids (rids), revisions, sequence numbers, the vault's epoch, which records are deletes (tombstones) and when they were written, sizes, timestamps, the apps' user agent, IP addresses and ciphertext. Nothing sends or logs the root key, `encKey` or `idKey`, and nothing logs request bodies or tokens.
- **Each note is one sealed record:** XChaCha20-Poly1305, padded to 256 bytes and bound to its vault and record id. A record id is an HMAC of the note id, so the server never learns note ids.
- **A dishonest server can** withhold, delay or delete records, and learn how many notes a vault holds, their rounded sizes, when notes are deleted and when devices sync. It cannot read, forge or move a record. A replayed older version of a note is refused, and a vault rolled back as a whole is detected by its head and epoch and answered with a full resync.
- **Whoever holds the QR code or typed code can read and change every synced note.** Every screen that shows or accepts a code says so in one line. There is no revocation in v1: deleting the server copy ends the vault, and the other devices then turn sync off and keep their notes. Erase-all also forgets the key and the sync state, and first offers to delete the server copy.
- **The key never goes through a link.** Any app on a phone can claim a custom URL scheme such as `sonolect://`, and the phone then picks which app opens the link, so a link with the key could reach another app. The QR code therefore holds plain text (`SONOLECT SYNC 1 ` and the code), which the phone has nothing to open; the phone reads it with Sonolect's own scanner (Settings › Sync › Scan code), and no build reads a key from a link. A camera app that reads the QR code shows the text and may offer a web search with it, which would send the key to a search engine, so the caption under the QR code says to scan it with Sonolect, not with the camera app. The camera is used only for that scan, on the phone: no image is kept or sent. On Android the scan runs in Google ML Kit, a library inside the app; Google says ML Kit sends Google only usage and diagnostic data, not the images or what they show (see [mobile-release.md](mobile-release.md#store-privacy-declarations-what-the-build-does)).
- **Sync stays invisible and inert unless the build sets a server URL** (`SONOLECT_SYNC_URL` on desktop, `EXPO_PUBLIC_SONOLECT_SYNC_URL` on mobile). Release builds accept only https. Development builds may also use plain http to `127.0.0.1`, `localhost` or, from the Android emulator, `10.0.2.2`. Pairing never carries a URL.
- **Recordings do not sync in v1.** Local retention never deletes remotely, and a device does not import notes past its own retention window.
- **What the network sees.** The apps reach the server over HTTPS only (release builds refuse any other URL). Someone on the network path sees the server's host name and IP address, the device's IP address, and when and how much data moves, but not the request paths (which carry the vault id), the bearer token or the records. A TLS-intercepting proxy that the device trusts sees what the server sees, the bearer token included: it could then delete or overwrite the vault's records, but still not read or forge a note.
- **What the operator sees.** Whoever runs the Google Cloud project sees what the server sees, kept in two places: Firestore holds the vault documents (`syncVaults/{vaultId}`: the token verifier, counters and times) and the sealed records; Cloud Run's request logs and the service's own logs hold each request's method, path (vault id, `since` and `limit`), status, timing, user agent and the caller's IP address, for as long as Cloud Logging keeps them (30 days in the default log bucket unless the operator changes it). They never hold a body or a token. Deleting a vault removes its records at once, but not log lines already written.
- **Losing a device.** The root key stays in that device's keychain or secure store, behind the device's own lock. Anyone who can use the unlocked device, or extract the key from it, can read and change every synced note, also from another device, until the vault is deleted. From a device you still have: turn sync off with **Delete the server copy**, turn sync on again (a new key, so a new vault) and pair your other devices with the new code. The lost device keeps the notes it already had, and its key no longer reaches anything.
- **Deleting the vault** (turning sync off with **Delete the server copy**, or erase-all with that choice) erases its records on the server at once. The vault id stays taken by a small marker, so the same key can never bring the vault back. The other devices see "This sync was deleted" on their next sync, turn sync off and keep their notes. Notes on devices are never deleted by this.
- **No key recovery.** There is no account, password or escrow, so nobody, the operator included, can recover a vault's key or read its records. If every device that holds the key is lost or erased without deleting the server copy, nobody can read that copy or delete it through the apps; it stays until the operator removes it. As long as one device keeps sync on, it can show the code again to pair a new device.
- **The service** checks each vault's bearer token by comparing SHA-256 digests with `timingSafeEqual`, and gives the same 401 for an unknown vault and a wrong token. Its admin route needs a service token. It limits requests per IP address and per vault, and vault creations per IP address; an IPv6 client counts by its /64 prefix, and a creation takes its slot before the store is asked. Vaults are capped at 20,000 notes (and 20,000 more records of tombstones) and 200 MiB, records at 768 KiB sealed, and a delete carries a tombstone of at most 1 KiB, so it cannot carry data past the quota. It trusts `X-Forwarded-For` only from a configured proxy hop (one on Cloud Run), and CORS is off unless origins are listed. The rate limits are per instance.

## Firebase rules

Rules live in `infra/firebase`:

- `firestore.rules`: denies by default, permits user-owned documents and tenant documents only to members/admins. The user who creates a tenant adds themself as its first owner; admins manage admins and members, and only an owner can make an owner, change a tenant's owner or delete the tenant.
- `storage.rules`: denies by default, permits user-owned and tenant-owned object paths with size limits on uploads.
- `rules.test.mjs`: CI checks both rule files on the Firebase emulators ("Sync service (Firestore emulator)" job).
- `firestore.indexes.json`: expected composite indexes for sessions, transcripts, agent runs, and projects.

No app or service uses these rules today: the shipped apps keep notes on the device, the sync service reaches its own Firestore database with a service account (rules do not apply to it), and the API keeps transcripts in memory or a file. They matter once a client reads Firestore or Storage directly.

## Secret handling

1. Add new secret names to Terraform only as Secret Manager metadata.
2. Populate secret versions outside Git using the GCP console, `gcloud secrets versions add`, or an approved vault integration.
3. Grant `roles/secretmanager.secretAccessor` on the secret itself, and only to the runtime service account whose service mounts it. Never grant it on the whole project.
4. Rotate provider keys and webhook secrets on role changes, suspected compromise, or at least every 180 days.

## CI and supply chain

- Use pnpm with a frozen lockfile.
- Prefer OIDC/Workload Identity Federation for cloud deploys; do not store long-lived GCP keys in GitHub secrets.
- Review `pnpm audit` findings before release. Document accepted risk with owner and expiry.
- Secret scanning is blocking in CI; remove leaked values and rotate them before retrying.
- GitHub Actions are pinned to full commit SHAs; Dependabot keeps the pins current.
- Service containers run as the unprivileged `node` user.
- Code scanning results (CodeQL, Semgrep, OSV-Scanner, Scorecard) land in the repository's Security tab. Triage notes for accepted findings live in [security-scan-triage.md](security-scan-triage.md).

## Incident response checklist

1. Triage severity and affected tenants/data classes.
2. Disable or rotate impacted credentials in Secret Manager/provider consoles.
3. Preserve logs and deployment metadata.
4. Patch vulnerable service/configuration and deploy through CI.
5. Notify affected users/regulators according to legal requirements.
6. Complete post-incident review with prevention actions.
