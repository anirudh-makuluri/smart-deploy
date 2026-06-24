"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useAppData } from "@/store/useAppData";
import { addPublicRepo } from "@/lib/graphqlClient";
import {
	buildRepoCards,
	getDashboardErrorMessage,
	parseGitHubUrl,
} from "@/components/dashboard/dashboardMainUtils";

export function useDashboardMain() {
	const router = useRouter();
	const { data: session } = authClient.useSession();
	const {
		deployments = [],
		repoRecords = [],
		repoList = [],
		isLoading,
		setAppData,
		refreshRepoList,
	} = useAppData();
	const [ui, dispatch] = React.useReducer(
		(
			state: {
				isRefreshing: boolean;
				showAddRepo: boolean;
				repoUrl: string;
				isLoadingRepo: boolean;
				repoSearch: string;
			},
			action:
				| { type: "set_refreshing"; value: boolean }
				| { type: "toggle_add_repo" }
				| { type: "set_repo_url"; value: string }
				| { type: "set_loading_repo"; value: boolean }
				| { type: "set_repo_search"; value: string }
				| { type: "reset_add_repo" }
		) => {
			switch (action.type) {
				case "set_refreshing":
					return { ...state, isRefreshing: action.value };
				case "toggle_add_repo":
					return { ...state, showAddRepo: !state.showAddRepo };
				case "set_repo_url":
					return { ...state, repoUrl: action.value };
				case "set_loading_repo":
					return { ...state, isLoadingRepo: action.value };
				case "set_repo_search":
					return { ...state, repoSearch: action.value };
				case "reset_add_repo":
					return { ...state, showAddRepo: false, repoUrl: "" };
				default:
					return state;
			}
		},
		{
			isRefreshing: false,
			showAddRepo: false,
			repoUrl: "",
			isLoadingRepo: false,
			repoSearch: "",
		}
	);

	const repoCards = React.useMemo(
		() => buildRepoCards(repoRecords, repoList, deployments),
		[deployments, repoList, repoRecords]
	);

	const filteredRepositories = React.useMemo(() => {
		const query = ui.repoSearch.trim().toLowerCase();
		if (!query) return repoList;
		return repoList.filter((repo) =>
			`${repo.full_name}`
				.toLowerCase()
				.includes(query)
		);
	}, [repoList, ui.repoSearch]);

	const visibleRepositories = React.useMemo(
		() => (ui.repoSearch.trim() ? filteredRepositories : filteredRepositories.slice(0, 10)),
		[filteredRepositories, ui.repoSearch]
	);

	async function handleRefresh() {
		dispatch({ type: "set_refreshing", value: true });
		const response = await refreshRepoList();
		dispatch({ type: "set_refreshing", value: false });
		toast(response.message);
	}

	async function handleAddPublicRepo() {
		if (!ui.repoUrl.trim()) {
			toast.error("Please enter a GitHub URL");
			return;
		}
		const parsed = parseGitHubUrl(ui.repoUrl);
		if (!parsed) {
			toast.error("Invalid GitHub URL. Format: https://github.com/owner/repo");
			return;
		}
		dispatch({ type: "set_loading_repo", value: true });
		try {
			const repo = await addPublicRepo(parsed.owner, parsed.repo);
			if (!repo) {
				toast.error("Failed to fetch repository");
				return;
			}
			dispatch({ type: "reset_add_repo" });
			setAppData([repo, ...repoList], deployments, repoRecords);
			toast.success(`Added ${repo.full_name}`);
			router.push(`/${repo.owner.login}/${repo.name}`);
		} catch (error) {
			toast.error(getDashboardErrorMessage(error as Error | { message?: string } | null));
		} finally {
			dispatch({ type: "set_loading_repo", value: false });
		}
	}

	return {
		session,
		isLoading,
		repoCards,
		visibleRepositories,
		repoList,
		ui,
		dispatch,
		handleRefresh,
		handleAddPublicRepo,
	};
}
