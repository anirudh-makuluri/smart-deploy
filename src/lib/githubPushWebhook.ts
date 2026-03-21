/** `refs/heads/main` → `main` */
export function pushBranchFromRef(ref: unknown): string | null {
	if (typeof ref !== "string" || !ref.startsWith("refs/heads/")) {
		return null;
	}
	return ref.slice("refs/heads/".length);
}

export function isNullSha(sha: unknown): boolean {
	return typeof sha !== "string" || /^0+$/.test(sha);
}
