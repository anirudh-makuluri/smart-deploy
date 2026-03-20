/**
 * GitHub HTTPS Git expects an OAuth token / PAT as the password with a fixed username.
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
 */
export function githubAuthenticatedCloneUrl(repoUrl: string, accessToken: string): string {
	const enc = encodeURIComponent(accessToken);
	return repoUrl.replace(/^https:\/\//i, `https://x-access-token:${enc}@`);
}
