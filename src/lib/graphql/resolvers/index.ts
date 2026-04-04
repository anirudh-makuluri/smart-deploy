/**
 * GraphQL Resolvers - Index
 * 
 * Combines all Query and Mutation resolvers.
 * To be expanded as we migrate operations.
 */

import * as Query from "./query";
import * as Mutation from "./mutation";
import { RepoServicesRecord } from "@/app/types";

/**
 * RepoServices type resolvers
 * GraphQL field names match TypeScript property names (both use snake_case)
 */
const RepoServices = {
	repo_url: (parent: RepoServicesRecord) => parent.repo_url,
	repo_owner: (parent: RepoServicesRecord) => parent.repo_owner,
	repo_name: (parent: RepoServicesRecord) => parent.repo_name,
	is_monorepo: (parent: RepoServicesRecord) => parent.is_monorepo,
	updated_at: (parent: RepoServicesRecord) => parent.updated_at,
};

export const resolvers = {
	Query,
	Mutation,
	RepoServices,
};
