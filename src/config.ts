const config = {
	// Better Auth
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "",

	// Better Auth DB (Supabase Postgres connection string)
	DATABASE_URL: process.env.DATABASE_URL || "",

	// GitHub App (OAuth credentials are used by Better Auth; the private key is server-only).
	GITHUB_APP_ID: process.env.GITHUB_APP_ID || "",
	GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID || "",
	GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET || "",
	GITHUB_APP_PRIVATE_KEY_BASE64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || "",
	GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET || "",
	GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG || "",
	// Legacy GitHub OAuth values, retained only while environments migrate to GitHub Apps.
	GITHUB_ID: process.env.GITHUB_ID || "",
	GITHUB_SECRET: process.env.GITHUB_SECRET || "",

	// Google Cloud Platform
	GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || "",
	GCP_SERVICE_ACCOUNT_KEY: process.env.GCP_SERVICE_ACCOUNT_KEY || "",

	// AWS Configuration
	AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
	AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
	AWS_REGION: process.env.AWS_REGION || "us-west-2",
	DEPLOYMENT_QUEUE_URL: process.env.DEPLOYMENT_QUEUE_URL || "",
	DEPLOYMENT_WORKER_TASK_DEFINITION_ARN: process.env.DEPLOYMENT_WORKER_TASK_DEFINITION_ARN || "",
	DEPLOYMENT_WORKER_CONTAINER_NAME: process.env.DEPLOYMENT_WORKER_CONTAINER_NAME || "smart-deploy-worker",
	DEPLOYMENT_WORKER_CLUSTER_NAME: process.env.DEPLOYMENT_WORKER_CLUSTER_NAME || "",
	DEPLOYMENT_WORKER_SUBNET_IDS: process.env.DEPLOYMENT_WORKER_SUBNET_IDS || "",
	DEPLOYMENT_WORKER_SECURITY_GROUP_IDS: process.env.DEPLOYMENT_WORKER_SECURITY_GROUP_IDS || "",
	DEPLOYMENT_WORKER_ASSIGN_PUBLIC_IP: process.env.DEPLOYMENT_WORKER_ASSIGN_PUBLIC_IP || "",
	// Shared ALB HTTPS: ACM certificate ARN (optional). When set, HTTPS listener and HTTP->HTTPS redirect are enabled.
	DEPLOYMENT_ACM_CERTIFICATE_ARN: process.env.DEPLOYMENT_ACM_CERTIFICATE_ARN || "",
	// ECS Fargate (Railpack / sd-artifacts server units).
	ECS_CLUSTER_NAME: process.env.ECS_CLUSTER_NAME || "",
	// Comma-separated subnet IDs for Fargate tasks (same VPC as target groups).
	ECS_SUBNET_IDS: process.env.ECS_SUBNET_IDS || "",
	// Comma-separated security group IDs for tasks (must allow traffic from the shared ALB SG on the app port).
	ECS_SECURITY_GROUP_IDS: process.env.ECS_SECURITY_GROUP_IDS || "",
	// Task execution role ARN (ECR pull + CloudWatch Logs).
	ECS_EXECUTION_ROLE_ARN: process.env.ECS_EXECUTION_ROLE_ARN || "",
	// ENABLED if tasks need a public IP (e.g. no NAT); default DISABLED when using private subnets + ALB.
	ECS_ASSIGN_PUBLIC_IP: process.env.ECS_ASSIGN_PUBLIC_IP || "DISABLED",
	ECS_LOG_GROUP: process.env.ECS_LOG_GROUP || "/ecs/smartdeploy-railpack",
	ECS_TASK_CPU: process.env.ECS_TASK_CPU || "512",
	ECS_TASK_MEMORY: process.env.ECS_TASK_MEMORY || "1024",

	// CodeBuild pipeline: set to "true" to build Docker images via CodeBuild + ECR.
	USE_CODEBUILD: (process.env.USE_CODEBUILD || "true").toLowerCase() === "true",

	// Docker Hub (optional): used during CodeBuild so `docker build` pulls like `node:20-alpine` with your account limits instead of anonymous Hub limits.
	// Create an access token at https://hub.docker.com/settings/security (read-only is enough for pulls).
	DOCKERHUB_USERNAME: process.env.DOCKERHUB_USERNAME || "",
	DOCKERHUB_TOKEN: process.env.DOCKERHUB_TOKEN || "",

	// Deployment domain (for host-based routing with shared ALB)
	NEXT_PUBLIC_DEPLOYMENT_DOMAIN: process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz",

	// Route 53 DNS (custom deployment subdomains)
	ROUTE53_HOSTED_ZONE_ID: process.env.ROUTE53_HOSTED_ZONE_ID || "",
	ROUTE53_DOMAIN: process.env.ROUTE53_DOMAIN || "",
	/** When true (default), shared-ALB deploys use a wildcard record instead of per-service records. */
	ROUTE53_USE_WILDCARD: process.env.ROUTE53_USE_WILDCARD || "true",
	/** Upsert `*.domain` -> ALB on deploy when wildcard mode is active. */
	ROUTE53_ENSURE_WILDCARD: process.env.ROUTE53_ENSURE_WILDCARD || "true",

	// AI
	GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",

	// Supabase (primary database)
	SUPABASE_URL: process.env.SUPABASE_URL || "",
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

	// Waiting list gate: set to "false" to allow authenticated users through without approved-user checks.
	WAITING_LIST_ENABLED: (process.env.WAITING_LIST_ENABLED ?? "true").toLowerCase() !== "false",
	// When false, global deploy metrics are hidden (landing strip + GET /api/metrics/public). Per-user metrics still work.
	PUBLIC_DEPLOY_METRICS_ENABLED:
		(process.env.PUBLIC_DEPLOY_METRICS_ENABLED ?? "true").toLowerCase() !== "false",

	// Supabase Storage bucket for deployed app screenshots
	DEPLOYMENT_SCREENSHOT_BUCKET: process.env.DEPLOYMENT_SCREENSHOT_BUCKET || "deployment-screenshots",

	// S3 bucket for deploy-run pipeline logs (JSONL per run)
	LOGS_BUCKET: process.env.LOGS_BUCKET || "",

	// DynamoDB table for runtime worker state (health history, live log buffers, and similar ephemeral state)
	RUNTIME_DYNAMODB_TABLE_NAME: process.env.RUNTIME_DYNAMODB_TABLE_NAME || "smart-deploy-runtime",

	// static_build -> S3 (+ optional CloudFront invalidation) via CodeBuild; see `staticSiteCodebuild.ts`.
	STATIC_SITE_BUCKET: process.env.STATIC_SITE_BUCKET || "",
	STATIC_SITE_PUBLIC_BASE_URL: process.env.STATIC_SITE_PUBLIC_BASE_URL || "",
	/** Optional; prefix before per-service segment (no leading slash). */
	STATIC_SITE_KEY_PREFIX: process.env.STATIC_SITE_KEY_PREFIX || "",
	STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID: process.env.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID || "",
}


export default config


