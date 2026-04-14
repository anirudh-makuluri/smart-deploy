import { LandingExperience } from "@/components/landing/LandingExperience";
import { getGlobalDeployMetricsForPublic } from "@/lib/metrics/deployMetrics";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export default async function Home() {
	const session = await auth.api.getSession({ headers: await headers() });
	const publicMetrics = await getGlobalDeployMetricsForPublic();

	return (
		<LandingExperience isSignedIn={Boolean(session)} publicMetrics={publicMetrics} />
	);
}
