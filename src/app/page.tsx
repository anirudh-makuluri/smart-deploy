import { LandingExperience } from "@/components/landing/LandingExperience";
import { getGlobalDeployMetricsForPublic } from "@/lib/metrics/deployMetrics";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const webApplicationJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "Smart Deploy",
	applicationCategory: "DeveloperApplication",
	operatingSystem: "Web",
	url: "https://smart-deploy.xyz",
	description:
		"Deploy without the black box. Generate or bring Docker, Compose, and Nginx, preview routing and services as a blueprint, then ship with confidence.",
};

export default async function Home() {
	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	try {
		session = await auth.api.getSession({ headers: await headers() });
	} catch (error) {
		// Keep landing page available when auth storage is temporarily unavailable.
		console.error("Failed to read auth session for /:", error);
	}
	const publicMetrics = await getGlobalDeployMetricsForPublic();

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationJsonLd) }}
			/>
			<LandingExperience isSignedIn={Boolean(session)} publicMetrics={publicMetrics} />
		</>
	);
}
