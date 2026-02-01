const config = {
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
	// ECS ALB HTTPS: ACM certificate ARN (optional). When set, HTTPS listener and HTTP→HTTPS redirect are enabled.
	ECS_ACM_CERTIFICATE_ARN: process.env.ECS_ACM_CERTIFICATE_ARN || "",
	// EB ALB HTTPS: ACM certificate ARN (optional). When set, new/updated EB environments get an HTTPS listener on port 443 (instance port 80).
	EB_ACM_CERTIFICATE_ARN: process.env.EB_ACM_CERTIFICATE_ARN || "",
	
	// AI
	GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
	
	// Firebase Configuration
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