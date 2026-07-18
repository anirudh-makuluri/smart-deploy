import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getDeviceAuthorizationStatus } from "@/lib/cliAuth";
import { CliAuthorizationApproval } from "@/components/cli/CliAuthorizationApproval";

export const dynamic = "force-dynamic";

export default async function CliAuthorizePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
	const { code = "" } = await searchParams;
	if (!code) return <main className="p-8">Missing CLI authorization request.</main>;
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) redirect("/auth?callbackURL=" + encodeURIComponent("/cli/authorize?code=" + encodeURIComponent(code)));
	const status = await getDeviceAuthorizationStatus(code);
	if (status !== "pending") return <main className="p-8">This CLI authorization request is expired or already used.</main>;
	return <CliAuthorizationApproval code={code} />;
}
