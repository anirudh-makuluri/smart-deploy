import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { dbHelper } from "@/db-helper";
import { repoType } from "@/app/types";


export async function GET(req: NextRequest) {
	const session = await getServerSession(authOptions)

	const token = session?.accessToken
	const userID = session?.userID

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	if (!userID) {
		return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
	}

	try {
		const res = await fetch("https://api.github.com/user/repos", {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github+json",
			},
		});

		if (!res.ok) {
			const error = await res.json();
			return NextResponse.json({ error }, { status: res.status });
		}

		const repos = await res.json();

		// Fetch extra data per repo in parallel
		const data = await Promise.all(
			repos.map(async (repo: repoType) => {
				const { owner, name, default_branch } = repo;

				// Fetch latest commit info on default branch
				const commitRes = await fetch(
					`https://api.github.com/repos/${owner.login}/${name}/commits/${default_branch}`,
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
					`https://api.github.com/repos/${owner.login}/${name}/branches`,
					{
						headers: {
							Authorization: `token ${token}`,
							Accept: "application/vnd.github+json",
						},
					}
				);

				const branches = branchesRes.ok ? await branchesRes.json() : [];

				return {
					id: repo.id,
					name: repo.name,
					full_name: repo.full_name,
					html_url: repo.html_url,
					language: repo.language,
					languages_url: repo.languages_url,
					created_at: repo.created_at,
					updated_at: repo.updated_at,
					pushed_at: repo.pushed_at,
					default_branch: repo.default_branch,
					private: repo.private,
					description: repo.description,
					visibility: repo.visibility,
					license: repo.license?.spdx_id ?? null,
					forks_count: repo.forks_count,
					watchers_count: repo.watchers_count,
					open_issues_count: repo.open_issues_count,

					// Latest commit info
					latest_commit: latestCommit
						? {
							message: latestCommit.commit.message,
							author: latestCommit.commit.author.name,
							date: latestCommit.commit.author.date,
							sha: latestCommit.sha,
							url: latestCommit.html_url,
						}
						: null,

					// All branches
					branches: branches.map((b: any) => ({
						name: b.name,
						commit_sha: b.commit.sha,
						protected: b.protected,
					})),
				};
			})
		);



		// await dbHelper.updateUser(userID, { data })

		return NextResponse.json(data);
	} catch (err: any) {
		return NextResponse.json({ error: err.message }, { status: 500 });
	}
}
