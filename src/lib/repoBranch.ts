import type { repoType } from "@/app/types";

/** Prefer these when GitHub default is missing or not in the branch list (e.g. stale "main"). */
const WELL_KNOWN_DEFAULT_BRANCHES = ["master", "develop", "dev", "trunk"] as const;

export function branchNamesFromRepo(repo: repoType | null | undefined): string[] {
	return (repo?.branches ?? []).map((b) => b.name).filter(Boolean);
}

function pickFirstWellKnownBranch(names: string[]): string | undefined {
	for (const k of WELL_KNOWN_DEFAULT_BRANCHES) {
		if (names.includes(k)) return k;
	}
	return undefined;
}

/**
 * Best default branch for this repo: GitHub default if listed, else first well-known (master, develop, …), else first remote branch.
 */
export function resolveInitialRepoBranch(repo: repoType | null | undefined): string {
	if (!repo) return "";
	const names = branchNamesFromRepo(repo);
	const def = repo.default_branch?.trim() ?? "";

	if (names.length > 0) {
		if (def && names.includes(def)) return def;
		const known = pickFirstWellKnownBranch(names);
		if (known) return known;
		return names[0]!;
	}

	return def;
}

/**
 * Effective branch for the workspace: use stored value only if it exists on the remote; otherwise re-resolve (ignores bogus "main" in DB).
 */
export function resolveWorkspaceBranch(
	repo: repoType | null | undefined,
	storedBranch: string | null | undefined
): string {
	const names = branchNamesFromRepo(repo);
	const trimmed = storedBranch?.trim() ?? "";

	if (names.length === 0) {
		return trimmed || resolveInitialRepoBranch(repo) || "";
	}

	if (trimmed && names.includes(trimmed)) {
		return trimmed;
	}

	return resolveInitialRepoBranch(repo) || "";
}
