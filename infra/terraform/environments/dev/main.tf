module "sonolect" {
  source = "../.."

  project_id  = var.project_id
  region      = var.region
  environment = "dev"

  deletion_protection       = false
  firestore_location        = var.firestore_location
  bucket_location           = var.bucket_location
  enable_cloud_sql          = var.enable_cloud_sql
  private_network_self_link = var.private_network_self_link

  postgres_tier              = "db-custom-1-3840"
  postgres_disk_size_gb      = 20
  postgres_availability_type = "ZONAL"

  cloud_run_min_instances   = 0
  api_max_instances         = 3
  worker_max_instances      = 2
  allow_unauthenticated_api = true

  api_image    = var.api_image
  worker_image = var.worker_image

  vertex_location = var.vertex_location
  gemini_model    = var.gemini_model

  labels = {
    tier = "development"
  }
}
