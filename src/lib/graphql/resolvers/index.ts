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
 * Maps TypeScript camelCase field names to GraphQL snake_case field names
 */
const RepoServices = {
	repo_url: (parent: RepoServicesRecord) => parent.repoUrl,
	repo_owner: (parent: RepoServicesRecord) => parent.repoOwner,
	repo_name: (parent: RepoServicesRecord) => parent.repoName,
	is_monorepo: (parent: RepoServicesRecord) => parent.isMonorepo,
	updated_at: (parent: RepoServicesRecord) => parent.updatedAt,
};

export const resolvers = {
	Query,
	Mutation,
	RepoServices,
};
