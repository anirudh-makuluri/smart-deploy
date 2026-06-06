variable "aws_region" {
  description = "AWS region (must match Smart Deploy AWS_REGION)"
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Tag prefix for resources"
  type        = string
  default     = "smart-deploy"
}

variable "environment" {
  description = "Environment label for tags"
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "VPC for ECS Fargate tasks and ALB. Empty = default VPC."
  type        = string
  default     = ""
}

variable "ecs_subnet_ids" {
  description = "Subnet IDs for Fargate + shared ALB (≥2 AZs recommended). Empty = auto-pick public subnets in the VPC."
  type        = list(string)
  default     = []
}

# ── Static sites (S3 + CloudFront) ───────────────────────────────────────────

variable "s3_bucket_name" {
  description = "Globally unique S3 bucket for static_build deploy output"
  type        = string
  default     = "smart-deploy-static-site"
}

variable "create_s3_bucket" {
  description = "Create and manage the S3 bucket. Set false if the bucket already exists (import or data-only)."
  type        = bool
  default     = true
}

variable "cloudfront_spa_fallback" {
  description = "Map CloudFront 403/404 to index.html (SPA client-side routing)"
  type        = bool
  default     = true
}

variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
}

# ── ECS Fargate ──────────────────────────────────────────────────────────────

variable "ecs_cluster_name" {
  description = "ECS cluster name (Smart Deploy ECS_CLUSTER_NAME)"
  type        = string
  default     = "smart-deploy-cluster"
}

variable "create_ecs_cluster" {
  description = "Create the ECS cluster. Set false if it already exists."
  type        = bool
  default     = true
}

variable "ecs_execution_role_name" {
  description = "IAM role name for Fargate task execution (ECR pull + logs)"
  type        = string
  default     = "smartdeploy-ecs-execution"
}

variable "ecs_log_group_name" {
  description = "CloudWatch log group for Railpack ECS tasks (ECS_LOG_GROUP)"
  type        = string
  default     = "/ecs/smartdeploy-railpack"
}

variable "ecs_log_retention_days" {
  description = "CloudWatch Logs retention for ECS tasks"
  type        = number
  default     = 14
}
