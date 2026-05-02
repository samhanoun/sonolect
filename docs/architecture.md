# Sonolect Technical Architecture

Sonolect is a pnpm monorepo containing desktop/mobile clients, shared packages, and Cloud Run services for speech capture, transcript refinement, agent orchestration, sync, and billing.

## System boundaries

- **Clients**: desktop and mobile apps capture audio, manage user workflows, and call the API.
- **API service**: public HTTP edge for auth-aware product APIs, user/session metadata, billing webhooks, and signed upload/download coordination.
- **Worker service**: asynchronous processors for transcription, agent actions, billing events, and retries from Pub/Sub.
- **Shared packages**: `@sonolect/types`, `@sonolect/validation`, `@sonolect/config`, `@sonolect/sdk`, `@sonolect/ui`, and prompt assets.
- **Infrastructure**: GCP Cloud Run, Firestore, Cloud SQL for relational state, Cloud Storage for audio/artifacts, Pub/Sub for queues, and Secret Manager for runtime secrets.

## Data flow

1. Client authenticates and requests a session/project operation through the API.
2. API writes tenant-scoped metadata to Firestore/Cloud SQL and returns upload coordinates where needed.
3. Audio/artifacts are stored in private Cloud Storage paths scoped by user or tenant.
4. API publishes async work to Pub/Sub topics such as `audio-ingest`, `transcription-jobs`, `agent-actions`, or `billing-events`.
5. Worker consumes subscriptions, calls provider integrations using Secret Manager-backed credentials, writes results, and emits follow-up events.
6. Clients subscribe/poll through the API or Firebase-backed data paths based on product requirements.

## Environments

Terraform environment wrappers exist under `infra/terraform/environments/{dev,staging,prod}` and call the root module with environment-specific sizing and protection defaults.

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
