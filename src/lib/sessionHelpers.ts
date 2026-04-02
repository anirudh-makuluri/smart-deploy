import { dbHelper } from "@/db-helper";
import { getGithubRepos } from "@/github-helper";
import { repoType } from "@/app/types";
import { Session } from "next-auth";

type SessionWithToken = Session & { accessToken?: string; userID?: string };

const REPO_CACHE_TTL_MS = 30_000;
const repoCache = new Map<string, { repoList: repoType[]; ts: number }>();

export function invalidateRepoCache(userID: string) {
	if (!userID) return;
	repoCache.delete(userID);
}

export async function ensureUserAndRepos(session: SessionWithToken): Promise<{ userID: string; repoList: repoType[] }> {
	const userID = session?.userID;
	const token = session?.accessToken;
	if (!userID || !token) {
		throw new Error("Unauthorized: missing session credentials");
	}

	const cached = repoCache.get(userID);
	if (cached && Date.now() - cached.ts < REPO_CACHE_TTL_MS) {
		return { userID, repoList: cached.repoList };
	}

	const name = session.user?.name || "";
	const image = session.user?.image || "";
	// Non-blocking: user record is not needed to serve the dashboard payload.
	void dbHelper.upsertUser(userID, { name, image }).catch((err) => {
		console.warn("upsertUser failed:", err);
	});

	const { repos, error } = await dbHelper.getUserRepos(userID);
	if (error) {
		throw new Error(error);
	}

	if (repos && repos.length > 0) {
		repoCache.set(userID, { repoList: repos, ts: Date.now() });
		return { userID, repoList: repos };
	}

	const githubResult = await getGithubRepos(token);
	const repoList = githubResult.data ?? [];
	if (repoList.length > 0) {
		await dbHelper.syncUserRepos(userID, repoList);
	}
	repoCache.set(userID, { repoList, ts: Date.now() });
	return { userID, repoList };
}
