import { NextRequest, NextResponse } from "next/server";
import { getCommitMessageFromGitHub } from "@/lib/githubCommitMessage";
import { auth } from "@/lib/auth";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

/** POST { repoUrl, sha } - get commit message from GitHub (for deployment history when not stored). */
export async function POST(req: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: req.headers });
		const userId = session?.user?.id;
		const token = userId ? await getGithubAccessTokenForUserId(userId) : null;

		if (!token) {
			return NextResponse.json({ error: "GitHub not connected" }, { status: 401 });
		}

		const body = await req.json();
		const { repoUrl, sha } = body;

		if (!repoUrl || typeof repoUrl !== "string") {
			return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
		}

		const message = await getCommitMessageFromGitHub(token, repoUrl.trim(), sha?.trim());

		return NextResponse.json({ message: message ?? null });
	} catch (error: unknown) {
		console.error("Error fetching commit message:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Internal Server Error" },
			{ status: 500 }
		);
	}
}
