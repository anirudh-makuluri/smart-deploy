const config = {
	// NextAuth
	NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://localhost:3000",
	NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "",

	// GitHub OAuth
	GITHUB_ID: process.env.GITHUB_ID || "",
	GITHUB_SECRET: process.env.GITHUB_SECRET || "",

	// GitHub App (auto-deploy webhooks + installation tokens)
	GITHUB_APP_ID: process.env.GITHUB_APP_ID || "",
	GITHUB_APP_PRIVATE_KEY: (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
	GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET || "",
	GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID || "",
	GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET || "",

	// Public slug for https://github.com/apps/<slug>/installations/new
	NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || "",

	// Deploy worker (WebSocket server) — receives verified auto-deploy jobs from Next.js
	DEPLOY_WORKER_URL: (process.env.DEPLOY_WORKER_URL || "http://127.0.0.1:4001").replace(/\/$/, ""),
	DEPLOY_WORKER_SECRET: process.env.DEPLOY_WORKER_SECRET || "",

	// Google Cloud Platform
	GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || "",
	GCP_SERVICE_ACCOUNT_KEY: process.env.GCP_SERVICE_ACCOUNT_KEY || "",

	// AWS Configuration
	AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
	AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
	AWS_REGION: process.env.AWS_REGION || "us-west-2",
	// EC2 ALB HTTPS: ACM certificate ARN (optional). When set, HTTPS listener and HTTP→HTTPS redirect are enabled.
	EC2_ACM_CERTIFICATE_ARN: process.env.EC2_ACM_CERTIFICATE_ARN || "",

	// Lets Encrypt (EC2 + nginx)
	LETSENCRYPT_EMAIL: process.env.LETSENCRYPT_EMAIL || "",

	// Deployment domain (for host-based routing with shared ALB)
	NEXT_PUBLIC_DEPLOYMENT_DOMAIN: process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "anirudh-makuluri.xyz",

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

	// Firebase Configuration (deprecated – migration to Supabase)
	FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || "",
	FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || "",
	FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "",
	FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || "",
	FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
	FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || "",
	FIREBASE_MEASUREMENT_ID: process.env.FIREBASE_MEASUREMENT_ID || "",
	FIREBASE_SERVICE_ACCOUNT_KEY: process.env.FIREBASE_SERVICE_ACCOUNT_KEY || ""
}


export default config