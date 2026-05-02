module "sonolect" {
  source = "../.."

  project_id  = var.project_id
  region      = var.region
  environment = "prod"

  deletion_protection       = true
  firestore_location        = var.firestore_location
  bucket_location           = var.bucket_location
  private_network_self_link = var.private_network_self_link

  postgres_tier              = "db-custom-4-15360"
  postgres_disk_size_gb      = 100
  postgres_availability_type = "REGIONAL"

  cloud_run_min_instances   = 1
  api_max_instances         = 50
  worker_max_instances      = 20
  allow_unauthenticated_api = false

  api_image    = var.api_image
  worker_image = var.worker_image

  labels = {
    tier = "production"
  }
}
