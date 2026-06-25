"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppData } from "@/store/useAppData";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { toast } from "sonner";
import {
	detectRepoServices,
	fetchRepoDeployments as fetchRepoDeploymentsGraphql,
	addRepoServiceRoot,
	type DetectServicesResult,
	resolveRepo,
	fetchRepoRecord,
} from "@/lib/graphqlClient";
import { getDeploymentForService } from "@/lib/utils";
import { generateDefaultHostedSubdomain, normalizeHostedSubdomain } from "@/lib/hostedUrl";
import config from "@/config";
import { createDefaultDeployment } from "@/custom-hooks/useActiveDeployment";


function getErrorMessage(error: Error | { message?: string } | string | null | undefined, fallback: string): string {
	if (!error) return fallback;
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	if (typeof error.message === "string" && error.message.length > 0) return error.message;
	return fallback;
}

function matchesRepoRoute(repo: repoType | null, owner: string, repoName: string): boolean {
	if (!repo) return false;
	return repo.full_name.toLowerCase() === `${owner}/${repoName}`.toLowerCase();
}

function matchesRepoRecordRoute(repoRecord: {
	repo_owner: string;
	repo_name: string;
} | null, owner: string, repoName: string): boolean {
	if (!repoRecord) return false;
	return (
		repoRecord.repo_owner.toLowerCase() === owner.toLowerCase() &&
		repoRecord.repo_name.toLowerCase() === repoName.toLowerCase()
	);
}

