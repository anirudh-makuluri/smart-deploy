import { repoType } from "./app/types";

export async function getGithubRepos(token: string) {
	try {
		const res = await fetch("https://api.github.com/user/repos", {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github+json",
			},
		});

		if (!res.ok) {
			const error = await res.json();
			return { error: error.toString() };
		}

		const repos = await res.json();

		// Fetch extra data per repo in parallel
		const data: repoType[] = await Promise.all(
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

		return { data }

	} catch (err: any) {
		return { err };
	}
}

export async function getRepoFilePaths(full_name: string, branch: string, token: string): Promise<{ filePaths: string[]; fileContents: Record<string, string> }> {
	const treeRes = await fetch(`https://api.github.com/repos/${full_name}/git/trees/${branch}?recursive=1`, {
		headers: { Authorization: `token ${token}` }
	});
	const treeData = await treeRes.json();

	if (!treeData.tree) {
		return { filePaths: [], fileContents: {} };
	}

	const filePaths = treeData.tree
		?.filter((item: any) => item.type === "blob")
		?.map((item: any) => item.path);


	const importantFiles = ["package.json", "Dockerfile", "requirements.txt", "main.py", "Procfile"];

	const fileContents: Record<string, string> = {};

	for (const file of filePaths) {
		if (importantFiles.includes(file)) {
			const content = await getFileContentFromRepo(full_name, file, token);
			if (content) fileContents[file] = content;
		}
	}

	return { filePaths, fileContents }
}

async function getFileContentFromRepo(full_name: string, filePath: string, token: string): Promise<string | null> {

	const apiUrl = `https://api.github.com/repos/${full_name}/contents/${filePath}`;

	const res = await fetch(apiUrl, {
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github.v3.raw"
		}
	});

	if (!res.ok) {
		console.warn(`⚠️ Failed to fetch ${filePath}: ${res.status}`);
		return null;
	}

	return await res.text();
}

