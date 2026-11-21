# Infrastructure Runbook

## Layout

- `infra/terraform`: reusable GCP module for Cloud Run, Firestore, Cloud SQL, Cloud Storage, Pub/Sub, Secret Manager, IAM, and enabled APIs.
- `infra/terraform/sync`: a standalone root for the note sync service alone (Firestore, Secret Manager and one public Cloud Run service; no Cloud SQL, so no VPC). See [Note sync service](#note-sync-service).
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
| sync                                | `SONOLECT_SYNC_STORE` (`firestore` or `sqlite:<path>`)           |

The internal services (agent, audio, billing, worker) are not public APIs. A caller sends `Authorization: Bearer <service token>` and names the end user in `x-user-id`; a request whose body or path names a different user is rejected. A service refuses to start in production without a token. Terraform generates the worker's token, stores it in Secret Manager as `sonolect-<env>-service-tokens` and passes it to the worker. Terraform sets `NODE_ENV=production`, `FIREBASE_PROJECT_ID` (the GCP project unless `firebase_project_id` is set) and `SONOLECT_ALLOWED_ORIGINS` (from `allowed_origins`) on Cloud Run in every environment.

The sync service is public: the apps call it directly, and each vault authenticates its own bearer token. Its service token guards only the admin route. Production refuses the memory store. On Cloud Run use `SONOLECT_SYNC_STORE=firestore`, because a SQLite file there would sit on the instance's in-memory disk; the runtime service account needs Firestore access (`roles/datastore.user`). The service needs no composite index and no TTL policy: it purges tombstones itself. Optional settings are `SONOLECT_SYNC_FIRESTORE_DATABASE` (a database other than `(default)`), `SONOLECT_SYNC_TRUST_PROXY` (proxy hops in front of it; 1 by default on Cloud Run) and `SONOLECT_SYNC_ALLOWED_ORIGINS` (CORS, off by default). Its rate limits are kept per instance, so cap the service at 2 instances. `infra/terraform/sync` deploys it (see below); `services/sync-service/README.md` has the details.

## Note sync service

The sync service is deployed on its own, from `infra/terraform/sync`, so that hosting sync does not need the full platform (whose root module also creates Cloud SQL on a private VPC). [sync-setup.md](sync-setup.md) is the owner's runbook, from creating the project to pairing two devices, with a `gcloud run deploy` fallback.

| Resource          | Setting                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APIs              | Artifact Registry, Cloud Resource Manager, Firestore, IAM, Cloud Run, Secret Manager                                                                          |
| Firestore         | Native mode, `firestore_location`, delete protection (`deletion_protection`, on by default). No TTL policy and no composite index                             |
| Service account   | `sonolect-sync-run`: `roles/datastore.user` with an IAM condition on the sync database, and access to its one secret                                          |
| Secret Manager    | `sonolect-sync-service-tokens`: a generated `SONOLECT_SERVICE_TOKENS` (48 characters), for the admin route only. The value is also in the Terraform state     |
| Cloud Run         | `sonolect-sync`: the `image` from Artifact Registry, 0 to 2 instances, 1 vCPU, 512 MiB, 10 requests per instance, CPU only during requests, 60 s timeout      |
| Environment       | `NODE_ENV=production`, `SONOLECT_SYNC_STORE=firestore`, `GOOGLE_CLOUD_PROJECT`, `SONOLECT_SYNC_FIRESTORE_DATABASE`, `SONOLECT_SERVICE_TOKENS` from the secret |
| Invocation        | Public: `allUsers` gets `roles/run.invoker`, or `skip_invoker_check` where an organization policy forbids `allUsers`                                          |
| Domain (optional) | A Cloud Run domain mapping for `domain`, only in the regions that offer one (checked at plan time). The `run.app` URL works without it                        |
| Outputs           | `service_url` (the URL to build the apps with), `run_app_url`, `domain_dns_records`, `service_tokens_secret`                                                  |

```bash
cd infra/terraform/sync
terraform init
terraform plan -out=sync.tfplan   # reads terraform.tfvars
terraform apply sync.tfplan
```

CI's "Terraform formatting" job checks the formatting of every directory under `infra/terraform` and runs `terraform validate` on both roots. Neither root has a backend configured: the sync runbook shows how to move the state to a Cloud Storage bucket. The apps reach the service only if their builds set its URL (`SONOLECT_SYNC_URL` for desktop, `EXPO_PUBLIC_SONOLECT_SYNC_URL` for mobile); [LOCAL-BUILD.md](../LOCAL-BUILD.md#note-sync-against-a-local-server) shows how to run it locally for development builds.

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
