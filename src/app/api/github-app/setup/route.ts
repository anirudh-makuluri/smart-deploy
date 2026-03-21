import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";
import config from "@/config";
import { githubFullNameFromUrl } from "@/lib/githubRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function appBaseUrl(): string {
	return (process.env.NEXTAUTH_URL || config.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
	const session = await getServerSession(authOptions);
	if (!session?.userID) {
		const dest = new URL("/auth", appBaseUrl());
		dest.searchParams.set("callbackUrl", req.nextUrl.toString());
		return NextResponse.redirect(dest);
	}

	const installationIdRaw = req.nextUrl.searchParams.get("installation_id");
	const stateRaw = req.nextUrl.searchParams.get("state");
	if (!installationIdRaw || !stateRaw) {
		return NextResponse.redirect(new URL("/home?github_app_error=missing_params", appBaseUrl()));
	}

	const installationId = Number(installationIdRaw);
	if (!Number.isFinite(installationId)) {
		return NextResponse.redirect(new URL("/home?github_app_error=bad_installation", appBaseUrl()));
	}

	let parsed: { owner?: string; repo_name?: string; service_name?: string };
	try {
		parsed = JSON.parse(decodeURIComponent(stateRaw)) as typeof parsed;
	} catch {
		return NextResponse.redirect(new URL("/home?github_app_error=bad_state", appBaseUrl()));
	}

	const { owner, repo_name, service_name } = parsed;
	if (!owner || !repo_name || !service_name) {
		return NextResponse.redirect(new URL("/home?github_app_error=bad_state", appBaseUrl()));
	}

	const { deployment, error } = await dbHelper.getDeployment(repo_name, service_name);
	if (error || !deployment || deployment.ownerID !== session.userID) {
		return NextResponse.redirect(new URL("/home?github_app_error=forbidden", appBaseUrl()));
	}

	const fullName =
		(deployment.github_full_name || "").trim() ||
		githubFullNameFromUrl(deployment.url || "") ||
		`${owner}/${repo_name}`.toLowerCase();

	const res = await dbHelper.updateDeployments(
		{
			...deployment,
			github_installation_id: installationId,
			github_full_name: fullName,
		},
		session.userID
	);

	if (res.error) {
		return NextResponse.redirect(new URL("/home?github_app_error=save_failed", appBaseUrl()));
	}

	const dest = new URL(
		`/${encodeURIComponent(owner)}/${encodeURIComponent(repo_name)}`,
		appBaseUrl()
	);
	dest.searchParams.set("github_app", "installed");
	dest.searchParams.set("service", service_name);
	return NextResponse.redirect(dest);
}
