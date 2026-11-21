variable "project_id" {
  description = "GCP project that hosts the sync service. A project of its own keeps its bill and its permissions apart."
  type        = string
}

variable "region" {
  description = "Cloud Run region, for example europe-west1 or us-central1. Pick one close to your devices, and one from local.domain_mapping_regions if you want a custom domain."
  type        = string
}

variable "firestore_location" {
  description = "Firestore location: the Cloud Run region (regional) or a multi-region such as eur3 or nam5. It cannot be changed once the database exists."
  type        = string
}

variable "firestore_database" {
  description = "Firestore database id. Keep \"(default)\" in a project of its own; pick another id when the project already has a default database."
  type        = string
  default     = "(default)"

  validation {
    condition     = var.firestore_database == "(default)" || can(regex("^[a-z][a-z0-9-]{2,61}[a-z0-9]$", var.firestore_database))
    error_message = "firestore_database must be \"(default)\" or 4 to 63 lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "image" {
  description = "Sync service image in Artifact Registry, built from services/sync-service/Dockerfile, for example europe-west1-docker.pkg.dev/<project>/sonolect/sync-service:<tag>. Use a new tag (or a digest) for every build, so that apply deploys it."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[a-z0-9-]+/[a-z0-9._-]+/[a-z0-9._/-]+(:[A-Za-z0-9._-]+|@sha256:[0-9a-f]{64})$", var.image))
    error_message = "image must be an Artifact Registry path with a tag or digest: <location>-docker.pkg.dev/<project>/<repository>/<image>:<tag>."
  }
}

variable "domain" {
  description = "Optional custom domain for the service, such as sync.example.com. Leave null to use the run.app URL, which works without one."
  type        = string
  default     = null

  validation {
    condition     = var.domain == null ? true : can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain))
    error_message = "domain must be a lowercase host name such as sync.example.com, without a scheme or path."
  }

  validation {
    condition     = var.domain == null ? true : length(var.domain) <= 64
    error_message = "Cloud Run domain mappings take host names of at most 64 characters."
  }
}

variable "deletion_protection" {
  description = "Protect the Firestore database and the Cloud Run service from deletion, including by terraform destroy."
  type        = bool
  default     = true
}

variable "cpu" {
  description = "CPU limit of an instance. Cloud Run needs at least 1 for more than one request at a time."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit of an instance."
  type        = string
  default     = "512Mi"
}

variable "max_instances" {
  description = "Most instances Cloud Run may start. The service keeps its rate limits per instance, so services/sync-service/README.md asks for at most 2."
  type        = number
  default     = 2

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 2
    error_message = "max_instances must be 1 or 2: the rate limits are per instance, so more instances would multiply them."
  }
}

variable "max_concurrency" {
  description = "Requests one instance handles at a time. A request may carry a 5 MiB body; raise memory before raising this."
  type        = number
  default     = 10

  validation {
    condition     = var.max_concurrency >= 1 && var.max_concurrency <= 80
    error_message = "max_concurrency must be between 1 and 80."
  }
}

variable "labels" {
  description = "Additional labels applied to resources that support labels."
  type        = map(string)
  default     = {}
}
