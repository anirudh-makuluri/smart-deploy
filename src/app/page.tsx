import { LandingExperience } from "@/components/landing/LandingExperience";
import { getGlobalDeployMetricsForPublic } from "@/lib/metrics/deployMetrics";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

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
		<LandingExperience isSignedIn={Boolean(session)} publicMetrics={publicMetrics} />
	);
}
