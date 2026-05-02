output "project_id" {
  description = "GCP project ID."
  value       = var.project_id
}

output "environment" {
  description = "Deployment environment."
  value       = var.environment
}

output "cloud_run_urls" {
  description = "Cloud Run service URLs by service name."
  value       = { for name, service in google_cloud_run_v2_service.services : name => service.uri }
}

output "cloud_run_runtime_service_account" {
  description = "Runtime service account email used by Cloud Run services."
  value       = google_service_account.cloud_run.email
}

output "ci_deploy_service_account" {
  description = "Service account intended for GitHub Actions Workload Identity Federation."
  value       = google_service_account.ci_deploy.email
}

output "firestore_database" {
  description = "Firestore native database name."
  value       = google_firestore_database.default.name
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL PostgreSQL connection name."
  value       = google_sql_database_instance.postgres.connection_name
}

output "storage_bucket_name" {
  description = "Primary application storage bucket."
  value       = google_storage_bucket.app.name
}

output "pubsub_topics" {
  description = "Pub/Sub topic names."
  value       = { for name, topic in google_pubsub_topic.topics : name => topic.name }
}

output "secret_ids" {
  description = "Secret Manager placeholder secret IDs. Populate secret versions out-of-band."
  value       = { for name, secret in google_secret_manager_secret.placeholders : name => secret.secret_id }
}
