import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { dbHelper } from "@/db-helper";
import type { repoType } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function githubHeaders(token: string): HeadersInit {
	return {
		Authorization: `token ${token}`,
		Accept: "application/vnd.github+json",
	};
}

export async function GET(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;
		const userID = session?.userID;
		if (!token || !userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const owner = req.nextUrl.searchParams.get("owner")?.trim();
		const repoName = req.nextUrl.searchParams.get("repo")?.trim();
		if (!owner || !repoName) {
			return NextResponse.json({ error: "Owner and repo are required" }, { status: 400 });
		}

		const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
			headers: githubHeaders(token),
		});
		if (!repoRes.ok) {
			const errorData = await repoRes.json().catch(() => ({}));
			return NextResponse.json(
				{ error: errorData?.message || "Failed to fetch repository" },
				{ status: repoRes.status }
			);
		}
		const repoData = await repoRes.json();

		const commitRes = await fetch(
			`https://api.github.com/repos/${owner}/${repoName}/commits/${repoData.default_branch}`,
			{ headers: githubHeaders(token) }
		);
		const latestCommit = commitRes.ok ? await commitRes.json() : null;

		const branchesRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/branches`, {
			headers: githubHeaders(token),
		});
		const branches = branchesRes.ok ? await branchesRes.json() : [];

		const repo: repoType = {
			id: String(repoData.id),
			name: repoData.name,
			full_name: repoData.full_name,
			html_url: repoData.html_url,
			language: repoData.language || "",
			languages_url: repoData.languages_url,
			created_at: repoData.created_at,
			updated_at: repoData.updated_at,
			pushed_at: repoData.pushed_at,
			default_branch: repoData.default_branch,
			private: repoData.private,
			description: repoData.description,
			visibility: repoData.visibility,
			license: repoData.license ? { spdx_id: repoData.license.spdx_id } : null,
			forks_count: repoData.forks_count,
			watchers_count: repoData.watchers_count,
			open_issues_count: repoData.open_issues_count,
			owner: { login: repoData.owner.login },
			latest_commit: latestCommit
				? {
						message: latestCommit.commit.message,
						author: latestCommit.commit.author.name,
						date: latestCommit.commit.author.date,
						sha: latestCommit.sha,
						url: latestCommit.html_url,
				  }
				: null,
			branches: branches.map((b: any) => ({
				name: b.name,
				commit_sha: b.commit.sha,
				protected: b.protected,
			})),
		};

		await dbHelper.syncUserRepos(userID, [repo]);
		return NextResponse.json({ repo }, { status: 200 });
	} catch (error: any) {
		console.error("Error resolving repo:", error);
		return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
	}
}
