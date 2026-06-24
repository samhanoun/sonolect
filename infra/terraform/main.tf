terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
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

  service_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "firestore.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "aiplatform.googleapis.com",
    "speech.googleapis.com"
  ])

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
}

resource "google_project_service" "services" {
  for_each = local.service_apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "cloud_run" {
  account_id   = "${local.name_prefix}-run"
  display_name = "Sonolect ${var.environment} Cloud Run runtime"
  description  = "Runtime identity for Sonolect API and worker Cloud Run services."

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

resource "google_sql_database_instance" "postgres" {
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

  depends_on = [google_project_service.services]
}

resource "google_sql_database" "app" {
  name     = "sonolect"
  instance = google_sql_database_instance.postgres.name
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

resource "google_secret_manager_secret" "placeholders" {
  for_each = local.secret_names

  secret_id = "${local.name_prefix}-${each.value}"
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_cloud_run_v2_service" "services" {
  for_each = local.cloud_run_services

  name                = "${local.name_prefix}-${each.key}"
  location            = var.region
  deletion_protection = var.deletion_protection
  ingress             = var.cloud_run_ingress
  labels              = local.labels

  template {
    service_account = google_service_account.cloud_run.email
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

      env {
        name  = "NODE_ENV"
        value = var.environment == "prod" ? "production" : "development"
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
        value = "us-central1"
      }

      env {
        name  = "SONOLECT_GEMINI_MODEL"
        value = "gemini-2.0-flash"
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_firestore_database.default,
    google_sql_database.app,
    google_storage_bucket.app,
    google_secret_manager_secret.placeholders
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

resource "google_project_iam_member" "cloud_run_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_storage_bucket_iam_member" "cloud_run_storage_object_user" {
  bucket = google_storage_bucket.app.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_vertex_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Speech-to-Text v2 is callable once the API is enabled and the service account
# can consume project services. If org policy requires a granular Speech role,
# add roles/speech.client here as well.
resource "google_project_iam_member" "cloud_run_service_usage" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_project_iam_member" "cloud_run_pubsub_subscriber" {
  project = var.project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}
