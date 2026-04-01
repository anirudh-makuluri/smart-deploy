const config = {
	// NextAuth
	NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://localhost:3000",
	NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "",

	// GitHub OAuth
	GITHUB_ID: process.env.GITHUB_ID || "",
	GITHUB_SECRET: process.env.GITHUB_SECRET || "",

	// Google Cloud Platform
	GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || "",
	GCP_SERVICE_ACCOUNT_KEY: process.env.GCP_SERVICE_ACCOUNT_KEY || "",

	// AWS Configuration
	AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
	AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
	AWS_REGION: process.env.AWS_REGION || "us-west-2",
	// EC2 ALB HTTPS: ACM certificate ARN (optional). When set, HTTPS listener and HTTP→HTTPS redirect are enabled.
	EC2_ACM_CERTIFICATE_ARN: process.env.EC2_ACM_CERTIFICATE_ARN || "",

	// CodeBuild pipeline: set to "true" to build Docker images via CodeBuild + ECR instead of on the EC2 instance.
	USE_CODEBUILD: (process.env.USE_CODEBUILD || "true").toLowerCase() === "true",

	// Docker Hub (optional): used during CodeBuild so `docker build` pulls like `node:20-alpine` with your account limits instead of anonymous Hub limits.
	// Create an access token at https://hub.docker.com/settings/security (read-only is enough for pulls).
	DOCKERHUB_USERNAME: process.env.DOCKERHUB_USERNAME || "",
	DOCKERHUB_TOKEN: process.env.DOCKERHUB_TOKEN || "",

	// Deployment domain (for host-based routing with shared ALB)
	NEXT_PUBLIC_DEPLOYMENT_DOMAIN: process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz",

	// Vercel DNS (for custom domain management)
	VERCEL_TOKEN: process.env.VERCEL_TOKEN || "",
	VERCEL_DOMAIN: process.env.VERCEL_DOMAIN || "",

	// AI
	GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",

	// Supabase (primary database)
	SUPABASE_URL: process.env.SUPABASE_URL || "",
	SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",

	// Supabase Storage bucket for deployed app screenshots
	DEPLOYMENT_SCREENSHOT_BUCKET: process.env.DEPLOYMENT_SCREENSHOT_BUCKET || "deployment-screenshots",

	// Demo mode
	DEMO_INTERNAL_EMAIL_MATCHERS: process.env.DEMO_INTERNAL_EMAIL_MATCHERS || "",
	DEMO_TTL_MINUTES: process.env.DEMO_TTL_MINUTES || "10",
	DEMO_MAX_ACTIVE_PER_USER: process.env.DEMO_MAX_ACTIVE_PER_USER || "1",
	DEMO_MAX_GLOBAL_ACTIVE: process.env.DEMO_MAX_GLOBAL_ACTIVE || "5",
	DEMO_REDEPLOY_COOLDOWN_SECONDS: process.env.DEMO_REDEPLOY_COOLDOWN_SECONDS || "300",
	DEMO_MAX_DEPLOYS_PER_DAY: process.env.DEMO_MAX_DEPLOYS_PER_DAY || "3",
	DEMO_SUBDOMAIN_PREFIX: process.env.DEMO_SUBDOMAIN_PREFIX || "demo",
}


export default config