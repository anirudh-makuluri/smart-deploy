import { getDbPool } from "@/lib/dbPool";

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
export async function getGithubAccessTokenForUserId(userId: string): Promise<string | null> {
	const uid = (userId || "").trim();
	if (!uid) return null;

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

