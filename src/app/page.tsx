import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { LandingExperience } from "@/components/landing/LandingExperience";
import { getGlobalDeployMetricsForPublic } from "@/lib/metrics/deployMetrics";

export default async function Home() {
	const session = await getServerSession(authOptions);
	const publicMetrics = await getGlobalDeployMetricsForPublic();

	return (
		<LandingExperience isSignedIn={Boolean(session)} publicMetrics={publicMetrics} />
	);
}
