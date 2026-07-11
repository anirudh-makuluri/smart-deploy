export const LANDING_TAGLINE = "Deploy without the black box.";

/**
 * Formats a count with a fixed locale so server and client render identical
 * markup. Using the runtime default locale causes hydration mismatches because
 * Node and the browser can disagree on grouping separators.
 */
export function formatLandingCount(value: number): string {
	return value.toLocaleString("en-US");
}

export const LANDING_DESCRIPTION =
	"Deploy without the black box. Smart Deploy scans your GitHub repo, generates a Railpack build plan (or uses your Dockerfile), previews the full deploy blueprint, then ships to AWS with live logs, runtime health, and a read-only AI deployment agent.";

export const LANDING_HERO = {
	ownershipLine:
		"Deploy any GitHub repo to AWS in minutes — preview-first, zero setup, no credentials. Prefer your own account? Self-host Smart Deploy on your AWS.",
	subline:
		"Smart Deploy scans any GitHub repo, previews the exact deploy blueprint, then ships it to AWS with live logs and a read-only AI agent watching runtime health — zero setup, no credentials. Prefer your own account? Self-host it; it's open source.",
} as const;

export const LANDING_WORKFLOW_STEPS = [
	{
		name: "Connect repository",
		text: "Link a GitHub repo, pick a branch, choose AWS targets, and configure environment variables and custom domains.",
	},
	{
		name: "Smart Analysis",
		text: "AI classifies the deploy shape, generates a Railpack build plan, verifies the build, and auto-repairs when needed.",
	},
	{
		name: "Blueprint preview",
		text: "Review every pipeline stage, artifact, and routing decision before anything ships to production.",
	},
	{
		name: "Deploy to AWS",
		text: "Ship to ECS Fargate or static S3 with live build and deploy logs, runtime health checks, and deployment history.",
	},
] as const;

export const LANDING_DEPLOY_TARGETS = [
	{
		name: "ECS Fargate",
		description: "Railpack builds, server apps, and existing Docker images via CodeBuild, ECR, and ALB routing.",
	},
	{
		name: "Static S3",
		description: "SPAs and static builds synced to S3 with CloudFront.",
	},
] as const;

export const LANDING_AGENT_CAPABILITIES = [
	"Inspect live deployment status, branch, region, and cloud resources.",
	"Explain failures using recent history and the failed pipeline step.",
	"Check runtime health from app probes plus ECS and ALB signals.",
] as const;

export const LANDING_HIGHLIGHTS = [
	"Deploy any GitHub repo to AWS in minutes with zero setup and no credentials.",
	"Preview the full deploy blueprint before anything ships — no black box.",
	"Live build and deploy logs, runtime health, and a read-only AI deployment agent.",
	"Open source: self-host Smart Deploy on your own AWS account for full ownership and no lock-in.",
] as const;

export const LANDING_FAQ = [
	{
		question: "What is Smart Deploy?",
		answer:
			"A preview-driven deployment platform for solo developers. Scan a repo, review a live blueprint of what will run, edit config in context, then ship to AWS — instantly on smart-deploy.xyz, or self-hosted on your own AWS (ECS Fargate or static S3).",
	},
	{
		question: "Does it deploy to my own AWS account?",
		answer:
			"On smart-deploy.xyz, deploys run on our managed AWS, so you can ship in minutes with zero setup and no credentials. Prefer your own account? Self-host Smart Deploy and it provisions and ships to your AWS — CodeBuild, ECR, ECS Fargate behind a shared ALB, or S3 with CloudFront for static sites — where you own the account and the bill.",
	},
	{
		question: "What is Smart Analysis?",
		answer:
			"The repo scan that detects your deploy shape, generates a Railpack build plan (or uses your Dockerfile), and optionally verifies the build with an AI repair loop before you ever deploy.",
	},
	{
		question: "Do I need a Dockerfile?",
		answer:
			"No. Railpack produces container images from your repo without a Dockerfile, using Mise for runtimes. If you already have a Dockerfile, Smart Deploy uses it.",
	},
	{
		question: "What does the Deployment Agent do?",
		answer:
			"It is a read-only AI that inspects your deployments, run history, and runtime health. It explains failures and answers questions from real signals, and it can never change your infrastructure.",
	},
	{
		question: "Is Smart Deploy open source?",
		answer:
			"Yes, it is licensed under Apache 2.0. You can read the code, self-host, and fork it while preserving the license and attribution notices.",
	},
] as const;

export const LANDING_FRAMEWORKS = {
	javascript: [
		"React",
		"Next.js",
		"Vue",
		"Nuxt",
		"Svelte",
		"Remix",
		"Astro",
		"Express",
		"NestJS",
		"Fastify",
	],
	python: ["Django", "Flask", "FastAPI", "Starlette", "Streamlit"],
} as const;

export function formatLandingStatSentence(
	totalAnalyses: number,
	totalDeployments: number
): string {
	if (totalAnalyses > 0 && totalDeployments > 0) {
		return `We've run ${formatLandingCount(totalAnalyses)} AI analyses and completed ${formatLandingCount(totalDeployments)} deployments on Smart Deploy.`;
	}
	if (totalAnalyses > 0) {
		return `We've run ${formatLandingCount(totalAnalyses)} AI analyses on real repositories.`;
	}
	if (totalDeployments > 0) {
		return `${formatLandingCount(totalDeployments)} deployments have shipped through Smart Deploy.`;
	}
	return "Solo developers ship to AWS with full scan output, blueprint previews, and live operational visibility.";
}
