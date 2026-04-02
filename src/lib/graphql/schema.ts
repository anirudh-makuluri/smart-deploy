/**
 * GraphQL Schema
 * 
 * Builds the complete GraphQL schema from SDL and resolvers.
 */

import { makeExecutableSchema } from "@graphql-tools/schema";
import { typeDefs } from "./types";
import { resolvers } from "./resolvers";

export const schema = makeExecutableSchema({
	typeDefs,
	resolvers,
});
