# Tests of the platform root with mocked providers. They need no Google
# account and no network: run `terraform init -backend=false` and then
# `terraform test` in infra/terraform.

mock_provider "google" {
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}

mock_provider "random" {}

variables {
  project_id  = "sonolect-test"
  environment = "dev"
}

run "cloud_sql_is_off_by_default" {
  command = plan

  assert {
    condition     = length(google_sql_database_instance.postgres) == 0 && length(google_sql_database.app) == 0
    error_message = "Cloud SQL must not be created unless enable_cloud_sql is true."
  }

  assert {
    condition     = !contains(keys(google_project_service.services), "sqladmin.googleapis.com")
    error_message = "The Cloud SQL Admin API is enabled without Cloud SQL."
  }

  assert {
    condition     = alltrue([for binding in google_project_iam_member.runtime : binding.role != "roles/cloudsql.client"])
    error_message = "A runtime account gets roles/cloudsql.client without Cloud SQL."
  }
}

run "cloud_sql_needs_a_private_network" {
  command = plan

  variables {
    enable_cloud_sql = true
  }

  expect_failures = [google_sql_database_instance.postgres]
}

run "cloud_sql_with_a_private_network" {
  command = plan

  variables {
    enable_cloud_sql          = true
    private_network_self_link = "projects/sonolect-test/global/networks/sonolect"
  }

  assert {
    condition     = length(google_sql_database_instance.postgres) == 1 && length(google_sql_database.app) == 1
    error_message = "enable_cloud_sql must create the instance and its database."
  }

  assert {
    condition     = contains(keys(google_project_service.services), "sqladmin.googleapis.com")
    error_message = "Cloud SQL needs the Cloud SQL Admin API."
  }

  assert {
    condition = alltrue([
      contains(keys(google_project_iam_member.runtime), "api/roles/cloudsql.client"),
      contains(keys(google_project_iam_member.runtime), "worker/roles/cloudsql.client"),
    ])
    error_message = "Both runtime accounts need roles/cloudsql.client with Cloud SQL."
  }
}

run "runtime_accounts_and_grants" {
  command = apply

  assert {
    condition = alltrue([
      google_cloud_run_v2_service.services["api"].template[0].service_account == google_service_account.runtime["api"].email,
      google_cloud_run_v2_service.services["worker"].template[0].service_account == google_service_account.runtime["worker"].email,
      google_service_account.runtime["api"].email != google_service_account.runtime["worker"].email,
    ])
    error_message = "The API and the worker must each run as their own service account."
  }

  assert {
    condition     = google_secret_manager_secret_iam_member.service_tokens_accessor.member == "serviceAccount:${google_service_account.runtime["worker"].email}"
    error_message = "Only the worker may read the service-token secret."
  }

  assert {
    condition     = alltrue([for binding in google_project_iam_member.runtime : binding.role != "roles/secretmanager.secretAccessor"])
    error_message = "No runtime account may read every secret in the project."
  }

  assert {
    condition = alltrue([
      google_project_iam_member.runtime["api/roles/speech.client"].member == "serviceAccount:${google_service_account.runtime["api"].email}",
      contains(keys(google_project_iam_member.runtime), "api/roles/aiplatform.user"),
      !contains(keys(google_project_iam_member.runtime), "worker/roles/speech.client"),
      !contains(keys(google_project_iam_member.runtime), "worker/roles/aiplatform.user"),
    ])
    error_message = "Only the API calls Speech-to-Text v2 and Vertex AI, and it needs both roles."
  }

  assert {
    condition     = contains(keys(google_project_service.services), "cloudresourcemanager.googleapis.com")
    error_message = "The project IAM bindings need the Cloud Resource Manager API."
  }
}

run "vertex_location_follows_the_region" {
  command = plan

  assert {
    condition = alltrue([
      for service in google_cloud_run_v2_service.services : one([for env in service.template[0].containers[0].env : env.value if env.name == "SONOLECT_VERTEX_LOCATION"]) == "europe-west1"
    ])
    error_message = "Polish requests must stay in the platform's region by default."
  }

  assert {
    condition = alltrue([
      for service in google_cloud_run_v2_service.services : one([for env in service.template[0].containers[0].env : env.value if env.name == "SONOLECT_GEMINI_MODEL"]) == "gemini-2.5-flash"
    ])
    error_message = "The default Gemini model must be gemini-2.5-flash."
  }
}

run "vertex_location_and_model_can_be_set" {
  command = plan

  variables {
    vertex_location = "europe-west4"
    gemini_model    = "gemini-2.5-pro"
  }

  assert {
    condition     = one([for env in google_cloud_run_v2_service.services["api"].template[0].containers[0].env : env.value if env.name == "SONOLECT_VERTEX_LOCATION"]) == "europe-west4"
    error_message = "vertex_location must reach the API."
  }

  assert {
    condition     = one([for env in google_cloud_run_v2_service.services["api"].template[0].containers[0].env : env.value if env.name == "SONOLECT_GEMINI_MODEL"]) == "gemini-2.5-pro"
    error_message = "gemini_model must reach the API."
  }
}

run "dead_letters_are_forwarded_and_kept" {
  command = apply

  assert {
    condition     = google_pubsub_topic_iam_member.dead_letter_publisher.member == "serviceAccount:service-123456789012@gcp-sa-pubsub.iam.gserviceaccount.com"
    error_message = "The Pub/Sub service agent must be able to publish to the dead-letter topic."
  }

  assert {
    condition = alltrue([
      for name, subscription in google_pubsub_subscription.worker_subscriptions :
      google_pubsub_subscription_iam_member.dead_letter_subscriber[name].subscription == subscription.name
    ]) && length(google_pubsub_subscription_iam_member.dead_letter_subscriber) == length(google_pubsub_subscription.worker_subscriptions)
    error_message = "The Pub/Sub service agent must be a subscriber on every source subscription."
  }

  assert {
    condition = (
      google_pubsub_subscription.dead_letter.topic == google_pubsub_topic.dead_letter.name &&
      google_pubsub_subscription.dead_letter.expiration_policy[0].ttl == ""
    )
    error_message = "The dead-letter topic needs a subscription that never expires, or dead letters are dropped."
  }
}
