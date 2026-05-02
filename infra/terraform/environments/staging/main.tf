module "sonolect" {
  source = "../.."

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  deletion_protection       = true
  firestore_location        = var.firestore_location
  bucket_location           = var.bucket_location
  private_network_self_link = var.private_network_self_link

  postgres_tier              = "db-custom-2-7680"
  postgres_disk_size_gb      = 50
  postgres_availability_type = "ZONAL"

  cloud_run_min_instances   = 0
  api_max_instances         = 10
  worker_max_instances      = 5
  allow_unauthenticated_api = true

  api_image    = var.api_image
  worker_image = var.worker_image

  labels = {
    tier = "staging"
  }
}
