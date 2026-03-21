/**
 * Fetch commit message from GitHub API using commit SHA or branch ref.
 * Returns the first line (subject) of the commit message, or undefined if not GitHub or request fails.
 */
export async function getCommitMessageFromGitHub(
	token: string,
	repoUrl: string,
	commitSha?: string,
	branch?: string
): Promise<string | undefined> {
	const match = repoUrl.replace(/\.git$/, "").match(/github\.com[/]([^/]+)[/]([^/]+)/);
	if (!match) return undefined;
	const [, owner, repo] = match;
	let ref = (commitSha || branch || "").trim();
	if (!ref) {
		try {
			const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!metaRes.ok) return undefined;
			const meta = (await metaRes.json()) as { default_branch?: string };
			ref = meta.default_branch?.trim() ?? "";
		} catch {
			return undefined;
		}
	}
	if (!ref) return undefined;
	try {
		const res = await fetch(
			`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
			{
				headers: {
					Authorization: `token ${token}`,
					Accept: "application/vnd.github+json",
				},
			}
		);
		if (!res.ok) return undefined;
		const data = await res.json();
		const fullMessage = data.commit?.message;
		if (typeof fullMessage !== "string") return undefined;
		// First line only (subject)
		return fullMessage.split("\n")[0].trim() || undefined;
	} catch {
		return undefined;
	}
}
