import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const session = await auth.api.getSession({ headers: req.headers });
	const userId = session?.user?.id;
	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const token = await getGithubAccessTokenForUserId(userId);
	if (!token) {
		return NextResponse.json({ error: "GitHub not connected" }, { status: 404 });
	}

	return NextResponse.json({ token });
}

