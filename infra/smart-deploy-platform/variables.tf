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
  description = "Subnet IDs for Fargate + shared ALB (>=2 AZs recommended). Empty = auto-pick public subnets in the VPC."
  type        = list(string)
  default     = []
}

# Runtime state (DynamoDB)

variable "runtime_dynamodb_table_name" {
  description = "DynamoDB table for Smart Deploy runtime state (deploy logs, health history, and other worker-owned state)"
  type        = string
  default     = "smart-deploy-runtime"
}

# Deployment queue (SQS -> Lambda -> ECS RunTask)

variable "enable_deployment_queue" {
  description = "Create the deployment FIFO queue, queue-launcher Lambda, and SQS trigger."
  type        = bool
  default     = false
}

variable "deployment_queue_name" {
  description = "SQS FIFO queue name. Empty = derive from project/environment."
  type        = string
  default     = ""
}

variable "deployment_queue_dlq_name" {
  description = "Dead-letter SQS FIFO queue name. Empty = derive from project/environment."
  type        = string
  default     = ""
}

variable "deployment_queue_visibility_timeout_seconds" {
  description = "Visibility timeout for the deployment queue."
  type        = number
  default     = 180
}

variable "deployment_queue_max_receive_count" {
  description = "How many failed receives before a message moves to the DLQ."
  type        = number
  default     = 5
}

variable "deployment_queue_lambda_function_name" {
  description = "Lambda function name for the queue launcher. Empty = derive from project/environment."
  type        = string
  default     = ""
}

variable "deployment_queue_lambda_image_uri" {
  description = "ECR image URI for the deployment queue Lambda container."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_deployment_queue || var.deployment_queue_lambda_image_uri != ""
    error_message = "deployment_queue_lambda_image_uri must be set when enable_deployment_queue is true."
  }
}

variable "deployment_queue_lambda_timeout_seconds" {
  description = "Lambda timeout for reading a queue message, updating DB state, and launching ECS."
  type        = number
  default     = 60
}

variable "deployment_queue_lambda_memory_size" {
  description = "Memory size (MB) for the deployment queue Lambda."
  type        = number
  default     = 512
}

variable "deployment_queue_lambda_log_retention_days" {
  description = "CloudWatch Logs retention for the deployment queue Lambda."
  type        = number
  default     = 14
}

variable "deployment_queue_lambda_db_pool_max" {
  description = "DB_POOL_MAX passed to the deployment queue Lambda."
  type        = number
  default     = 5
}

variable "supabase_url" {
  description = "Supabase project URL used by the deployment queue Lambda."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_deployment_queue || var.supabase_url != ""
    error_message = "supabase_url must be set when enable_deployment_queue is true."
  }
}

variable "supabase_service_role_key" {
  description = "Supabase service role key used by the deployment queue Lambda."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = !var.enable_deployment_queue || var.supabase_service_role_key != ""
    error_message = "supabase_service_role_key must be set when enable_deployment_queue is true."
  }
}

variable "database_url" {
  description = "Postgres connection string used by the deployment queue Lambda."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = !var.enable_deployment_queue || var.database_url != ""
    error_message = "database_url must be set when enable_deployment_queue is true."
  }
}

variable "deployment_worker_image" {
  description = "Container image for the one-off deployment worker task."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_deployment_queue || var.deployment_worker_image != ""
    error_message = "deployment_worker_image must be set when enable_deployment_queue is true."
  }
}

variable "deployment_worker_container_name" {
  description = "Container name to override when starting the deployment worker task."
  type        = string
  default     = "smart-deploy-worker"
}

variable "deployment_worker_task_cpu" {
  description = "CPU units for the one-off deployment worker task definition."
  type        = string
  default     = "1024"
}

variable "deployment_worker_task_memory" {
  description = "Memory (MiB) for the one-off deployment worker task definition."
  type        = string
  default     = "2048"
}

variable "deployment_worker_cluster_name" {
  description = "ECS cluster name for the deployment worker task. Empty = reuse ecs_cluster_name."
  type        = string
  default     = ""
}

variable "deployment_worker_subnet_ids" {
  description = "Subnet IDs for the deployment worker task. Empty = reuse ECS subnets."
  type        = list(string)
  default     = []
}

variable "deployment_worker_security_group_ids" {
  description = "Security group IDs for the deployment worker task. Empty = reuse the shared Fargate security group."
  type        = list(string)
  default     = []
}

variable "deployment_worker_assign_public_ip" {
  description = "Assign public IP for the deployment worker task. Empty = ENABLED."
  type        = string
  default     = ""
}

variable "deployment_worker_secret_arn" {
  description = "Optional Secrets Manager secret ARN containing deployment worker runtime env as JSON or dotenv text."
  type        = string
  default     = ""
}

variable "deployment_worker_task_role_name" {
  description = "IAM role name for the deployment worker task. Empty = derive from project/environment."
  type        = string
  default     = ""
}

# Static sites (S3 + CloudFront)

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

# ECS Fargate

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

# Route 53 (deployment subdomains)

variable "deployment_domain" {
  description = "Base domain for deploy URLs (NEXT_PUBLIC_DEPLOYMENT_DOMAIN), e.g. smart-deploy.xyz"
  type        = string
  default     = ""
}

variable "route53_hosted_zone_id" {
  description = "Route 53 hosted zone ID (ROUTE53_HOSTED_ZONE_ID). If empty, lookup by deployment_domain."
  type        = string
  default     = ""
}

variable "shared_alb_dns_name" {
  description = "Shared ALB DNS name for wildcard record (*.deployment_domain). Set after first ECS deploy."
  type        = string
  default     = ""
}
