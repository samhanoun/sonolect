module "sonolect" {
  source = "../.."

  project_id  = var.project_id
  region      = var.region
  environment = "prod"

  deletion_protection       = true
  firestore_location        = var.firestore_location
  bucket_location           = var.bucket_location
  enable_cloud_sql          = var.enable_cloud_sql
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

  vertex_location = var.vertex_location
  gemini_model    = var.gemini_model

  labels = {
    tier = "production"
  }
}
