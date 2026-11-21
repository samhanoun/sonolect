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
- System audio is recorded natively, straight into the recording in progress, and never passes through the interface. The interface chooses no device, path or command: it can only ask for the default playback device to be fed into the recording it started, and only the recorder process the app started is ever stopped.
- Dictations pasted into other apps are kept out of Windows clipboard history and the cloud clipboard, and the previous clipboard text is restored afterwards.
- Settings > Privacy & retention deletes recordings after a chosen number of days, and **Delete all my data** removes recordings, transcripts, saved provider keys, dictionary, snippets and preferences. When sync is on it also forgets the sync key and the sync state, and first offers to delete the server copy.

## API cost controls

The paid `/v1/transcribe` and `/v1/polish` routes are limited per verified account (30 requests per minute by default, `aiRouteLimits` in `createApp`), polish input is capped at 20,000 characters and 200 dictionary entries, and provider errors are logged rather than returned. The limit is held in memory per instance, so with several Cloud Run instances the effective budget is per instance; move it to a shared store (Firestore or Redis) before relying on it for billing.

## Internal services

The `agent`, `audio`, `billing` and `worker` services are internal: they are called by the API gateway or by background jobs, never by an app. Each one requires a shared service token (`Authorization: Bearer`, configured with `SONOLECT_SERVICE_TOKENS`) and refuses to start in production without one. The end user is named in the `x-user-id` header, and a request whose body or path names a different user is rejected with 403. The Stripe webhook is the one route without a service token; it verifies the Stripe signature on the raw request body instead. Outside production the services stay open for local development and bind to `127.0.0.1` only. Their stores are in memory, so they are scaffolding for the hosted product and are not wired to the apps yet. The platform root module (`infra/terraform`) deploys only `api` and `worker`. The sync service, which is public, has a root of its own (`infra/terraform/sync`, see [sync-setup.md](sync-setup.md)).

## Note sync

Note sync is end-to-end encrypted. The apps call `services/sync-service` directly; `packages/sync-core` holds the keys, the envelope, the protocol and the sync engine. Its README has the full threat model.

- **A vault is a random 32-byte root key.** There is no account. HKDF derives the vault id, the bearer token, the encryption key and the record-id key from it. The apps keep the root key in the OS keychain (desktop) or `expo-secure-store` (mobile).
- **The server only ever sees:** vaultId, the bearer authToken (it stores only its SHA-256), record ids (rids), revisions, sizes, timestamps, IP addresses and ciphertext. Nothing sends or logs the root key, `encKey` or `idKey`, and nothing logs request bodies or tokens.
- **Each note is one sealed record:** XChaCha20-Poly1305, padded to 256 bytes and bound to its vault and record id. A record id is an HMAC of the note id, so the server never learns note ids.
- **A dishonest server can** withhold, delay or delete records, and learn how many notes a vault holds, their rounded sizes and when devices sync. It cannot read, forge or move a record. A replayed older version of a note is refused, and a vault rolled back as a whole is detected by its head and epoch and answered with a full resync.
- **Whoever holds the pairing link, QR code or typed code can read and change every synced note.** Every screen that shows or accepts a code says so in one line. There is no revocation in v1: deleting the server copy ends the vault, and the other devices then turn sync off and keep their notes. Erase-all also forgets the key and the sync state, and first offers to delete the server copy.
- **Sync stays invisible and inert unless the build sets a server URL** (`SONOLECT_SYNC_URL` on desktop, `EXPO_PUBLIC_SONOLECT_SYNC_URL` on mobile). Release builds accept only https. Development builds may also use plain http to `127.0.0.1`, `localhost` or, from the Android emulator, `10.0.2.2`. Pairing never carries a URL.
- **Recordings do not sync in v1.** Local retention never deletes remotely, and a device does not import notes past its own retention window.
- **What the network sees.** The apps reach the server over HTTPS only (release builds refuse any other URL). Someone on the network path sees the server's host name and IP address, the device's IP address, and when and how much data moves, but not the request paths (which carry the vault id), the bearer token or the records. A TLS-intercepting proxy that the device trusts sees what the server sees, the bearer token included: it could then delete or overwrite the vault's records, but still not read or forge a note.
- **What the operator sees.** Whoever runs the Google Cloud project sees what the server sees, kept in two places: Firestore holds the vault documents (`syncVaults/{vaultId}`: the token verifier, counters and times) and the sealed records; Cloud Run's request logs and the service's own logs hold each request's method, path (vault id, `since` and `limit`), status, timing, user agent and the caller's IP address, for as long as Cloud Logging keeps them (30 days in the default log bucket unless the operator changes it). They never hold a body or a token. Deleting a vault removes its records at once, but not log lines already written.
- **Losing a device.** The root key stays in that device's keychain or secure store, behind the device's own lock. Anyone who can use the unlocked device, or extract the key from it, can read and change every synced note, also from another device, until the vault is deleted. From a device you still have: turn sync off with **Delete the server copy**, turn sync on again (a new key, so a new vault) and pair your other devices with the new code. The lost device keeps the notes it already had, and its key no longer reaches anything.
- **Deleting the vault** (turning sync off with **Delete the server copy**, or erase-all with that choice) erases its records on the server at once. The vault id stays taken by a small marker, so the same key can never bring the vault back. The other devices see "This sync was deleted" on their next sync, turn sync off and keep their notes. Notes on devices are never deleted by this.
- **No key recovery.** There is no account, password or escrow, so nobody, the operator included, can recover a vault's key or read its records. If every device that holds the key is lost or erased without deleting the server copy, nobody can read that copy or delete it through the apps; it stays until the operator removes it. As long as one device keeps sync on, it can show the code again to pair a new device.
- **The service** checks each vault's bearer token by comparing SHA-256 digests with `timingSafeEqual`, and gives the same 401 for an unknown vault and a wrong token. Its admin route needs a service token. It limits requests per IP address and per vault, and vault creations per IP address; an IPv6 client counts by its /64 prefix, and a creation takes its slot before the store is asked. Vaults are capped at 20,000 records and 200 MiB, records at 768 KiB sealed, and a delete carries a tombstone of at most 1 KiB, so it cannot carry data past the quota. It trusts `X-Forwarded-For` only from a configured proxy hop (one on Cloud Run), and CORS is off unless origins are listed. The rate limits are per instance.

## Firebase rules

Rules live in `infra/firebase`:

- `firestore.rules`: denies by default, permits user-owned documents and tenant documents only to members/admins.
- `storage.rules`: denies by default, permits user-owned and tenant-owned object paths with size limits.
- `firestore.indexes.json`: expected composite indexes for sessions, transcripts, agent runs, and projects.

## Secret handling

1. Add new secret names to Terraform only as Secret Manager metadata.
2. Populate secret versions outside Git using the GCP console, `gcloud secrets versions add`, or an approved vault integration.
3. Grant access to runtime service accounts only when needed.
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
