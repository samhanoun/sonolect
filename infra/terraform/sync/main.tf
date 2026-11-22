# The end-to-end encrypted note sync service on its own: Firestore, a
# runtime service account, the service-token secret and a public Cloud Run
# service. It is a standalone root, apart from ../ (the full platform, which
# can also create Cloud SQL, and that needs a private VPC sync does not use).
# docs/sync-setup.md is the runbook.

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  name = "sonolect-sync"
  labels = merge(var.labels, {
    app          = "sonolect"
    component    = "sync"
    "managed-by" = "terraform"
  })

  service_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com"
  ])

  # The regions where Cloud Run offers domain mappings (a Preview feature),
  # from https://cloud.google.com/run/docs/mapping-custom-domains as of
  # 2026-11. Elsewhere, use the run.app URL or put a load balancer or
  # Firebase Hosting in front.
  domain_mapping_regions = toset([
    "asia-east1",
    "asia-northeast1",
    "asia-southeast1",
    "europe-north1",
    "europe-west1",
    "europe-west4",
    "us-central1",
    "us-east1",
    "us-east4",
    "us-west1"
  ])

  database_resource = "projects/${var.project_id}/databases/${google_firestore_database.sync.name}"
  service_url       = var.domain == null ? google_cloud_run_v2_service.sync.uri : "https://${var.domain}"
}

resource "google_project_service" "services" {
  for_each = local.service_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# The vaults and their sealed records. The service needs no composite index
# (only the exemption below) and deliberately no TTL policy: it purges
# tombstones 90 days after a delete itself, in transactions that also update
# the vault's record and byte counters and its purge cursor, which a TTL
# deletion would bypass. See services/sync-service/README.md.
resource "google_firestore_database" "sync" {
  project                     = var.project_id
  name                        = var.firestore_database
  location_id                 = var.firestore_location
  type                        = "FIRESTORE_NATIVE"
  app_engine_integration_mode = "DISABLED"
  # Firestore's default for native databases: a transaction locks the
  # documents it reads, so two devices writing to one vault mostly wait for
  # each other on the vault document rather than retry.
  concurrency_mode        = "PESSIMISTIC"
  delete_protection_state = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
  # With protection on, `terraform destroy` stops here instead of deleting
  # every vault.
  deletion_policy = var.deletion_protection ? "PREVENT" : "DELETE"

  depends_on = [google_project_service.services]
}

# Each record's sealed ciphertext (`ct`, up to 768 KiB) is never queried, so
# it gets no single-field index: Firestore would otherwise index its first
# 1,500 bytes twice (ascending and descending) on every write. The queries
# use `seq` and `tombstoneAt`, which keep their automatic indexes.
resource "google_firestore_field" "record_ciphertext" {
  project    = var.project_id
  database   = google_firestore_database.sync.name
  collection = "records"
  field      = "ct"

  # An empty block turns off every index on the field.
  index_config {}
}

resource "google_service_account" "sync" {
  account_id   = "${local.name}-run"
  display_name = "Sonolect sync service runtime"
  description  = "Runtime identity of the Cloud Run sync service: its Firestore database and its service-token secret, nothing else."

  depends_on = [google_project_service.services]
}

# Read and write access to the sync database only. The condition matters
# when the project holds other Firestore databases.
resource "google_project_iam_member" "sync_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.sync.email}"

  condition {
    title       = "sonolect-sync-database-only"
    description = "Only the Firestore database of the Sonolect sync service."
    expression  = "resource.name == \"${local.database_resource}\""
  }

  depends_on = [google_project_service.services]
}

# The service token that guards the admin route (GET /v1/admin/status).
# Production refuses to start without one. It is generated here, kept in
# Secret Manager and in the Terraform state, and handed to the service as
# SONOLECT_SERVICE_TOKENS. The vault routes do not use it.
resource "random_password" "service_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "service_tokens" {
  secret_id = "${local.name}-service-tokens"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "service_tokens" {
  secret      = google_secret_manager_secret.service_tokens.id
  secret_data = random_password.service_token.result
}

resource "google_secret_manager_secret_iam_member" "service_tokens_accessor" {
  secret_id = google_secret_manager_secret.service_tokens.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.sync.email}"
}

resource "google_cloud_run_v2_service" "sync" {
  name                = local.name
  location            = var.region
  description         = "Sonolect end-to-end encrypted note sync"
  deletion_protection = var.deletion_protection
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels              = local.labels
  # Public either way: through the allUsers binding below, or, where an
  # organization policy forbids allUsers, by skipping the invoker check.
  invoker_iam_disabled = var.skip_invoker_check

  template {
    service_account = google_service_account.sync.email
    # A request is one page or one batch of at most 100 records; the apps
    # give up after 30 seconds.
    timeout = "60s"
    # Each request may carry a 5 MiB body, so a small instance takes a few
    # at a time and Cloud Run queues the rest.
    max_instance_request_concurrency = var.max_concurrency
    labels                           = local.labels

    # Scales to zero. The rate limits are kept per instance, so more
    # instances would multiply them.
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # CPU only while a request is in flight (request-based billing).
        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 2
        timeout_seconds   = 1
        failure_threshold = 30
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "SONOLECT_SYNC_STORE"
        value = "firestore"
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "SONOLECT_SYNC_FIRESTORE_DATABASE"
        value = google_firestore_database.sync.name
      }

      # Unset, the service trusts one X-Forwarded-For hop on Cloud Run.
      dynamic "env" {
        for_each = var.trust_proxy_hops == null ? [] : [var.trust_proxy_hops]
        content {
          name  = "SONOLECT_SYNC_TRUST_PROXY"
          value = tostring(env.value)
        }
      }

      env {
        name = "SONOLECT_SERVICE_TOKENS"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.service_tokens.secret_id
            version = google_secret_manager_secret_version.service_tokens.version
          }
        }
      }
    }
  }

  # gcloud sets these when someone deploys a revision by hand; they are not
  # configuration.
  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    google_project_service.services,
    google_project_iam_member.sync_firestore_user,
    google_secret_manager_secret_iam_member.service_tokens_accessor
  ]
}

# The apps call the service directly, and each vault checks its own bearer
# token, so anyone may invoke it (as the API's invoker in ../main.tf).
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.skip_invoker_check ? 0 : 1

  project  = var.project_id
  location = google_cloud_run_v2_service.sync.location
  name     = google_cloud_run_v2_service.sync.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Optional: serve the service on your own domain. The identity running
# Terraform must be a verified owner of the domain (Search Console), and the
# DNS records in the `domain_dns_records` output must be added at the DNS
# host. Google then issues the certificate.
resource "google_cloud_run_domain_mapping" "sync" {
  count = var.domain == null ? 0 : 1

  name     = var.domain
  location = google_cloud_run_v2_service.sync.location

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.sync.name
  }

  lifecycle {
    precondition {
      condition     = contains(local.domain_mapping_regions, var.region)
      error_message = "Cloud Run domain mappings are not offered in ${var.region}. Leave domain unset and use the run.app URL, pick a region from local.domain_mapping_regions, or put a load balancer or Firebase Hosting in front."
    }
  }
}
