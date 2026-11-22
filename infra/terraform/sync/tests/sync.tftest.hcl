# Tests of the sync root with mocked providers. They need no Google account
# and no network: run `terraform init -backend=false` and then
# `terraform test` in infra/terraform/sync.

mock_provider "google" {}

mock_provider "random" {}

variables {
  project_id         = "sonolect-sync-123456"
  region             = "europe-west1"
  firestore_location = "europe-west1"
  image              = "europe-west1-docker.pkg.dev/sonolect-sync-123456/sonolect/sync-service:0123456789ab"
}

run "ciphertext_is_not_indexed" {
  command = plan

  assert {
    condition     = google_firestore_field.record_ciphertext.collection == "records" && google_firestore_field.record_ciphertext.field == "ct"
    error_message = "The exemption must cover the ct field of the records collection group."
  }

  assert {
    condition     = google_firestore_field.record_ciphertext.database == google_firestore_database.sync.name
    error_message = "The exemption must be on the sync database."
  }

  assert {
    condition     = length(google_firestore_field.record_ciphertext.index_config) == 1 && length(google_firestore_field.record_ciphertext.index_config[0].indexes) == 0
    error_message = "An empty index_config must turn off every index on ct."
  }
}

run "proxy_hops_unset_by_default" {
  command = plan

  assert {
    condition     = length([for env in google_cloud_run_v2_service.sync.template[0].containers[0].env : env if env.name == "SONOLECT_SYNC_TRUST_PROXY"]) == 0
    error_message = "Without trust_proxy_hops, the service must keep its Cloud Run default."
  }
}

run "proxy_hops_behind_a_load_balancer" {
  command = plan

  variables {
    trust_proxy_hops = 2
  }

  assert {
    condition     = one([for env in google_cloud_run_v2_service.sync.template[0].containers[0].env : env.value if env.name == "SONOLECT_SYNC_TRUST_PROXY"]) == "2"
    error_message = "trust_proxy_hops must reach the service as SONOLECT_SYNC_TRUST_PROXY."
  }
}

run "proxy_hops_must_be_whole" {
  command = plan

  variables {
    trust_proxy_hops = 1.5
  }

  expect_failures = [var.trust_proxy_hops]
}

run "proxy_hops_at_most_99" {
  command = plan

  variables {
    trust_proxy_hops = 100
  }

  expect_failures = [var.trust_proxy_hops]
}
