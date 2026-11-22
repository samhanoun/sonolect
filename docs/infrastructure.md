# Infrastructure Runbook

## Layout

- `infra/terraform`: reusable GCP module for Cloud Run, Firestore, Cloud SQL (off by default, see [Cloud SQL](#cloud-sql)), Cloud Storage, Pub/Sub, Secret Manager, IAM, and enabled APIs.
- `infra/terraform/tests`: tests of that module with mocked providers. They need no Google account: run `terraform init -backend=false` and `terraform test` in `infra/terraform`.
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
2. Turn on the APIs Terraform needs before it can turn on the others: `gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project <project-id>`. The plan reads the project (for its number) through Cloud Resource Manager.
3. Replace placeholder Cloud Run images with Artifact Registry images.
4. Populate Secret Manager versions out-of-band.
5. Review deletion protection and public API invocation settings.

Saved plans (`*.tfplan`) and `terraform.tfvars` files under `infra/terraform` are ignored by git: a saved plan holds the generated service token, like the state.

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

The internal services (agent, audio, billing, worker) are not public APIs. A caller sends `Authorization: Bearer <service token>` and names the end user in `x-user-id`; a request whose body or path names a different user is rejected. A service refuses to start in production without a token. Terraform generates the worker's token, stores it in Secret Manager as `sonolect-<env>-service-tokens` and passes it to the worker. Terraform sets `NODE_ENV=production`, `FIREBASE_PROJECT_ID` (the GCP project unless `firebase_project_id` is set), `SONOLECT_ALLOWED_ORIGINS` (from `allowed_origins`), `SONOLECT_VERTEX_LOCATION` (from `vertex_location`, the platform's `region` by default, so polish requests stay in that region) and `SONOLECT_GEMINI_MODEL` (from `gemini_model`, `gemini-2.5-flash` by default, the same as the API's own default) on Cloud Run in every environment. Vertex AI retired `gemini-2.5-flash` on October 16, 2026, so `/v1/polish` needs `gemini_model` and `vertex_location` set together to a current model and a location that serves it; [api.md](api.md#post-v1polish-model) lists the choice.

### Runtime service accounts

Each Cloud Run service runs as its own service account, so the public API cannot read the worker's token or use its grants:

| Account                 | Project roles                                                                                                                                           | Other grants                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `sonolect-<env>-api`    | `aiplatform.user` (Vertex AI), `speech.client` (Speech-to-Text v2 recognize), `serviceusage.serviceUsageConsumer`, `datastore.user`, `pubsub.publisher` | `storage.objectUser` on the app bucket                                                                         |
| `sonolect-<env>-worker` | `datastore.user`, `pubsub.publisher`, `pubsub.subscriber`                                                                                               | `storage.objectUser` on the app bucket; `secretmanager.secretAccessor` on `sonolect-<env>-service-tokens` only |

Both get `cloudsql.client` when `enable_cloud_sql` is true. No account can read the other secrets: grant `secretmanager.secretAccessor` on a secret itself, to the account whose service mounts it. Earlier versions of the module used one shared account, `sonolect-<env>-run`; an apply replaces it with these two.

The sync service is public: the apps call it directly, and each vault authenticates its own bearer token. Its service token guards only the admin route. Production refuses the memory store. On Cloud Run use `SONOLECT_SYNC_STORE=firestore`, because a SQLite file there would sit on the instance's in-memory disk; the runtime service account needs Firestore access (`roles/datastore.user`). The service needs no composite index and no TTL policy: it purges tombstones itself. Optional settings are `SONOLECT_SYNC_FIRESTORE_DATABASE` (a database other than `(default)`), `SONOLECT_SYNC_TRUST_PROXY` (proxy hops in front of it; 1 by default on Cloud Run) and `SONOLECT_SYNC_ALLOWED_ORIGINS` (CORS, off by default). Its rate limits are kept per instance, so cap the service at 2 instances. `infra/terraform/sync` deploys it (see below); `services/sync-service/README.md` has the details.

## Note sync service

The sync service is deployed on its own, from `infra/terraform/sync`, so that hosting sync does not need the full platform (whose root module can also create Cloud SQL, which needs a private VPC). [sync-setup.md](sync-setup.md) is the owner's runbook, from creating the project to pairing two devices, with a `gcloud run deploy` fallback.

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

CI's "Terraform formatting" job checks the formatting of every directory under `infra/terraform` and runs `terraform validate` on both roots (which also checks the files in `infra/terraform/tests`). Neither root has a backend configured: the sync runbook shows how to move the state to a Cloud Storage bucket. The apps reach the service only if their builds set its URL (`SONOLECT_SYNC_URL` for desktop, `EXPO_PUBLIC_SONOLECT_SYNC_URL` for mobile); [LOCAL-BUILD.md](../LOCAL-BUILD.md#note-sync-against-a-local-server) shows how to run it locally for development builds.

## Firebase deployment

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage --project <project-id>
```

Rules deny all unrecognized paths. Product changes that add collections or object prefixes must update rules, and `infra/firebase/rules.test.mjs`, in the same pull request. To run that test locally (Java 21 needed):

```bash
npx firebase-tools@15.37.0 emulators:exec --only firestore,storage --project demo-sonolect \
  "node --test infra/firebase/rules.test.mjs"
```

## Environment defaults

| Environment | Deletion protection | Cloud SQL (when enabled) | Cloud Run min | API public invoker |
| ----------- | ------------------- | ------------------------ | ------------- | ------------------ |
| dev         | false               | ZONAL / small            | 0             | true               |
| staging     | true                | ZONAL / medium           | 0             | true               |
| prod        | true                | REGIONAL / larger        | 1             | false              |

`enable_cloud_sql` is false in every environment.

## Cloud SQL

The module can create a PostgreSQL instance and a `sonolect` database, but only with `enable_cloud_sql = true`. It is off everywhere, because no service reads or writes relational state yet: the API keeps transcripts in memory or a file, and the worker answers only `/health`. The instance has a private IP only, so `enable_cloud_sql` also needs `private_network_self_link`, a VPC with private services access (and `servicenetworking.googleapis.com`). The plan stops with an error when it is missing.

Before a service can use the instance, it still needs:

1. The network: the VPC and private services access above, and VPC egress for the Cloud Run service that connects (Direct VPC egress or a Serverless VPC Access connector). The module adds neither yet.
2. A database user, with its password kept in Secret Manager, never in Git or in a Terraform variable.
3. A version of the `sonolect-<env>-database-url` secret, mounted into that service as an environment variable, and accessor rights on that secret for its account.
4. A Postgres client in the service, and a migrations tool and folder run in CI or at deploy. The repository has neither.

## Production mode

Every Cloud Run service in `infra/terraform` runs with `NODE_ENV=production`, and in that mode no service answers with a placeholder (see [api.md](api.md#what-production-serves)):

- The API registers only `GET /health`, `POST /v1/transcribe` and `POST /v1/polish`. Its other routes keep data only in the instance, so they are off and answer 404. Leave `SONOLECT_API_PREVIEW_ROUTES` unset: with it set to `1`, those routes would accept data that a restart or a second instance loses.
- The worker answers only `GET /health`. Its task and event endpoints answer 501 `not_implemented`. Nothing calls them: the Pub/Sub subscriptions are pull subscriptions, and Cloud Run only checks that the port opens.
- Each service logs once at start which routes or endpoints are off.

A smoke check after a deploy: `GET /health` answers 200 on each service, and `POST /v1/polish` without a token answers 401 on the API.

## Operational notes

- Cloud SQL password/user creation should be handled by migrations or secret-backed operational steps; do not commit database passwords.
- A message that fails 5 deliveries is forwarded to `sonolect-<env>-dead-letter` (the Pub/Sub service agent may publish there and acknowledge on each source subscription). The pull subscription `sonolect-<env>-dead-letter-inspect` keeps it for the retention period (`pubsub_message_retention`, 7 days by default) and never expires. Monitor it, and replay its messages by hand after fixing the underlying issue.
- Storage lifecycle policy is shorter outside production to control costs.
