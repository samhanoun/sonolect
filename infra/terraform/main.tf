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
  name_prefix = "sonolect-${var.environment}"
  labels = merge(var.labels, {
    app          = "sonolect"
    environment  = var.environment
    "managed-by" = "terraform"
  })

  # Cloud Resource Manager serves the project IAM bindings below. Cloud SQL
  # Admin is needed only with Cloud SQL.
  service_apis = setunion(
    [
      "artifactregistry.googleapis.com",
      "cloudbuild.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "run.googleapis.com",
      "firestore.googleapis.com",
      "storage.googleapis.com",
      "pubsub.googleapis.com",
      "secretmanager.googleapis.com",
      "iam.googleapis.com",
      "logging.googleapis.com",
      "monitoring.googleapis.com",
      "aiplatform.googleapis.com",
      "speech.googleapis.com"
    ],
    var.enable_cloud_sql ? ["sqladmin.googleapis.com"] : []
  )

  cloud_run_services = {
    api = {
      image          = var.api_image
      cpu            = var.api_cpu
      memory         = var.api_memory
      container_port = 8080
      max_instances  = var.api_max_instances
    }
    worker = {
      image          = var.worker_image
      cpu            = var.worker_cpu
      memory         = var.worker_memory
      container_port = 8080
      max_instances  = var.worker_max_instances
    }
  }

  pubsub_topics = toset([
    "audio-ingest",
    "transcription-jobs",
    "agent-actions",
    "billing-events"
  ])

  secret_names = toset([
    "api-jwt-public-key",
    "api-jwt-private-key",
    "database-url",
    "firebase-service-account-json",
    "openai-api-key",
    "stripe-webhook-secret"
  ])

  # Firebase ID tokens are issued for the Firebase project, which is the GCP
  # project unless a separate one is configured.
  firebase_project_id = coalesce(var.firebase_project_id, var.project_id)

  # Polish requests go to Vertex AI in the platform's own region unless
  # another one is set, so transcripts stay where the rest of the data is.
  vertex_location = coalesce(var.vertex_location, var.region)

  # Project roles of each service's runtime account. Only the API calls
  # Speech-to-Text (v2 checks speech.recognizers.recognize, which
  # roles/speech.client grants) and Vertex AI. Firestore and Pub/Sub follow
  # the data flow in docs/architecture.md: the API publishes jobs, the worker
  # consumes them and emits follow-up events.
  cloud_sql_client_roles = var.enable_cloud_sql ? ["roles/cloudsql.client"] : []
  runtime_project_roles = {
    api = concat([
      "roles/aiplatform.user",
      "roles/datastore.user",
      "roles/pubsub.publisher",
      "roles/serviceusage.serviceUsageConsumer",
      "roles/speech.client"
    ], local.cloud_sql_client_roles)
    worker = concat([
      "roles/datastore.user",
      "roles/pubsub.publisher",
      "roles/pubsub.subscriber"
    ], local.cloud_sql_client_roles)
  }
  runtime_project_bindings = merge([
    for service, roles in local.runtime_project_roles : {
      for role in roles : "${service}/${role}" => { service = service, role = role }
    }
  ]...)

  # Pub/Sub forwards undeliverable messages to the dead-letter topic with its
  # own service agent.
  pubsub_service_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_project_service" "services" {
  for_each = local.service_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# One runtime identity per Cloud Run service, so the public API cannot read
# the worker's service token or use the worker's grants.
resource "google_service_account" "runtime" {
  for_each = local.cloud_run_services

  account_id   = "${local.name_prefix}-${each.key}"
  display_name = "Sonolect ${var.environment} ${each.key} runtime"
  description  = "Runtime identity of the Sonolect ${each.key} Cloud Run service."

  depends_on = [google_project_service.services]
}

resource "google_service_account" "ci_deploy" {
  account_id   = "${local.name_prefix}-ci-deploy"
  display_name = "Sonolect ${var.environment} CI deployer"
  description  = "Workload Identity Federation target for GitHub Actions deployments."

  depends_on = [google_project_service.services]
}

resource "google_firestore_database" "default" {
  project                     = var.project_id
  name                        = "(default)"
  location_id                 = var.firestore_location
  type                        = "FIRESTORE_NATIVE"
  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"
  delete_protection_state     = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.services]
}

