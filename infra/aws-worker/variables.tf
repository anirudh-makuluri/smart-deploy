variable "aws_region" {
  description = "AWS region for the worker instance"
  type        = string
  default     = "us-west-2"
}

variable "project_name" {
  description = "Project tag prefix"
  type        = string
  default     = "smart-deploy"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "key_name" {
  description = "Optional EC2 key pair name for SSH"
  type        = string
  default     = ""
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH to the instance"
  type        = string
  default     = "0.0.0.0/32"
}

variable "vpc_id" {
  description = "Optional VPC ID; if empty, default VPC is used"
  type        = string
  default     = ""
}

variable "public_subnet_id" {
  description = "Optional public subnet ID; if empty, the first subnet in the selected VPC is used"
  type        = string
  default     = ""
}

variable "assign_eip" {
  description = "Whether to allocate and associate an Elastic IP"
  type        = bool
  default     = true
}

variable "domain_name" {
  description = "Optional Route53 domain (example: smart-deploy.xyz)"
  type        = string
  default     = ""
}

variable "worker_subdomain" {
  description = "Subdomain for the worker record (example: ws)"
  type        = string
  default     = "ws"
}

variable "allowed_origins" {
  description = "Allowed websocket origins for WS_ALLOWED_ORIGINS"
  type        = list(string)
  default     = ["https://smart-deploy.xyz"]
}

variable "worker_port" {
  description = "Worker websocket port"
  type        = number
  default     = 4001
}

variable "worker_image" {
  description = "Container image for the websocket/deploy worker"
  type        = string
  default     = "328342419078.dkr.ecr.us-west-2.amazonaws.com/smart-deploy-worker:latest"
}
