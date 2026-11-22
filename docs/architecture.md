# Sonolect Technical Architecture

Sonolect is a pnpm monorepo containing desktop/mobile clients, shared packages, and Cloud Run services for speech capture, transcript refinement, agent orchestration, sync, and billing.

## System boundaries

- **Clients**: desktop and mobile apps capture audio, manage user workflows, and call the API. For note sync they call the sync service instead, and only when their build names it.
- **API service**: public HTTP edge for auth-aware product APIs, user/session metadata, billing webhooks, and signed upload/download coordination.
- **Worker service**: asynchronous processors for transcription, agent actions, billing events, and retries from Pub/Sub.
- **Sync service**: end-to-end encrypted note sync. The apps call it directly with a vault key, and it never sees a key or a word of a note (see [security.md](security.md#note-sync)).
- **Shared packages**: `@sonolect/types`, `@sonolect/validation`, `@sonolect/config`, `@sonolect/sdk`, `@sonolect/sync-core`, `@sonolect/ui`, and prompt assets.
- **Infrastructure**: GCP Cloud Run, Firestore, Cloud SQL for relational state, Cloud Storage for audio/artifacts, Pub/Sub for queues, and Secret Manager for runtime secrets. The sync service needs only Cloud Run, Firestore and Secret Manager, and has its own Terraform root.

## Data flow

1. Client authenticates and requests a session/project operation through the API.
2. API writes tenant-scoped metadata to Firestore/Cloud SQL and returns upload coordinates where needed.
3. Audio/artifacts are stored in private Cloud Storage paths scoped by user or tenant.
4. API publishes async work to Pub/Sub topics such as `audio-ingest`, `transcription-jobs`, `agent-actions`, or `billing-events`.
5. Worker consumes subscriptions, calls provider integrations using Secret Manager-backed credentials, writes results, and emits follow-up events.
6. Clients subscribe/poll through the API or Firebase-backed data paths based on product requirements.

## Note sync

Sync is independent of the API, the account and the other services. Its parts:

- **`packages/sync-core`**, shared by both apps and the service: key derivation, the sealed record format, the hybrid logical clock, the sync engine, pairing codes and the HTTP protocol (`@sonolect/sync-core/wire`). See its [README](../packages/sync-core/README.md).
- **The apps.** Each one keeps the vault's root key in the OS keychain (desktop, on the Rust side) or `expo-secure-store` (mobile), runs the engine over its own note store, and calls the server fixed at build time: `SONOLECT_SYNC_URL` (desktop, through the Rust HTTP client, so the webview's CSP is unchanged) or `EXPO_PUBLIC_SONOLECT_SYNC_URL` (mobile, through `fetch`). Without the URL, sync stays hidden and the app makes no sync request.
- **`services/sync-service`**: Fastify, open to the apps (each vault checks its own bearer token), storing one sealed record per note in Firestore on Cloud Run, or in SQLite or memory for self-hosting and tests. See its [README](../services/sync-service/README.md).
- **`infra/terraform/sync`**: the standalone Terraform root that hosts it; [sync-setup.md](sync-setup.md) is the runbook.
- **`tooling/sync-e2e`**: tests that run in `pnpm test`. The desktop's and the phone's own sync code sync with each other through the real service, in one process. See its [README](../tooling/sync-e2e/README.md).

One sync run, from a device:

1. Pull: `GET /v1/vaults/{vaultId}/changes?since=<seq>` pages through the records other devices wrote since the device's cursor. The device opens each record, keeps the version with the later clock, and saves the loser of a real conflict as a conflict copy.
2. Push: `POST /v1/vaults/{vaultId}/records` sends the notes changed here, sealed, as compare-and-swap writes on each record's revision. A conflict answer carries the server's current record, which the device applies like a pulled one; if its own version still wins, it sends it again on the current revision.
3. Deletes travel as sealed tombstones. Local retention sends none; a user's delete does.

The first device creates the vault (`POST /v1/vaults`); others join by QR code or typed code, which carry only the key. Recordings stay on the device. [api.md](api.md#note-sync-vault-api) lists the routes, and [security.md](security.md#note-sync) the threat model.

## Environments

Terraform environment wrappers exist under `infra/terraform/environments/{dev,staging,prod}` and call the root module with environment-specific sizing and protection defaults. The sync service is deployed separately from `infra/terraform/sync`, one deployment per Google Cloud project.

- **dev**: small Cloud SQL tier, no minimum Cloud Run instances, deletion protection disabled.
- **staging**: production-like service topology with smaller capacity and deletion protection enabled.
- **prod**: regional Cloud SQL, minimum API/worker capacity, deletion protection enabled, public API invocation disabled by default for gateway/IAP fronting.

## Reliability defaults

- Cloud SQL backups and point-in-time recovery are enabled.
- Pub/Sub subscriptions include retry policy and dead-letter topic placeholders.
- Cloud Storage uses uniform bucket-level access, public access prevention, versioning, and lifecycle retention.
- Cloud Run services use dedicated runtime service accounts and least-privilege IAM grants for Firestore, Cloud SQL, Storage, Pub/Sub, and Secret Manager.

## Open infrastructure follow-ups

- Add networking module for VPC, private service access, Serverless VPC Access, and egress controls.
- Wire GitHub Actions Workload Identity Federation to the `ci_deploy_service_account` output.
- Replace placeholder Cloud Run images with Artifact Registry images.
- Add Cloud Monitoring alert policies and SLO dashboards.
