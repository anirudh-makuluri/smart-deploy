/**
 * GraphQL Context Builder
 * 
 * Extracts authentication and session info from NextAuth.
 * Used by all resolvers to determine user permissions.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import type { NextRequest } from "next/server";

export type GraphQLContext = {
	session: Awaited<ReturnType<typeof getServerSession>> | null;
	userID?: string;
	token?: string;
};

/**
 * Build GraphQL context from Next.js request
 * Extracts NextAuth session, user ID, and GitHub token
 */
export async function buildContext(request?: NextRequest): Promise<GraphQLContext> {
	try {
		const session = await getServerSession(authOptions);
		
		return {
			session,
			userID: (session as any)?.userID,
			token: (session as any)?.accessToken,
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
