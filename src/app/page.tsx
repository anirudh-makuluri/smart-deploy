import type { Metadata } from "next";
import { LandingCrawlableContent } from "@/components/landing/LandingCrawlableContent";
import { LandingExperienceV2 } from "@/components/landing/LandingExperienceV2";
import { LANDING_DESCRIPTION, LANDING_WORKFLOW_STEPS } from "@/lib/landing/landingCopy";
import { getLandingPublicStats } from "@/lib/metrics/landingStats";
import { getGitHubStarCount } from "@/lib/metrics/githubStars";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Deploy anything. Inspect everything.",
	description: LANDING_DESCRIPTION,
};

const webApplicationJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "Smart Deploy",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	url: "https://smart-deploy.xyz",
	description: LANDING_DESCRIPTION,
};

const howToJsonLd = {
	"@context": "https://schema.org",
	"@type": "HowTo",
	name: "Deploy with Smart Deploy",
	description: LANDING_DESCRIPTION,
	step: LANDING_WORKFLOW_STEPS.map((step, index) => ({
		"@type": "HowToStep",
		position: index + 1,
		name: step.name,
		text: step.text,
	})),
};

function jsonLdString(value: unknown): string {
	return JSON.stringify(value).replace(/[<>&]/g, (char) => {
		if (char === "<") return "\\u003c";
		if (char === ">") return "\\u003e";
		return "\\u0026";
	});
}

type HomeProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	try {
		session = await auth.api.getSession({ headers: await headers() });
	} catch (error) {
		// Keep landing page available when auth storage is temporarily unavailable.
		console.error("Failed to read auth session for /:", error);
	}
	if (session) {
		redirect("/home");
	}
	const [publicStats, githubStars, resolvedSearchParams] = await Promise.all([
		getLandingPublicStats(),
		getGitHubStarCount(),
		searchParams,
	]);

	const repoParam = resolvedSearchParams.repo;
	const initialRepoSlug = typeof repoParam === "string" ? repoParam : null;

	return (
		<>
			<script type="application/ld+json">{jsonLdString(webApplicationJsonLd)}</script>
			<script type="application/ld+json">{jsonLdString(howToJsonLd)}</script>
			<LandingCrawlableContent publicStats={publicStats} />
			<LandingExperienceV2
				isSignedIn={Boolean(session)}
				publicStats={publicStats}
				githubStars={githubStars}
				initialRepoSlug={initialRepoSlug}
			/>
		</>
	);
}
