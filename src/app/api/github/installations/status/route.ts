import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

type GithubInstallationsResponse = {
	installations?: unknown;
};

function hasInstallation(payload: unknown): boolean {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
	const installations = (payload as GithubInstallationsResponse).installations;
	return Array.isArray(installations) && installations.length > 0;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	const userId = session?.user?.id;
	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const token = await getGithubAccessTokenForUserId(userId, request.headers);
	if (!token) {
		return NextResponse.json({ error: "GitHub is not connected" }, { status: 404 });
	}

	try {
		const response = await fetch("https://api.github.com/user/installations?per_page=100", {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": "2026-03-10",
			},
			cache: "no-store",
		});
		if (!response.ok) {
			console.error("GitHub installation status request failed:", response.status);
			return NextResponse.json({ error: "Could not check GitHub App installation" }, { status: 502 });
		}

		const payload: unknown = await response.json();
		return NextResponse.json({ installed: hasInstallation(payload) });
	} catch (error) {
		console.error("GitHub installation status request failed:", error);
		return NextResponse.json({ error: "Could not check GitHub App installation" }, { status: 502 });
	}
}
