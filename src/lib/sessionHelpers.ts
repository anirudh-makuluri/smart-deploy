import { dbHelper } from "@/db-helper";
import { getGithubRepos } from "@/github-helper";
import { repoType } from "@/app/types";
import type { auth } from "@/lib/auth";

export type SessionForRepos = {
	user: {
		id: string;
		name?: string | null;
		image?: string | null;
	};
	/** Optional GitHub OAuth token (only when GitHub is connected). */
	githubToken?: string | null;
} | (typeof auth.$Infer.Session | null);

const REPO_CACHE_TTL_MS = 30_000;
const repoCache = new Map<string, { repoList: repoType[]; ts: number }>();

export function invalidateRepoCache(userID: string) {
	if (!userID) return;
	repoCache.delete(userID);
}

export async function ensureUserAndRepos(session: SessionForRepos): Promise<{ userID: string; repoList: repoType[] }> {
	const userID = (session as any)?.user?.id as string | undefined;
	const token = ((session as any)?.githubToken ?? null) as string | null;
	if (!userID) throw new Error("Unauthorized");

	const cached = repoCache.get(userID);
	if (cached && Date.now() - cached.ts < REPO_CACHE_TTL_MS) {
		return { userID, repoList: cached.repoList };
	}

	const { repos, error } = await dbHelper.getUserRepos(userID);
	if (error) {
		throw new Error(error);
	}

	if (repos && repos.length > 0) {
		repoCache.set(userID, { repoList: repos, ts: Date.now() });
		return { userID, repoList: repos };
	}

	// If GitHub isn't connected, we can still return persisted repos (if any),
	// but we cannot fetch/sync new ones from GitHub.
	if (!token) {
		const repoList: repoType[] = [];
		repoCache.set(userID, { repoList, ts: Date.now() });
		return { userID, repoList };
	}

	const githubResult = await getGithubRepos(token);
	const repoList = githubResult.data ?? [];
	if (repoList.length > 0) {
		await dbHelper.syncUserRepos(userID, repoList);
	}
	repoCache.set(userID, { repoList, ts: Date.now() });
	return { userID, repoList };
}
