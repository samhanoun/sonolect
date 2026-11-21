output "service_url" {
  description = "The URL to build the apps with (SONOLECT_SYNC_URL, EXPO_PUBLIC_SONOLECT_SYNC_URL): the custom domain when one is set, else the run.app URL."
  value       = local.service_url
}

output "run_app_url" {
  description = "The service's run.app URL. It keeps working with or without a custom domain."
  value       = google_cloud_run_v2_service.sync.uri
}

output "domain_dns_records" {
  description = "DNS records to add at your DNS host for the custom domain (empty without one, and until Cloud Run has created the mapping)."
  value = flatten([
    for mapping in google_cloud_run_domain_mapping.sync : [
      for status in mapping.status : [
        for record in status.resource_records : {
          name   = record.name
          type   = record.type
          rrdata = record.rrdata
        }
      ]
    ]
  ])
}

output "service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.sync.name
}

output "runtime_service_account" {
  description = "Runtime service account of the sync service."
  value       = google_service_account.sync.email
}

output "firestore_database" {
  description = "Firestore database that holds the vaults."
  value       = google_firestore_database.sync.name
}

output "service_tokens_secret" {
  description = "Secret Manager secret with the admin service token (read it with gcloud secrets versions access latest --secret=<this>)."
  value       = google_secret_manager_secret.service_tokens.secret_id
}