# Off unless enable_cloud_sql is true: no service reads or writes relational
# state yet. docs/infrastructure.md lists what a service needs before it can
# use the instance.
resource "google_sql_database_instance" "postgres" {
  count = var.enable_cloud_sql ? 1 : 0

  name             = "${local.name_prefix}-postgres"
  region           = var.region
  database_version = var.postgres_version

  settings {
    tier              = var.postgres_tier
    availability_type = var.postgres_availability_type
    disk_type         = "PD_SSD"
    disk_size         = var.postgres_disk_size_gb
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = var.environment == "prod" ? 7 : 3
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.private_network_self_link
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    user_labels = local.labels
  }

  deletion_protection = var.deletion_protection

  lifecycle {
    # The instance has a private IP only. Without a network Google refuses
    # to create it.
    precondition {
      condition     = var.private_network_self_link != null && var.private_network_self_link != ""
      error_message = "enable_cloud_sql needs private_network_self_link: the Cloud SQL instance has a private IP only."
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  count = var.enable_cloud_sql ? 1 : 0

  name     = "sonolect"
  instance = google_sql_database_instance.postgres[0].name
}

resource "google_storage_bucket" "app" {
  name                        = "${var.project_id}-${local.name_prefix}-app"
  location                    = var.bucket_location
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.environment != "prod"
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.environment == "prod" ? 365 : 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.services]
}

resource "google_pubsub_topic" "topics" {
  for_each = local.pubsub_topics

  name    = "${local.name_prefix}-${each.value}"
  labels  = local.labels
  project = var.project_id

  message_retention_duration = var.pubsub_message_retention

  depends_on = [google_project_service.services]
}

resource "google_pubsub_subscription" "worker_subscriptions" {
  for_each = google_pubsub_topic.topics

  name  = "${each.value.name}-worker"
  topic = each.value.name

  ack_deadline_seconds       = 60
  message_retention_duration = var.pubsub_message_retention
  retain_acked_messages      = false

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

resource "google_pubsub_topic" "dead_letter" {
  name    = "${local.name_prefix}-dead-letter"
  labels  = local.labels
  project = var.project_id

  depends_on = [google_project_service.services]
}

# Keeps dead letters for inspection and manual replay: a topic without a
# subscription keeps nothing. Nothing pulls from it in normal operation, so
# it must never expire.
resource "google_pubsub_subscription" "dead_letter" {
  name  = "${google_pubsub_topic.dead_letter.name}-inspect"
  topic = google_pubsub_topic.dead_letter.name

  ack_deadline_seconds       = 60
  message_retention_duration = var.pubsub_message_retention
  retain_acked_messages      = false

  expiration_policy {
    ttl = ""
  }
}

# Pub/Sub forwards a message to the dead-letter topic only when its service
# agent may publish there and acknowledge on the source subscription.
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.dead_letter.name
  role    = "roles/pubsub.publisher"
  member  = local.pubsub_service_agent
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  for_each = google_pubsub_subscription.worker_subscriptions

  project      = var.project_id
  subscription = each.value.name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_service_agent
}

resource "google_secret_manager_secret" "placeholders" {
  for_each = local.secret_names

  secret_id = "${local.name_prefix}-${each.value}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

# The worker only accepts calls that carry this shared service token
# (SONOLECT_SERVICE_TOKENS). It is generated here and handed to the worker
# through Secret Manager, so no deployment can come up unauthenticated.
resource "random_password" "service_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "service_tokens" {
  secret_id = "${local.name_prefix}-service-tokens"
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

# Only the worker mounts a secret. Each account gets access to the secrets
# its service mounts and to no other secret in the project.
resource "google_secret_manager_secret_iam_member" "service_tokens_accessor" {
  secret_id = google_secret_manager_secret.service_tokens.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime["worker"].email}"
}

resource "google_cloud_run_v2_service" "services" {
  for_each = local.cloud_run_services

  name                = "${local.name_prefix}-${each.key}"
  location            = var.region
  deletion_protection = var.deletion_protection
  ingress             = var.cloud_run_ingress
  labels              = local.labels

  template {
    service_account = google_service_account.runtime[each.key].email
    timeout         = "300s"

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      image = each.value.image

      ports {
        container_port = each.value.container_port
      }

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
      }

      # Every deployed environment runs in production mode. Development mode
      # binds the API to loopback, which Cloud Run cannot reach, and switches
      # authentication off.
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # The API refuses to start in production without the Firebase project
      # whose ID tokens it verifies.
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = local.firebase_project_id
      }

      # Browser origins allowed by CORS. Without this the API allows none.
      env {
        name  = "SONOLECT_ALLOWED_ORIGINS"
        value = join(",", var.allowed_origins)
      }

      dynamic "env" {
        for_each = each.key == "worker" ? [1] : []
        content {
          name = "SONOLECT_SERVICE_TOKENS"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.service_tokens.secret_id
              version = google_secret_manager_secret_version.service_tokens.version
            }
          }
        }
      }

      env {
        name  = "SONOLECT_ENV"
        value = var.environment
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "SONOLECT_VERTEX_LOCATION"
        value = local.vertex_location
      }

      env {
        name  = "SONOLECT_GEMINI_MODEL"
        value = var.gemini_model
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_firestore_database.default,
    google_sql_database.app,
    google_storage_bucket.app,
    google_secret_manager_secret.placeholders,
    google_secret_manager_secret_iam_member.service_tokens_accessor
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  count = var.allow_unauthenticated_api ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.services["api"].location
  name     = google_cloud_run_v2_service.services["api"].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The roles in local.runtime_project_roles. No account gets Secret Manager
# access on the whole project: see service_tokens_accessor.
resource "google_project_iam_member" "runtime" {
  for_each = local.runtime_project_bindings

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.runtime[each.value.service].email}"

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket_iam_member" "runtime_storage_object_user" {
  for_each = google_service_account.runtime

  bucket = google_storage_bucket.app.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${each.value.email}"
}
