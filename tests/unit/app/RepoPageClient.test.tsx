import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepoPageClient from "@/app/[owner]/[repo]/RepoPageClient";
import type { RepoRecord, repoType } from "@/app/types";
import { useAppData } from "@/store/useAppData";

const resolveRepo = vi.fn();
const fetchRepoRecord = vi.fn();
const fetchRepoDeployments = vi.fn();
const detectRepoServices = vi.fn();
const addRepoServiceRoot = vi.fn();

vi.mock("@/lib/graphqlClient", () => ({
	resolveRepo: (...args: unknown[]) => resolveRepo(...args),
	fetchRepoRecord: (...args: unknown[]) => fetchRepoRecord(...args),
	fetchRepoDeployments: (...args: unknown[]) => fetchRepoDeployments(...args),
	detectRepoServices: (...args: unknown[]) => detectRepoServices(...args),
	addRepoServiceRoot: (...args: unknown[]) => addRepoServiceRoot(...args),
}));

vi.mock("@/components/Header", () => ({
	default: () => <div>Header</div>,
}));

vi.mock("@/components/DeployWorkspace", () => ({
	default: () => <div>DeployWorkspace</div>,
}));

vi.mock("@/components/RepoServicesList", () => ({
	default: ({
		resolvedRepo,
		services,
	}: {
		resolvedRepo: repoType;
		services: Array<{ name: string }>;
	}) => (
		<div>
			<div>{resolvedRepo.full_name}</div>
			<div>{services.map((service) => service.name).join(",")}</div>
		</div>
	),
}));

const repo: repoType = {
	id: "repo-1",
	name: "shop",
	full_name: "acme/shop",
	html_url: "https://github.com/acme/shop",
	language: "TypeScript",
	languages_url: "https://api.github.com/repos/acme/shop/languages",
	created_at: "2026-06-24T00:00:00.000Z",
	updated_at: "2026-06-24T00:00:00.000Z",
	pushed_at: "2026-06-24T00:00:00.000Z",
	default_branch: "main",
	private: false,
	visibility: "public",
	owner: {
		login: "acme",
	},
	latest_commit: null,
	branches: [],
};

const repoRecord: RepoRecord = {
	repo_url: "https://github.com/acme/shop",
	branch: "main",
	repo_owner: "acme",
	repo_name: "shop",
	is_monorepo: false,
	updated_at: "2026-06-24T00:00:00.000Z",
	services: [
		{
			name: "web",
			path: ".",
			language: "typescript",
			deployMode: "container",
		},
	],
};

describe("RepoPageClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useAppData.setState({
			repoList: [],
			deployments: [],
			activeRepo: null,
			activeRepoRecord: null,
			activeServiceName: null,
			repoRecords: [],
			detectedRepoCache: {},
			isLoading: false,
			hasFetched: true,
		});

		resolveRepo.mockResolvedValue(repo);
		fetchRepoRecord.mockResolvedValue(repoRecord);
		fetchRepoDeployments.mockResolvedValue([]);
		detectRepoServices.mockResolvedValue({
			isMonorepo: false,
			isMultiService: false,
			services: repoRecord.services,
		});
		addRepoServiceRoot.mockResolvedValue({
			isMonorepo: false,
			isMultiService: false,
			services: repoRecord.services,
		});
	});

	it("keeps showing the repo when revisiting with a warm query cache", async () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});

		const view = render(
			<QueryClientProvider client={queryClient}>
				<RepoPageClient owner="acme" repoName="shop" />
			</QueryClientProvider>
		);

		await waitFor(() => {
			expect(screen.getByText("acme/shop")).toBeInTheDocument();
		});
		expect(screen.getByText("web")).toBeInTheDocument();
		expect(resolveRepo).toHaveBeenCalledTimes(1);
		expect(fetchRepoRecord).toHaveBeenCalledTimes(1);

		view.rerender(
			<QueryClientProvider client={queryClient}>
				{null}
			</QueryClientProvider>
		);

		expect(useAppData.getState().activeRepo).toBeNull();
		expect(useAppData.getState().activeRepoRecord).toBeNull();

		view.rerender(
			<QueryClientProvider client={queryClient}>
				<RepoPageClient owner="acme" repoName="shop" />
			</QueryClientProvider>
		);

		await waitFor(() => {
			expect(screen.getByText("acme/shop")).toBeInTheDocument();
		});
		expect(screen.queryByText("Repository Not Found")).not.toBeInTheDocument();
		expect(resolveRepo).toHaveBeenCalledTimes(1);
		expect(fetchRepoRecord).toHaveBeenCalledTimes(1);
	});
});
