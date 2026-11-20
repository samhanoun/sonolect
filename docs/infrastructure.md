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

## Service images

Each service has a Dockerfile that is built from the repository root, because the build needs the shared workspace packages:

```bash
docker build -f services/api/Dockerfile -t sonolect-api .
docker build -f services/worker-service/Dockerfile -t sonolect-worker .
```

The build bundles the service into `dist/index.js` (`pnpm --filter <service> build`) and ships only its production dependencies. Images run as the `node` user with `NODE_ENV=production`, listen on `PORT` (default 8080) and expose `GET /health`. CI builds all six images and starts each one in production mode on every pull request.

Runtime configuration the images need:

| Service                             | Required in production                                           |
| ----------------------------------- | ---------------------------------------------------------------- |
| api                                 | `FIREBASE_PROJECT_ID`, `SONOLECT_ALLOWED_ORIGINS`                |
| agent, audio, billing, sync, worker | `SONOLECT_SERVICE_TOKENS` (comma-separated, 32+ characters each) |
| billing                             | `STRIPE_WEBHOOK_SECRET` for the Stripe webhook                   |

The internal services (agent, audio, billing, sync, worker) are not public APIs. A caller sends `Authorization: Bearer <service token>` and names the end user in `x-user-id`; a request whose body or path names a different user is rejected. A service refuses to start in production without a token. Terraform generates the worker's token, stores it in Secret Manager as `sonolect-<env>-service-tokens` and passes it to the worker. Terraform sets `NODE_ENV=production`, `FIREBASE_PROJECT_ID` (the GCP project unless `firebase_project_id` is set) and `SONOLECT_ALLOWED_ORIGINS` (from `allowed_origins`) on Cloud Run in every environment.

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
