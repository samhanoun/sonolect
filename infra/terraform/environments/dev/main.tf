module "sonolect" {
  source      = "../.."
  project_id  = var.project_id
  region      = var.region
  environment = "dev"
}
