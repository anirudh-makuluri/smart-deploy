import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { ensureUserAndRepos } from "@/lib/sessionHelpers";

// Force dynamic rendering - prevents Next.js from analyzing this route during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
	const start = Date.now();
	try {
		const session = await getServerSession(authOptions)

		const userID = session?.userID
		const token = session?.accessToken

		if (!userID || !token) {
			return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
		}

		const { repoList: fullRepoList } = await ensureUserAndRepos(session as any);

		const limitRaw = req.nextUrl.searchParams.get("limit");
		const limit = limitRaw ? Number(limitRaw) : null;

		const sorted = [...(fullRepoList ?? [])].sort((a, b) => {
			const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
			const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
			return dateB - dateA;
		});

		const repoList =
			limit && Number.isFinite(limit) && limit > 0 ? sorted.slice(0, limit) : sorted;

		return NextResponse.json({ 
			message: "User synced successfully",
			repoList
		}, 
			{ status: 200 }
		);

	} catch (error) {
		console.error("Error adding user:", error);
		return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
	} finally {
		console.debug(`[REST] session completed in ${Date.now() - start}ms`);
	}
}
