variable "project_id" {
  description = "GCP project ID for prod."
  type        = string
}

variable "region" {
  description = "Primary GCP region."
  type        = string
  default     = "europe-west1"
}

variable "firestore_location" {
  description = "Firestore location for prod."
  type        = string
  default     = "eur3"
}

variable "bucket_location" {
  description = "Cloud Storage location for prod."
  type        = string
  default     = "EU"
}

variable "private_network_self_link" {
  description = "VPC self-link for private Cloud SQL. Required before production apply."
  type        = string
}

variable "api_image" {
  description = "API container image."
  type        = string
}

variable "worker_image" {
  description = "Worker container image."
  type        = string
}
