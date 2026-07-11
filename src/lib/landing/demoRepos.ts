export type DemoRepo = {
	slug: string;
	label: string;
	services: string[];
	framework: string;
	deploymentTarget: string;
	targetLabel: string;
	branch: string;
	region: string;
	deployDurationLabel: string;
	secrets: string[];
};

export const DEMO_REPOS: DemoRepo[] = [
	{
		slug: "vercel/commerce",
		label: "vercel/commerce",
		services: ["web", "api"],
		framework: "Next.js",
		deploymentTarget: "AWS / ECS",
		targetLabel: "ECS Fargate",
		branch: "main",
		region: "us-west-2",
		deployDurationLabel: "3m 12s",
		secrets: ["DATABASE_URL", "STRIPE_SECRET_KEY", "NEXTAUTH_SECRET"],
	},
	{
		slug: "encode/django-rest-framework",
		label: "encode/django-rest-framework",
		services: ["api"],
		framework: "Django REST",
		deploymentTarget: "AWS / ECS",
		targetLabel: "ECS Fargate",
		branch: "main",
		region: "us-east-1",
		deployDurationLabel: "2m 48s",
		secrets: ["DATABASE_URL", "DJANGO_SECRET_KEY"],
	},
	{
		slug: "tiangolo/full-stack-fastapi-template",
		label: "tiangolo/full-stack-fastapi-template",
		services: ["web", "api"],
		framework: "FastAPI + React",
		deploymentTarget: "AWS / ECS",
		targetLabel: "ECS Fargate",
		branch: "master",
		region: "eu-west-1",
		deployDurationLabel: "3m 41s",
		secrets: ["DATABASE_URL", "SECRET_KEY", "REDIS_URL"],
	},
];

export type DemoStoryContext = {
	serviceLabel: string;
	repoSlug: string;
	branch: string;
	region: string;
	customDomain: string;
	deploymentTarget: string;
	targetLabel: string;
	framework: string;
	services: string[];
	deployDurationLabel: string;
	secrets: string[];
};

export function buildDemoStoryContext(repo: DemoRepo): DemoStoryContext {
	const primaryService = repo.services[0] ?? "app";
	return {
		serviceLabel: `${primaryService}@${repo.slug.split("/")[1] ?? "demo"}`,
		repoSlug: repo.slug,
		branch: repo.branch,
		region: repo.region,
		customDomain: `${primaryService}.smart-deploy.xyz`,
		deploymentTarget: repo.deploymentTarget,
		targetLabel: repo.targetLabel,
		framework: repo.framework,
		services: repo.services,
		deployDurationLabel: repo.deployDurationLabel,
		secrets: repo.secrets,
	};
}

/**
 * Builds a demo repo from an arbitrary owner/name slug so the hero can replay a
 * canned analysis for any pasted GitHub repo (interim before live analysis).
 */
export function buildDemoRepoFromSlug(slug: string): DemoRepo {
	const normalized = slug.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
	const known = DEMO_REPOS.find((repo) => repo.slug.toLowerCase() === normalized.toLowerCase());
	if (known) return known;
	const [owner, name] = normalized.split("/");
	const safeName = name ?? owner ?? "app";
	return {
		slug: owner && name ? `${owner}/${name}` : safeName,
		label: owner && name ? `${owner}/${name}` : safeName,
		services: ["web", "api"],
		framework: "Auto-detected",
		deploymentTarget: "AWS / ECS",
		targetLabel: "ECS Fargate",
		branch: "main",
		region: "us-west-2",
		deployDurationLabel: "3m 05s",
		secrets: ["DATABASE_URL", "API_KEY"],
	};
}
