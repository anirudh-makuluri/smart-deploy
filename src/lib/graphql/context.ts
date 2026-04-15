/**
 * GraphQL Context Builder
 * 
 * Extracts authentication and session info from Better Auth.
 * Used by all resolvers to determine user permissions.
 */

import type { NextRequest } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { auth } from "@/lib/auth";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

export type GraphQLContext = {
	session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
	userID?: string;
	/**
	 * GitHub OAuth token (optional).
	 * Present only when the user connected GitHub.
	 */
	githubToken?: string;
};

/**
 * Build GraphQL context from Next.js request
 * Extracts Better Auth session and (optionally) a GitHub token.
 */
export async function buildContext(request?: NextRequest): Promise<GraphQLContext> {
	try {
		const requestHeaders = request?.headers ?? (await nextHeaders());
		const session = await auth.api.getSession({
			headers: requestHeaders,
		});
		const userID = session?.user?.id;
		const githubToken = userID ? await getGithubAccessTokenForUserId(userID, requestHeaders) : null;

		return {
			session,
			userID: userID ?? undefined,
			githubToken: githubToken ?? undefined,
		};
	} catch (error) {
		console.error("[GraphQL Context] Failed to build context:", error);
		return {
			session: null,
		};
	}
}

/**
 * Require user authentication
 * Throws error if session is not authenticated
 */
export function requireUser(ctx: GraphQLContext): string {
	if (!ctx.userID || !ctx.session) {
		throw new Error("Unauthorized");
	}
	return ctx.userID;
}

/**
 * Helper for timing resolver execution
 */
export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const start = Date.now();
	try {
		return await fn();
	} finally {
		console.debug(`[GraphQL] ${label} completed in ${Date.now() - start}ms`);
	}
}
