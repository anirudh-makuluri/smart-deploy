output "static_site_bucket_name" {
  description = "S3 bucket for static_build deploys (STATIC_SITE_BUCKET)"
  value       = local.s3_bucket_id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID)"
  value       = aws_cloudfront_distribution.static.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain (dxxxx.cloudfront.net)"
  value       = aws_cloudfront_distribution.static.domain_name
}

output "static_site_public_base_url" {
  description = "Public URL for deployed static sites (STATIC_SITE_PUBLIC_BASE_URL)"
  value       = "https://${aws_cloudfront_distribution.static.domain_name}"
}

output "ecs_cluster_name" {
  description = "ECS cluster (ECS_CLUSTER_NAME)"
  value       = local.ecs_cluster_name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = local.ecs_cluster_arn
}

output "ecs_execution_role_arn" {
  description = "Task execution role (ECS_EXECUTION_ROLE_ARN)"
  value       = aws_iam_role.ecs_execution.arn
}

output "ecs_subnet_ids" {
  description = "Comma-separated subnet IDs for ECS_SUBNET_IDS"
  value       = join(",", local.ecs_subnet_ids)
}

output "ecs_security_group_ids" {
  description = "Comma-separated SG IDs for ECS_SECURITY_GROUP_IDS"
  value       = aws_security_group.fargate.id
}

output "ecs_log_group_name" {
  description = "CloudWatch log group (ECS_LOG_GROUP)"
  value       = aws_cloudwatch_log_group.ecs.name
}

output "runtime_dynamodb_table_name" {
  description = "DynamoDB runtime state table name"
  value       = aws_dynamodb_table.runtime.name
}

output "runtime_dynamodb_table_arn" {
  description = "DynamoDB runtime state table ARN"
  value       = aws_dynamodb_table.runtime.arn
}

output "vpc_id" {
  description = "VPC used for Fargate / ALB"
  value       = local.vpc_id
}

output "route53_wildcard_fqdn" {
  description = "Wildcard deploy hostname when shared_alb_dns_name is set"
  value       = var.shared_alb_dns_name != "" && var.deployment_domain != "" ? "*.${var.deployment_domain}" : null
}

output "smart_deploy_env_snippet" {
  description = "Copy into Smart Deploy .env (append to AWS_REGION and credentials)"
  value       = <<-EOT
    STATIC_SITE_BUCKET=${local.s3_bucket_id}
    STATIC_SITE_PUBLIC_BASE_URL=https://${aws_cloudfront_distribution.static.domain_name}
    STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID=${aws_cloudfront_distribution.static.id}

    ECS_CLUSTER_NAME=${local.ecs_cluster_name}
    ECS_SUBNET_IDS=${join(",", local.ecs_subnet_ids)}
    ECS_SECURITY_GROUP_IDS=${aws_security_group.fargate.id}
    ECS_EXECUTION_ROLE_ARN=${aws_iam_role.ecs_execution.arn}
    ECS_LOG_GROUP=${aws_cloudwatch_log_group.ecs.name}
    ECS_ASSIGN_PUBLIC_IP=ENABLED
    RUNTIME_DYNAMODB_TABLE_NAME=${aws_dynamodb_table.runtime.name}

    # Route 53 (set deployment_domain / shared_alb_dns_name in tfvars when ready)
    # ROUTE53_HOSTED_ZONE_ID=${local.route53_zone_id}
    # NEXT_PUBLIC_DEPLOYMENT_DOMAIN=${var.deployment_domain}
  EOT
}
