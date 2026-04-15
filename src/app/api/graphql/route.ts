/**
 * GraphQL API Endpoint (GraphQL Yoga)
 * 
 * Replaces the previous RPC-style implementation with GraphQL Yoga.
 * All existing queries and mutations remain compatible.
 */

import { createYoga } from "graphql-yoga";
import { NextRequest, NextResponse } from "next/server";
import { schema } from "@/lib/graphql/schema";
import { buildContext } from "@/lib/graphql/context";
import type * as QueryResolvers from "@/lib/graphql/resolvers/query";
import type * as MutationResolvers from "@/lib/graphql/resolvers/mutation";

/**
 * NOTE: All operation handlers, helper functions, and resolver logic
 * have been extracted to /src/lib/graphql/resolvers/ and are now
 * handled by GraphQL Yoga's schema-based resolver system.
 * 
 * See MIGRATION_LOG.md for details on the migration from RPC-style to proper GraphQL.
 */

const yoga = createYoga({
	schema,
	context: async ({ request }) => buildContext(request as NextRequest),
	fetchAPI: {
		Response: NextResponse as unknown as typeof Response,
	},
});

export const POST = yoga;
export const GET = yoga;
export const OPTIONS = yoga;

/**
 * Helper to execute GraphQL operations programmatically
 * Used by other API routes to call GraphQL resolvers directly
 */
export async function executeGraphQLOperation(
	operation: string,
	variables: Record<string, unknown>,
	session: { userID?: string } | null,
) {
	const context = {
		session,
		userID: session?.userID,
		githubToken: undefined,
	};

	// Import resolvers
	const Query: typeof QueryResolvers = await import("@/lib/graphql/resolvers/query");
	const Mutation: typeof MutationResolvers = await import("@/lib/graphql/resolvers/mutation");
	type ResolverContext = typeof context;
	type ResolverFunction = (
		parent: null,
		args: Record<string, unknown>,
		context: ResolverContext,
	) => Promise<unknown>;
	const queryResolvers = Query as unknown as Record<string, unknown>;
	const mutationResolvers = Mutation as unknown as Record<string, unknown>;

	// Get the resolver function
	const resolverCandidate = queryResolvers[operation] || mutationResolvers[operation];

	if (typeof resolverCandidate !== "function") {
		throw new Error(`Unknown GraphQL operation: ${operation}`);
	}

	const resolver = resolverCandidate as ResolverFunction;

	// Call the resolver directly with null for parent and root, variables, and context
	try {
		const result = await resolver(null, variables, context);
		return result;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
