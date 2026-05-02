# Infrastructure Runbook

## Layout

- `infra/terraform`: reusable GCP module for Cloud Run, Firestore, Cloud SQL, Cloud Storage, Pub/Sub, Secret Manager, IAM, and enabled APIs.
- `infra/terraform/environments/dev`: dev wrapper.
- `infra/terraform/environments/staging`: staging wrapper.
- `infra/terraform/environments/prod`: production wrapper.
- `infra/firebase`: Firebase/Firestore/Storage rules and indexes.

## Terraform usage

Terraform is intentionally scaffolded without backend configuration. Add remote state before shared applies.

```bash
cd infra/terraform/environments/dev
terraform init
terraform plan -var='project_id=sonolect-dev'
```

Before any real apply:

1. Configure a remote backend with state locking.
2. Create or import the VPC/private service access network and pass `private_network_self_link`.
3. Replace placeholder Cloud Run images with Artifact Registry images.
4. Populate Secret Manager versions out-of-band.
5. Review deletion protection and public API invocation settings.

## Firebase deployment

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
```

Rules deny all unrecognized paths. Product changes that add collections or object prefixes must update rules in the same pull request.

## Environment defaults

| Environment | Deletion protection | Cloud SQL         | Cloud Run min | API public invoker |
| ----------- | ------------------- | ----------------- | ------------- | ------------------ |
| dev         | false               | ZONAL / small     | 0             | true               |
| staging     | true                | ZONAL / medium    | 0             | true               |
| prod        | true                | REGIONAL / larger | 1             | false              |

## Operational notes

- Cloud SQL password/user creation should be handled by migrations or secret-backed operational steps; do not commit database passwords.
- Pub/Sub dead-letter messages should be monitored and replayed manually after fixing the underlying issue.
- Storage lifecycle policy is shorter outside production to control costs.
