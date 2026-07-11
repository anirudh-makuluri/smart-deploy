import { unstable_cache } from "next/cache";

export const GITHUB_REPO_SLUG = "anirudh-makuluri/smart-deploy";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}`;

type GitHubRepoResponse = {
	stargazers_count: number;
};

async function fetchGitHubStarsUncached(): Promise<number | null> {
	try {
		const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_SLUG}`, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!response.ok) return null;
		const data = (await response.json()) as GitHubRepoResponse;
		if (typeof data.stargazers_count !== "number") return null;
		return data.stargazers_count;
	} catch {
		return null;
	}
}

const getCachedGitHubStars = unstable_cache(fetchGitHubStarsUncached, ["github-stars-smart-deploy-v1"], {
	revalidate: 3600,
});

/** Returns the repo star count, or null when GitHub is unreachable. */
export async function getGitHubStarCount(): Promise<number | null> {
	return getCachedGitHubStars();
}
