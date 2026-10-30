import { getDbPool } from "@/lib/dbPool";
import { auth } from "@/lib/auth";

interface GithubAccountRow {
	id: string;
}

/** Resolve the user's GitHub account, then let Better Auth decrypt and refresh its token. */
export async function getGithubAccessTokenForUserId(userId: string, headers?: Headers): Promise<string | null> {
	const uid = userId.trim();
	if (!uid) return null;

	const result = await getDbPool().query<GithubAccountRow>(
		`select id from "account" where "userId" = $1 and "providerId" = 'github' limit 1`,
		[uid]
	);
	const account = result.rows[0];
	if (!account) return null;

	// Better Auth 1.7 selects the local account row, not the provider's account ID.
	const request = { body: { accountId: account.id, userId: uid } };
	// CLI requests are authenticated by SmartDeploy and have no Better Auth session.
	const response = headers?.get("cookie")
		? await auth.api.getAccessToken({ ...request, headers })
		: await auth.api.getAccessToken(request);

	const token = response.accessToken;
	return typeof token === "string" && token.trim() ? token : null;
}
