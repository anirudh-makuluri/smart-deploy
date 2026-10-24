import { repoType } from "./app/types";
import { isJsonObject, responseErrorMessage } from "./lib/httpResponse";

const IMPORTANT_REPO_FILES = new Set([
	"package.json",
	"Dockerfile",
	"requirements.txt",
	"main.py",
	"Procfile",
]);

export interface RepositoryFiles {
	filePaths: string[];
	fileContents: Record<string, string>;
}

export async function getGithubRepos(token: string) {
	try {
		const repos: repoType[] = [];
		let page = 1;

		while (true) {
			const res = await fetch(`https://api.github.com/user/repos?per_page=100&page=${page}`, {
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			});

			if (!res.ok) {
				const error = await res.json();
				return { error: error.toString() };
			}

			const pageRepos = (await res.json()) as repoType[];
			repos.push(...pageRepos);

			if (pageRepos.length < 100) break;
			page += 1;
		}

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
					visibility: repo.visibility,
					owner: repo.owner,
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

export async function getRepoFilePaths(full_name: string, branch: string, token: string): Promise<RepositoryFiles> {
	const treeRes = await fetch(`https://api.github.com/repos/${full_name}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
		headers: { Authorization: `token ${token}` }
	});
	if (!treeRes.ok) {
		throw new Error(await responseErrorMessage(treeRes, `Repository file tree request failed (${treeRes.status})`));
	}
	const treeData: unknown = await treeRes.json().catch(() => null);
	if (!isJsonObject(treeData) || !Array.isArray(treeData.tree)) throw new Error("Repository file tree response was invalid");
	if (treeData.truncated === true) throw new Error("Repository file tree is incomplete");

	const filePaths: string[] = [];
	for (const item of treeData.tree) {
		if (!isJsonObject(item) || typeof item.type !== "string" || typeof item.path !== "string" || !item.path) {
			throw new Error("Repository file tree response was invalid");
		}
		if (item.type === "blob") filePaths.push(item.path);
	}


	const fileContents: Record<string, string> = {};

	const importantPaths = filePaths.filter((file) => IMPORTANT_REPO_FILES.has(file));
	const fetched = await Promise.all(
		importantPaths.map(async (file) => {
			const content = await getFileContentFromRepo(full_name, file, branch, token);
			return [file, content] as const;
		})
	);
	for (const entry of fetched) {
		fileContents[entry[0]] = entry[1];
	}

	return { filePaths, fileContents }
}

async function getFileContentFromRepo(full_name: string, filePath: string, branch: string, token: string): Promise<string> {

	const apiUrl = `https://api.github.com/repos/${full_name}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;

	const res = await fetch(apiUrl, {
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github.v3.raw"
		}
	});

	if (!res.ok) {
		throw new Error(await responseErrorMessage(res, `Repository file request failed (${res.status})`));
	}

	return await res.text();
}

