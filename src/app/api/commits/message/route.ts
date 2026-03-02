import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { getCommitMessageFromGitHub } from "@/lib/githubCommitMessage";

/** POST { repoUrl, sha } - get commit message from GitHub (for deployment history when not stored). */
export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;

		if (!token) {
			return NextResponse.json({ error: "Missing access token" }, { status: 401 });
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
