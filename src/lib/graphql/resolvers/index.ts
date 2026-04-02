/**
 * GraphQL Resolvers - Index
 * 
 * Combines all Query and Mutation resolvers.
 * To be expanded as we migrate operations.
 */

import * as Query from "./query";
import * as Mutation from "./mutation";

export const resolvers = {
	Query,
	Mutation,
};
