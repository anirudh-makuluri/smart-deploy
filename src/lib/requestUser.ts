import { auth } from "@/lib/auth";
import { authenticateCliAccessToken, getCliBearerToken } from "@/lib/cliAuth";

/**
 * Resolves a Smart Deploy user from either a browser session or a CLI bearer
 * token. CLI tokens deliberately identify a user only; GitHub credentials
 * remain server-side and are resolved separately for that user.
 */
export async function getRequestUserId(headers: Headers): Promise<string | null> {
	const session = await auth.api.getSession({ headers });
	if (session?.user?.id) return session.user.id;

	const cliToken = getCliBearerToken(headers);
	return cliToken ? authenticateCliAccessToken(cliToken) : null;
}
