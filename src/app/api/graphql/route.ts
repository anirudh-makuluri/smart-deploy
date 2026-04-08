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
		Response: NextResponse as any,
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
	session: any,
) {
	const context = {
		session,
		userID: session?.userID,
		token: session?.accessToken,
	};

	// Import resolvers
	const Query = require("@/lib/graphql/resolvers/query");
	const Mutation = require("@/lib/graphql/resolvers/mutation");

	// Get the resolver function
	const resolver = Query[operation] || Mutation[operation];

	if (!resolver) {
		throw new Error(`Unknown GraphQL operation: ${operation}`);
	}

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
