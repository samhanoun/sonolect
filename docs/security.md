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
