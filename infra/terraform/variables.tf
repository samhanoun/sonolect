variable "project_id" {
  description = "GCP project ID for the target environment."
  type        = string
}

variable "region" {
  description = "Primary GCP region for regional resources."
  type        = string
  default     = "europe-west1"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "labels" {
  description = "Additional labels applied to resources that support labels."
  type        = map(string)
  default     = {}
}

variable "deletion_protection" {
  description = "Enable deletion protection for stateful services and Cloud Run. Should be true in prod."
  type        = bool
  default     = false
}

variable "firestore_location" {
  description = "Firestore native database location."
  type        = string
  default     = "eur3"
}

variable "bucket_location" {
  description = "Cloud Storage bucket location."
  type        = string
  default     = "EU"
}

variable "private_network_self_link" {
  description = "Self-link of the VPC network used for private Cloud SQL connectivity."
  type        = string
  default     = null
}

variable "postgres_version" {
  description = "Cloud SQL PostgreSQL engine version."
  type        = string
  default     = "POSTGRES_16"
}

variable "postgres_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "postgres_disk_size_gb" {
  description = "Cloud SQL SSD disk size in GiB."
  type        = number
  default     = 20
}

variable "postgres_availability_type" {
  description = "Cloud SQL availability type, usually ZONAL for dev and REGIONAL for prod."
  type        = string
  default     = "ZONAL"
}

variable "pubsub_message_retention" {
  description = "Pub/Sub message retention duration."
  type        = string
  default     = "604800s"
}

variable "cloud_run_ingress" {
  description = "Cloud Run ingress policy."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "cloud_run_min_instances" {
  description = "Minimum Cloud Run instances for each service."
  type        = number
  default     = 0
}

variable "allow_unauthenticated_api" {
  description = "Whether the API Cloud Run service is publicly invokable. Disable when fronted by IAP/API gateway."
  type        = bool
  default     = true
}

variable "api_image" {
  description = "Container image for the API service. Replace placeholder before apply."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "worker_image" {
  description = "Container image for the worker service. Replace placeholder before apply."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "api_cpu" {
  description = "API Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "api_memory" {
  description = "API Cloud Run memory limit."
  type        = string
  default     = "512Mi"
}

variable "api_max_instances" {
  description = "API Cloud Run max instance count."
  type        = number
  default     = 10
}

variable "worker_cpu" {
  description = "Worker Cloud Run CPU limit."
  type        = string
  default     = "1"
}

variable "worker_memory" {
  description = "Worker Cloud Run memory limit."
  type        = string
  default     = "512Mi"
}

variable "worker_max_instances" {
  description = "Worker Cloud Run max instance count."
  type        = number
  default     = 5
}
