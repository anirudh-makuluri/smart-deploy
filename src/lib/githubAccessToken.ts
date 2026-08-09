import { getDbPool } from "@/lib/dbPool";
import { auth } from "@/lib/auth";

type AccountRow = {
	providerid?: string;
	access_token?: string | null;
	accesstoken?: string | null;
	accessToken?: string | null;
};

/**
 * Returns the stored GitHub OAuth access token (if any) for a Better Auth userId.
 *
 * Better Auth stores provider accounts in the `account` table with `providerId`
 * and an (optionally encrypted) `accessToken` column.
 */
export async function getGithubAccessTokenForUserId(userId: string, headers?: Headers): Promise<string | null> {
	const uid = (userId || "").trim();
	if (!uid) return null;

	// Prefer Better Auth token retrieval so encrypted/refreshable provider tokens are handled correctly.
	try {
		const getAccessToken = (auth.api as any)?.getAccessToken;
		if (typeof getAccessToken === "function") {
			const request = {
				body: {
					providerId: "github",
					userId: uid,
				},
			};
			// A CLI bearer token is authenticated by Smart Deploy, not Better Auth.
			// Supplying it to Better Auth makes getAccessToken require a browser
			// session and bypasses its server-side decrypt/refresh path.
			const tokenResponse = headers?.get("cookie")
				? await getAccessToken({ ...request, headers })
				: await getAccessToken(request);

			const resolved = tokenResponse?.accessToken;
			if (typeof resolved === "string" && resolved.trim()) {
				return resolved;
			}
		}
	} catch {
		// Fall back to direct DB lookup for compatibility with existing rows.
	}

	const pool = getDbPool();

	// Support both camelCase and snake_case depending on migration tooling.
	const res = await pool.query(
		`
		select "providerId" as providerId, "accessToken" as accessToken
		from "account"
		where "userId" = $1 and "providerId" = 'github'
		limit 1
		`,
		[uid]
	);

	const row = (res.rows?.[0] ?? null) as { providerid?: string; providerId?: string; accesstoken?: string | null; accessToken?: string | null };
	const token = row?.accessToken ?? (row as any)?.accesstoken ?? null;
	return typeof token === "string" && token.trim() ? token : null;
}