export function useRepoPageClient(owner: string, repoName: string) {
	const queryClient = useQueryClient();
	const {
		activeRepo,
		activeRepoRecord,
		activeServiceName: serviceName,
		deployments,
		mergeRepoRecords,
		mergeDeployments,
		updateDeploymentById,
		setActiveServiceName,
		setActiveRepo,
		setActiveRepoRecord
	} = useAppData();

	const [catalogBusy, setCatalogBusy] = React.useState(false);
	const [mobileWorkspaceNavOpen, setMobileWorkspaceNavOpen] = React.useState(false);

	const repoUrl = `https://github.com/${owner}/${repoName}`;
	const routeKey = `${owner}/${repoName}`.toLowerCase();
	const activeRepoMatchesRoute = matchesRepoRoute(activeRepo, owner, repoName);
	const activeRepoRecordMatchesRoute = matchesRepoRecordRoute(activeRepoRecord, owner, repoName);

	const { data: repoQueryData, isLoading : isLoadingRepo } = useQuery({
		queryKey: [routeKey, "repo"],
		enabled: !activeRepoMatchesRoute,
		staleTime: 60_000,
		queryFn: async () => {
			const resolved = await resolveRepo(owner, repoName);
			setActiveRepo(resolved);
			return resolved;
		}
	});

	const repo = activeRepoMatchesRoute ? activeRepo : (repoQueryData ?? null);

	const { data: repoRecordQueryData, isLoading: isLoadingRepoRecord } = useQuery({
		queryKey: [routeKey, "repo-record"],
		enabled: !activeRepoRecordMatchesRoute,
		staleTime: 60_000,
		queryFn: async () => {
			const record = await fetchRepoRecord(owner, repoName);
			setActiveRepoRecord(record);
			return record;
		},
	});

	const repoRecord = activeRepoRecordMatchesRoute ? activeRepoRecord : (repoRecordQueryData ?? null);
	const services = React.useMemo(() => { return repoRecord?.services || [] }, [repoRecord]);
	const repoDeployments = React.useMemo(() => { return deployments.filter(dep => (dep.repoUrl == repoUrl))}, [deployments, repoUrl]);
	const hasRepoDeployments = repoDeployments.length > 0;

	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
			setActiveRepoRecord(null);
		};
	}, [setActiveRepo, setActiveRepoRecord, setActiveServiceName]);

	const { isLoading: isLoadingServices, error: errorServices } = useQuery({
		queryKey: [routeKey, "repo-services"],
		enabled: !isLoadingRepoRecord && (!repoRecord || repoRecord.services.length === 0),
		queryFn: async () => {
			const data = await detectRepoServices(repoUrl, repo?.default_branch ?? "");
			const list = data.services ?? [];
			const nextRecord = {
				repo_url: repoUrl,
				branch: repo?.default_branch ?? "",
				repo_owner: owner,
				repo_name: repoName,
				is_monorepo: data.isMonorepo ?? false,
				updated_at: new Date().toISOString(),
				services: list,
			};

			mergeRepoRecords([nextRecord]);
			setActiveRepoRecord(nextRecord);
			return nextRecord;
		},
	});

	const {
		isFetched: hasFetchedDeployments,
		isError: hasDeploymentsError,
	} = useQuery({
		queryKey: [routeKey, "repo-deployments"],
		enabled: Boolean(repo) && !hasRepoDeployments,
		queryFn: async () => {
			if (!repo) return [];
			const newDeployments = await fetchRepoDeploymentsGraphql(repo.full_name);
			mergeDeployments(newDeployments);
			return newDeployments
		},
	});

	const repoDeploymentsReady = hasRepoDeployments || !repo || hasFetchedDeployments || hasDeploymentsError;

	const applyCatalogResult = React.useCallback(
		(data: DetectServicesResult) => {
			const list = data.services ?? [];
			const nextRecord = {
				repo_url: repoUrl,
				branch: repo?.default_branch ?? "",
				repo_owner: owner,
				repo_name: repoName,
				is_monorepo: data.isMonorepo ?? false,
				updated_at: new Date().toISOString(),
				services: list,
			};
			mergeRepoRecords([nextRecord]);
			setActiveRepoRecord(nextRecord);
			void queryClient.invalidateQueries({
				queryKey: [routeKey, "repo-services"],
			});
		},
		[
			repoUrl,
			mergeRepoRecords,
			queryClient,
			repo,
			owner,
			repoName,
			routeKey,
			setActiveRepoRecord,
		]
	);

	const catalogActions = React.useMemo(
		() => ({
			busy: catalogBusy,
			onRefresh: async () => {
				if (!repo) return false;
				setCatalogBusy(true);
				try {
					const data = await detectRepoServices(repoUrl, repo.default_branch);
					applyCatalogResult(data);
					toast.success("Service detection refreshed");
					return true;
				} catch (e) {
					console.error(e);
					toast.error("Failed to refresh service detection");
					return false;
				} finally {
					setCatalogBusy(false);
				}
			},
			onAddService: async (rootPath: string, displayName?: string) => {
				setCatalogBusy(true);
				try {
					if(!repo) throw new Error("Repo not found");
					const data = await addRepoServiceRoot(repoUrl, repo.default_branch, rootPath, displayName);
					applyCatalogResult(data);
					toast.success("Service added");
					return true;
				} catch (e) {
					toast.error(getErrorMessage(e as Error, "Failed to add service"));
					return false;
				} finally {
					setCatalogBusy(false);
				}
			},
		}),
		[catalogBusy, repoUrl, repo, applyCatalogResult]
	);

	const loading = (isLoadingRepoRecord || isLoadingServices || isLoadingRepo || !repoDeploymentsReady);
	const error = errorServices
		? getErrorMessage(errorServices as Error | { message?: string } | string, "Failed to load services")
		: null;

	const activeService = React.useMemo<DetectedServiceInfo | null>(() => {
		if (!serviceName) return null;
		if (serviceName === "." && services.length > 0) {
			return { name: ".", path: ".", language: "unknown", deployMode: "container" };
		}
		return services.find((svc: DetectedServiceInfo) => svc.name === serviceName) ?? null;
	}, [services, serviceName]);


	const openWorkspaceForService = React.useCallback(async (svc: DetectedServiceInfo) => {
		const normalizedServiceName = svc.name === "." && services.length === 1 ? services[0]?.name ?? "." : svc.name;

		if(!repo) {
			toast.error("An error occured. Refresh the page and try again.")
			return
		}

		if (!repoDeploymentsReady) {
			toast.info("Loading deployment data. Please try again in a moment.");
			return;
		}

		const existingDeployment = repoDeployments.find(dep => dep.serviceName == normalizedServiceName);

		if(!existingDeployment) {
			const newDeployment = createDefaultDeployment(repoName, normalizedServiceName, repoUrl, repo.default_branch)
			await updateDeploymentById(newDeployment);
		}
		setActiveRepo(repo);
		if (repoRecord) {
			setActiveRepoRecord(repoRecord);
		}
		setActiveServiceName(normalizedServiceName);
	}, [repo, repoDeployments, repoDeploymentsReady, repoName, repoRecord, repoUrl, services, setActiveRepo, setActiveRepoRecord, setActiveServiceName, updateDeploymentById]);
	
	
	return {
		repo,
		repoUrl,
		activeService,
		mobileWorkspaceNavOpen,
		setMobileWorkspaceNavOpen,
		services,
		loading,
		error,
		repoDeployments,
		openWorkspaceForService,
		catalogActions,
	};
}
