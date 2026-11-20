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
| Secrets      | API keys, JWT keys, provider credentials | Secret Manager, no repository storage, rotation runbooks      |

## Desktop app boundary

- The bundled interface runs under a Content Security Policy (`app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`): scripts and styles only from the app itself, and network connections only to Tauri IPC and loopback (`localhost`/`127.0.0.1`, for a local `VITE_SONOLECT_API_URL`). Every online request (OpenRouter, OpenCode, Edge voices) goes through the Rust side, which refuses it while **Local only** is selected. If a build points `VITE_SONOLECT_API_URL` at a remote host, add that origin to `connect-src`.
- File paths are chosen natively: recordings and system-audio captures live in the app's local data folder, and a model path from the interface must be a GGML Whisper file before it reaches whisper.cpp.
- Dictations pasted into other apps are kept out of Windows clipboard history and the cloud clipboard, and the previous clipboard text is restored afterwards.
- Settings > Privacy & retention deletes recordings after a chosen number of days, and **Delete all my data** removes recordings, transcripts, saved provider keys, dictionary, snippets and preferences.

## API cost controls

The paid `/v1/transcribe` and `/v1/polish` routes are limited per verified account (30 requests per minute by default, `aiRouteLimits` in `createApp`), polish input is capped at 20,000 characters and 200 dictionary entries, and provider errors are logged rather than returned. The limit is held in memory per instance, so with several Cloud Run instances the effective budget is per instance; move it to a shared store (Firestore or Redis) before relying on it for billing.

The `agent`, `audio`, `billing` and `sync` services have no authentication and are not deployed by Terraform. Do not expose them until they verify callers the way the API does.

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
