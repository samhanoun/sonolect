# Hosting note sync

The owner's runbook for the end-to-end encrypted note sync server. Sync is
built into both apps but stays invisible until a build names a sync server:
`SONOLECT_SYNC_URL` for the desktop app and `EXPO_PUBLIC_SONOLECT_SYNC_URL`
for the phone. This page sets up that server on Google Cloud (Cloud Run and
Firestore), then builds the apps against it.

Everything here needs your accounts, so nothing in the repo or in CI does it.
The steps, in order:

1. [Create the project, with billing and a budget alert](#1-create-the-project)
2. [Pick the region and the Firestore location](#2-pick-the-region-and-the-firestore-location)
3. [Turn on the first APIs and sign in for Terraform](#3-turn-on-the-first-apis-and-sign-in-for-terraform)
4. [Create the Artifact Registry repository](#4-create-the-artifact-registry-repository)
5. [Build and push the image](#5-build-and-push-the-image)
6. [Deploy with Terraform](#6-deploy-with-terraform) (or [without Terraform](#6b-deploy-without-terraform))
7. [Optional: your own domain](#7-optional-your-own-domain)
8. [Check that it works](#8-check-that-it-works)
9. [Build the apps with the URL](#9-build-the-apps-with-the-url)
10. [Pair two devices](#10-pair-two-devices)

What the server can and cannot see, and what happens when a device is lost,
is in [security.md](security.md#note-sync). The service itself is described
in [services/sync-service/README.md](../services/sync-service/README.md).

## What you need

- A Google account and a payment method for Google Cloud billing.
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install), Docker with
  BuildKit, Terraform 1.7 or later (CI uses 1.7.5), Node 22 and `curl`.
- A clone of this repository at the commit you want to deploy.

The commands are for bash or zsh. Set these once per shell; later steps use
them:

```bash
export PROJECT_ID="sonolect-sync-123456"   # yours: 6 to 30 characters, unique across Google Cloud
export REGION="europe-west1"               # see step 2
export FIRESTORE_LOCATION="europe-west1"   # see step 2; it can never change
export BILLING_ACCOUNT="000000-000000-000000"   # from step 1
```

## What it costs

There are no prices here, because they change: check the Cloud Run,
Firestore, Secret Manager, Artifact Registry and Cloud Logging pricing pages
for your region. This is what drives the bill.

- **Cloud Run scales to zero.** With no request in flight it runs no
  instance, and the Terraform sets CPU to be billed only while a request is
  handled. You pay for request time (CPU and memory) and the number of
  requests. At most 2 instances run, which caps the compute bill.
- **Every sync is a request**, even when nothing changed. The apps sync at
  launch, when they come back to the foreground, a few seconds after a
  change, and on a timer while open (every minute on the desktop while its
  window has focus, every two minutes on the phone in the foreground).
  More devices kept open longer mean more requests.
- **Firestore bills per document read, write and delete, and per GiB
  stored.**
  - A sync that finds nothing new costs about two reads: the vault, plus the
    minimum one-read charge of a query.
  - Each changed note costs a write on upload and a read on every other
    device that pulls it.
  - A device that joins, or one that has not synced for 60 days, reads every
    note once (a full resync).
  - Storage is the sealed notes: text only, compressed, padded to 256 bytes,
    at most 200 MiB per vault. Recordings never sync.
- **Network egress**: the sealed notes sent to devices.
- **Small items**: the Secret Manager secret (one version, read when an
  instance starts), the images kept in Artifact Registry (delete old tags
  you no longer run), and request logs in Cloud Logging.
- Cloud Run and Firestore have free monthly or daily allowances; a few
  devices of one person may stay within them, but check the current terms.
- **A regional Firestore location costs less than a multi-region one.**

A budget alert (step 1) only warns you by email. It does not stop the
service or the bill.

## 1. Create the project

A project of its own keeps the sync bill, its permissions and its data apart
from anything else.

```bash
gcloud auth login
gcloud projects create "$PROJECT_ID" --name="Sonolect sync"
gcloud config set project "$PROJECT_ID"

gcloud billing accounts list          # note the ACCOUNT_ID for BILLING_ACCOUNT
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
```

Then a budget with alerts at 50 %, 90 % and 100 %. Pick the amount, in your
billing account's currency (for example `10USD` or `10EUR`). The billing
account's administrators get the emails.

```bash
gcloud services enable billingbudgets.googleapis.com
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="Sonolect sync" \
  --budget-amount=10USD \
  --filter-projects="projects/$PROJECT_ID" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

The console does the same under **Billing › Budgets & alerts**. If gcloud
offers to enable an API along the way, answer yes.

## 2. Pick the region and the Firestore location

- **Region** (Cloud Run): close to where your devices are, for example
  `europe-west1` (Belgium) or `us-central1` (Iowa). If you want your own
  domain (step 7), pick a region that offers Cloud Run domain mappings:
  `asia-east1`, `asia-northeast1`, `asia-southeast1`, `europe-north1`,
  `europe-west1`, `europe-west4`, `us-central1`, `us-east1`, `us-east4` or
  `us-west1` (Google's list in November 2026). Without a domain any region
  works: the apps use the service's `run.app` URL.
- **Firestore location**: the same region (regional: cheaper, and close to
  the service), or the multi-region that contains it (`eur3` for Europe,
  `nam5` for the United States: copies in several regions, at a higher
  price). It is fixed when the database is created and can never change.

Update `REGION` and `FIRESTORE_LOCATION` if you chose differently.

## 3. Turn on the first APIs and sign in for Terraform

Terraform turns on the APIs the service uses (Cloud Run, Firestore, Secret
Manager, IAM). These few it needs first:

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com

gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT_ID"
```

The second login gives Terraform your credentials.

## 4. Create the Artifact Registry repository

```bash
gcloud artifacts repositories create sonolect \
  --repository-format=docker \
  --location="$REGION" \
  --description="Sonolect service images"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

## 5. Build and push the image

From the repository root, on the commit to deploy. Each build gets its own
tag (here the commit), so that Terraform sees a new image and deploys it.
Cloud Run runs `linux/amd64` images, so the platform is set for builds on
Apple silicon too.

```bash
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/sonolect/sync-service:$(git rev-parse --short=12 HEAD)"
docker build --platform linux/amd64 -f services/sync-service/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

To try the image on your computer first, with a throwaway SQLite store:

```bash
docker run --rm -p 8080:8080 \
  -e SONOLECT_SYNC_STORE=sqlite:/tmp/sync.db \
  -e SONOLECT_SERVICE_TOKENS="$(openssl rand -hex 32)" \
  "$IMAGE"
curl http://127.0.0.1:8080/health   # in another terminal
```

## 6. Deploy with Terraform

[`infra/terraform/sync`](../infra/terraform/sync/main.tf) is a root of its
own, apart from the full platform in `infra/terraform` (which also creates
Cloud SQL and needs a private network). It creates:

- the Firestore database (native mode) with delete protection;
- the service account `sonolect-sync-run`, with `roles/datastore.user` on
  that database only (an IAM condition), and nothing else;
- the secret `sonolect-sync-service-tokens`: a generated
  `SONOLECT_SERVICE_TOKENS`, the token of the admin route;
- the Cloud Run service `sonolect-sync`: 0 to 2 instances, 1 vCPU and
  512 MiB each, 10 requests at a time per instance, CPU billed only during
  requests, `NODE_ENV=production`, `SONOLECT_SYNC_STORE=firestore`, the
  token from the secret;
- public invocation (`allUsers` may call it; every vault checks its own
  bearer token);
- optionally, the domain mapping (step 7).

It creates no TTL policy and no index: the service purges deleted notes'
tombstones itself, 90 days after the delete, and Firestore's automatic
indexes serve its queries.

```bash
cd infra/terraform/sync
cat > terraform.tfvars <<EOF
project_id         = "$PROJECT_ID"
region             = "$REGION"
firestore_location = "$FIRESTORE_LOCATION"
image              = "$IMAGE"
EOF
terraform init
terraform plan -out=sync.tfplan
terraform apply sync.tfplan
terraform output -raw service_url
```

`terraform.tfvars` and saved plans are ignored by git. Other settings are
in [variables.tf](../infra/terraform/sync/variables.tf): `domain`,
`firestore_database` (when the project already has a default database),
`cpu`, `memory`, `max_concurrency`, `max_instances` (1 or 2: the rate limits
are kept per instance) and `deletion_protection` (on by default; while it is
on, `terraform destroy` stops before deleting the database or the service).

- **If the apply stops on the `allUsers` binding** with an organization
  policy error (domain restricted sharing, on by default in newer Google
  Workspace and Cloud Identity organizations), add
  `skip_invoker_check = true` to `terraform.tfvars` and apply again. Cloud
  Run then skips the invoker check instead, which is just as public.
- **If the first apply fails on a permission** for the secret or Firestore,
  wait a minute (new permissions take a moment to spread) and run
  `terraform plan -out=sync.tfplan` and `terraform apply sync.tfplan` again.
- **The state.** `terraform.tfstate` in this folder holds the generated
  service token in plain text. Keep it private and backed up. To keep it in
  a Cloud Storage bucket instead:

  ```bash
  gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "gs://${PROJECT_ID}-tfstate" --versioning
  cat > backend.tf <<EOF
  terraform {
    backend "gcs" {
      bucket = "${PROJECT_ID}-tfstate"
      prefix = "sonolect-sync"
    }
  }
  EOF
  terraform init -migrate-state
  ```

  `backend.tf` is ignored by git too.

**Updating the service** later: build and push a new tag (step 5), put it in
`image` in `terraform.tfvars`, then plan and apply. Cloud Run switches to
the new revision once it answers `/health`.

### 6b. Deploy without Terraform

The same service with gcloud only, for example if Terraform is not an
option. Use one way or the other, not both: Terraform would undo changes made
by hand.

```bash
gcloud services enable run.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com

gcloud firestore databases create --location="$FIRESTORE_LOCATION" \
  --type=firestore-native --delete-protection

gcloud iam service-accounts create sonolect-sync-run \
  --display-name="Sonolect sync service runtime"
export SYNC_SA="sonolect-sync-run@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SYNC_SA}" \
  --role=roles/datastore.user \
  --condition="expression=resource.name==\"projects/${PROJECT_ID}/databases/(default)\",title=sonolect-sync-database-only"

printf %s "$(openssl rand -hex 32)" | gcloud secrets create sonolect-sync-service-tokens \
  --replication-policy=automatic --data-file=-
gcloud secrets add-iam-policy-binding sonolect-sync-service-tokens \
  --member="serviceAccount:${SYNC_SA}" --role=roles/secretmanager.secretAccessor

gcloud run deploy sonolect-sync \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SYNC_SA" \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=2 \
  --cpu=1 --memory=512Mi --concurrency=10 --timeout=60 --cpu-boost \
  --set-env-vars="NODE_ENV=production,SONOLECT_SYNC_STORE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-secrets="SONOLECT_SERVICE_TOKENS=sonolect-sync-service-tokens:latest"

gcloud run services describe sonolect-sync --region="$REGION" --format='value(status.url)'
```

If an organization policy refuses `--allow-unauthenticated`, deploy with
`--no-allow-unauthenticated`, then run
`gcloud run services update sonolect-sync --region="$REGION" --no-invoker-iam-check`.
To update, run the same `gcloud run deploy` with the new `IMAGE`.

## 7. Optional: your own domain

The `run.app` URL works without a domain, for good. A domain of your own,
such as `sync.example.com`, only changes the URL the apps are built with.

- Cloud Run domain mappings are a Preview feature, offered only in the
  regions listed in step 2. Google does not recommend them for production
  traffic because of added latency. For a region without them, or for
  production-grade serving, put Firebase Hosting or a global external
  Application Load Balancer in front instead (not set up here).
- The account that runs Terraform (or gcloud) must be a verified owner of the
  domain. Unless you bought it through Google, verify the base domain in
  Search Console: `gcloud domains verify example.com`, and check with
  `gcloud domains list-user-verified`.

With Terraform:

```bash
echo 'domain = "sync.example.com"' >> terraform.tfvars
terraform plan -out=sync.tfplan && terraform apply sync.tfplan
terraform output domain_dns_records   # add these records at your DNS host
```

Without Terraform:
`gcloud beta run domain-mappings create --service=sonolect-sync --domain=sync.example.com --region="$REGION"`,
then read the records with
`gcloud beta run domain-mappings describe --domain=sync.example.com --region="$REGION"`
(`resourceRecords`).

Add the records (A and AAAA for a root domain, a CNAME for a subdomain).
Google then issues and renews the certificate itself, usually within about
15 minutes and at most 24 hours. If the domain has CAA records, they must
allow `pki.goog` and `letsencrypt.org`. `terraform output -raw service_url`
then gives `https://sync.example.com`.

The URL is built into the apps (step 9), so pick it before building
releases. The `run.app` URL keeps working after a mapping, so builds made
with either reach the same vaults.

## 8. Check that it works

```bash
export SYNC_URL="$(terraform -chdir=infra/terraform/sync output -raw service_url)"
# Without Terraform: the URL from `gcloud run services describe` above.

curl -fsS "$SYNC_URL/health"
# {"status":"ok","service":"sonolect-sync-service"}

curl -fsS -H "authorization: Bearer $(gcloud secrets versions access latest --secret=sonolect-sync-service-tokens)" \
  "$SYNC_URL/v1/admin/status"
# {"service":"sonolect-sync-service","store":"firestore","limits":{...}}
```

Then a round trip through a throwaway vault, which exercises Firestore:

```bash
eval "$(node -e '
const c = require("node:crypto");
const token = c.randomBytes(32);
console.log("VAULT_ID=" + c.randomBytes(16).toString("base64url"));
console.log("TOKEN=" + token.toString("base64url"));
console.log("VERIFIER=" + c.createHash("sha256").update(token).digest("base64url"));
')"

# 201 {"vaultId":"…","created":true,"epoch":"…"}
curl -sS -w ' %{http_code}\n' -X POST "$SYNC_URL/v1/vaults" \
  -H 'content-type: application/json' \
  -d "{\"vaultId\":\"$VAULT_ID\",\"authVerifier\":\"$VERIFIER\"}"
# 200 {"records":[],"next":0,"hasMore":false,"head":0,"epoch":"…"}
curl -sS -w ' %{http_code}\n' -H "authorization: Bearer $TOKEN" \
  "$SYNC_URL/v1/vaults/$VAULT_ID/changes?since=0"
# 401 {"error":"unauthorized",…}: a wrong token
curl -sS -w ' %{http_code}\n' -H "authorization: Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
  "$SYNC_URL/v1/vaults/$VAULT_ID/changes?since=0"
# 204, then 410 {"error":"vault_deleted",…}
curl -sS -w '%{http_code}\n' -X DELETE -H "authorization: Bearer $TOKEN" \
  "$SYNC_URL/v1/vaults/$VAULT_ID"
curl -sS -w ' %{http_code}\n' -H "authorization: Bearer $TOKEN" \
  "$SYNC_URL/v1/vaults/$VAULT_ID/changes?since=0"
```

The deleted vault leaves a small marker document, so its id stays taken.

The service's logs, which never hold a note, a key, a token or a request
body:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="sonolect-sync"' \
  --limit=50 --freshness=1h
```

## 9. Build the apps with the URL

The URL is fixed when an app is built; there is no setting for it in the
apps. Without it, an app looks and behaves as before and makes no sync
request. Release builds accept only an `https://` URL with no user name,
query or fragment. Pairing links and codes never carry the URL, so every
device must run a build made with the same server.

### Desktop

Set `SONOLECT_SYNC_URL` in the shell that runs the build. Both halves read
it at build time: the webview build (`apps/desktop/vite.config.ts`) decides
whether Settings shows sync, and the Rust build
(`apps/desktop/src-tauri/src/sync.rs`) bakes in the only server it will
call.

```bash
export SONOLECT_SYNC_URL="$SYNC_URL"
pnpm --filter @sonolect/desktop tauri build
```

On Windows, with the local build script:

```powershell
$env:SONOLECT_SYNC_URL = "https://<your sync URL>"
./scripts/build-local.ps1 -Release
```

A release build ignores a URL that is not https, and then has no sync. After
building, open Settings: it must show **Sync between devices**.

CI's "Release package validation" job builds unsigned installers without the
URL. For CI-built installers that sync, add a repository variable
`SONOLECT_SYNC_URL` (the URL is public, so not a secret) and
`SONOLECT_SYNC_URL: ${{ vars.SONOLECT_SYNC_URL }}` to that job's `env` in
`.github/workflows/ci.yml`. See [release.md](release.md).

### Mobile

`EXPO_PUBLIC_SONOLECT_SYNC_URL` is inlined into the JavaScript bundle when
the app is bundled, and `apps/mobile/config/release.cjs` stops a build whose
URL is malformed, or plain http in a release build. Preview and production
builds are not development builds, so the app accepts only the https URL
there: a preview build with a plain-http URL has no sync.

- **EAS Build**: store the variable in the EAS environments the profiles in
  [apps/mobile/eas.json](../apps/mobile/eas.json) use: `production` for the
  production profile and, by EAS's default for internal builds, `preview`
  for the preview profile. Use plain-text visibility: `eas build` reads
  `app.config.js` on your computer, where secret variables are not available,
  and the URL is public anyway.

  ```bash
  cd apps/mobile
  eas env:set --name EXPO_PUBLIC_SONOLECT_SYNC_URL --value "$SYNC_URL" \
    --environment production --environment preview --visibility plaintext
  eas build --platform all --profile production
  ```

  Older EAS CLI versions have `eas env:create` instead, with the same flags.

- **Local release build**: export `EXPO_PUBLIC_SONOLECT_SYNC_URL` next to the
  variables in [mobile-release.md](mobile-release.md#setting-the-policy-url),
  in the shell that runs `expo prebuild` and the native build, or put it in
  `apps/mobile/.env` (ignored by git; an archive started from the Xcode app
  needs the `.env` file).

After installing, open Settings: it must show the **Sync** section. The web
build never shows sync.

Turning sync on changes what leaves the phone, so update the privacy policy
and the store privacy forms first: see
[mobile-release.md](mobile-release.md#store-privacy-declarations-what-the-build-does).

## 10. Pair two devices

With two devices running builds made with the same URL:

1. On the first, open Settings › Sync and turn sync on. It creates the vault
   and shows a QR code and a 56-character code.
2. On the second, join: scan the QR code with the phone's camera app (it
   opens Sonolect's join screen), or choose to join with a code and type it.
   Both screens say that joining shares every note with whoever holds the
   code, so show the code only to your own devices.
3. Make a note on one device. Within a couple of minutes it appears on the
   other (sooner after bringing the app to the front, or with **Sync now** on
   the desktop). Edit it, then delete it, and check
   that both changes arrive.
4. In the Cloud console, Firestore shows a document under `syncVaults` per
   vault, with sealed `records` below it: no text, no note ids.

Recordings stay on the device that made them; a synced note has no audio on
the other devices.

## Running it

- **Turning sync off** on a device offers to keep the server copy (the
  other devices keep syncing) or to delete it (the vault is erased; the
  other devices say "This sync was deleted", turn sync off and keep their
  notes). Keeping it, the device first tries to upload the deletes made
  there; those it could not send are kept and go out when it joins the
  same sync again, so the deleted notes do not come back.
- **A keychain the desktop cannot read at launch** (locked, or a prompt
  declined) leaves sync on with a device problem that retries; Turn on and
  Join stay hidden, so they cannot replace the saved key.
- **Rotating the admin token**: with Terraform, run
  `terraform apply -replace=random_password.service_token`; without it, add
  a new secret version and deploy again. The apps never use this token.
- **Backups**: none are set up. Every device keeps all its notes, and a
  vault the server lost is uploaded again by the devices (a full resync).
  If you restore Firestore from a backup or an export, follow the epoch
  step in [services/sync-service/README.md](../services/sync-service/README.md#stores)
  before serving traffic again.
- **Removing everything**: first turn sync off on one device with **Delete
  the server copy**, so that the other devices turn sync off by themselves
  and keep their notes. Then delete the project
  (`gcloud projects delete "$PROJECT_ID"`), which deletes every vault left.
  A device still syncing then only fails to reach the server; its notes stay.
  To remove the service but keep the project, set
  `deletion_protection = false`, apply, then run `terraform destroy`.
