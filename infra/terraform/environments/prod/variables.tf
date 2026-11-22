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

variable "enable_cloud_sql" {
  description = "Create Cloud SQL for prod. Off until a service needs relational state; it then needs private_network_self_link."
  type        = bool
  default     = false
}

variable "private_network_self_link" {
  description = "VPC self-link for private Cloud SQL. Required only when enable_cloud_sql is true."
  type        = string
  default     = null
}

variable "api_image" {
  description = "API container image."
  type        = string
}

variable "worker_image" {
  description = "Worker container image."
  type        = string
}

variable "vertex_location" {
  description = "Vertex AI region for polish requests. Null means the region."
  type        = string
  default     = null
}

variable "gemini_model" {
  description = "Gemini model for polish requests. Null means the module default."
  type        = string
  default     = null
}
