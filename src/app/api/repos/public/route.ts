import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { repoType } from "@/app/types";

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;

		if (!token) {
			return NextResponse.json({ error: "Missing access token" }, { status: 401 });
		}

		const body = await req.json();
		const { owner, repo } = body;

		if (!owner || !repo) {
			return NextResponse.json({ error: "Owner and repo are required" }, { status: 400 });
		}

		// Fetch repo info from GitHub API
		const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github+json",
			},
		});

		if (!repoRes.ok) {
			if (repoRes.status === 404) {
				return NextResponse.json({ error: "Repository not found or is private" }, { status: 404 });
			}
			const error = await repoRes.json();
			return NextResponse.json({ error: error.message || "Failed to fetch repository" }, { status: repoRes.status });
		}

		const repoData = await repoRes.json();

		// Check if repo is public
		if (repoData.private) {
			return NextResponse.json({ error: "Private repositories are not supported. Please use your own repositories." }, { status: 403 });
		}

		// Fetch latest commit info on default branch
		const commitRes = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/commits/${repoData.default_branch}`,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			}
		);

		const latestCommit = commitRes.ok ? await commitRes.json() : null;

		// Fetch branches
		const branchesRes = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/branches`,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			}
		);

		const branches = branchesRes.ok ? await branchesRes.json() : [];

		// Format repo data
		const repo: repoType = {
			id: repoData.id.toString(),
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
			owner: {
				login: repoData.owner.login,
			},
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

		return NextResponse.json({ repo }, { status: 200 });
	} catch (error: any) {
		console.error("Error fetching public repo:", error);
		return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
	}
}
