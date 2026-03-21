/**
 * Derive `owner/repo` from a GitHub HTTPS or SSH URL for webhook matching.
 */
export function githubFullNameFromUrl(url: string): string | null {
	const u = (url || "").replace(/\.git$/i, "").trim();
	if (!u) return null;
	const ssh = u.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
	if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase();
	const https = u.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/.*)?$/i);
	if (https) return `${https[1]}/${https[2]}`.toLowerCase();
	return null;
}
