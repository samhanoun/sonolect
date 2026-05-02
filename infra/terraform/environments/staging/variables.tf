variable "project_id" {
  description = "GCP project ID for staging."
  type        = string
}

variable "region" {
  description = "Primary GCP region."
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Firestore location for staging."
  type        = string
  default     = "eur3"
}

variable "bucket_location" {
  description = "Cloud Storage location for staging."
  type        = string
  default     = "EU"
}

variable "private_network_self_link" {
  description = "VPC self-link for private Cloud SQL. Leave null until networking module is added."
  type        = string
  default     = null
}

variable "api_image" {
  description = "API container image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "worker_image" {
  description = "Worker container image."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
