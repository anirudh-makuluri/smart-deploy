import type { Metadata } from "next";
import { LandingExperience } from "@/components/landing/LandingExperience";
import { getLandingPublicStats } from "@/lib/metrics/landingStats";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const LANDING_DESCRIPTION =
	"Deploy without the black box. Smart Deploy scans your GitHub repo, generates a Railpack build plan (or uses your Dockerfile), previews the full deploy blueprint, then ships to AWS with live logs, runtime health, and a read-only AI deployment agent.";

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

function jsonLdString(value: unknown): string {
	return JSON.stringify(value).replace(/[<>&]/g, (char) => {
		if (char === "<") return "\\u003c";
		if (char === ">") return "\\u003e";
		return "\\u0026";
	});
}

export default async function Home() {
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
	const publicStats = await getLandingPublicStats();

	return (
		<>
			<script type="application/ld+json">{jsonLdString(webApplicationJsonLd)}</script>
			<LandingExperience isSignedIn={Boolean(session)} publicStats={publicStats} />
		</>
	);
}
