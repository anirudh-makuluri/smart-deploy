import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;

		if (!token) {
			return NextResponse.json({ error: "Missing access token" }, { status: 401 });
		}

		const body = await req.json();
		const { owner, repo: repoName, branch } = body;

		if (!owner || !repoName) {
			return NextResponse.json({ error: "Owner and repo are required" }, { status: 400 });
		}

		let branchToUse = typeof branch === "string" ? branch.trim() : "";
		if (!branchToUse) {
			const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!metaRes.ok) {
				const err = await metaRes.json().catch(() => ({}));
				return NextResponse.json(
					{ error: (err as { message?: string })?.message || "Failed to load repository" },
					{ status: metaRes.status }
				);
			}
			const meta = (await metaRes.json()) as { default_branch?: string };
			branchToUse = meta.default_branch?.trim() ?? "";
		}
		if (!branchToUse) {
			return NextResponse.json({ error: "Could not resolve a branch for this repository" }, { status: 400 });
		}

		// Fetch latest commit info on specified branch
		const commitRes = await fetch(
			`https://api.github.com/repos/${owner}/${repoName}/commits/${branchToUse}`,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			}
		);

		if (!commitRes.ok) {
			const error = await commitRes.json();
			return NextResponse.json(
				{ error: error.message || "Failed to fetch commit" },
				{ status: commitRes.status }
			);
		}

		const commit = await commitRes.json();

		return NextResponse.json({
			commit: {
				sha: commit.sha,
				message: commit.commit.message,
				author: commit.commit.author.name,
				date: commit.commit.author.date,
				url: commit.html_url,
			},
		});
	} catch (error: any) {
		console.error("Error fetching latest commit:", error);
		return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
	}
}
