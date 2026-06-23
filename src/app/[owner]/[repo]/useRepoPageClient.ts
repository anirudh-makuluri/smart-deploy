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

export function useRepoPageClient(owner: string, repoName: string) {
	const queryClient = useQueryClient();
	const {
		activeRepo : repo,
		activeRepoRecord: repoRecord,
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

	const services = React.useMemo(() => { return repoRecord?.services || [] }, [repoRecord]);
	const repoDeployments = React.useMemo(() => { return deployments.filter(dep => (dep.repoUrl == repoUrl))}, [deployments, repoUrl]);

	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
		};
	}, [setActiveRepo, setActiveServiceName]);
	
	const { isLoading : isLoadingRepo } = useQuery({
		queryKey: [`${owner}/${repoName}`, "repo"],
		enabled: !repo,
		staleTime: 60_000,
		queryFn: async () => {
			const resolved = await resolveRepo(owner, repoName);
			setActiveRepo(resolved);
			return resolved;
		}
	})

	const { isLoading: isLoadingRepoRecord } = useQuery({
		queryKey: [`${owner}/${repoName}`, "repo-record"],
		enabled: !repoRecord,
		staleTime: 60_000,
		queryFn: async () => {
			const record = await fetchRepoRecord(owner, repoName);
			setActiveRepoRecord(record);
			return record;
		},
	});

	const { isLoading: isLoadingServices, error: errorServices } = useQuery({
		queryKey: [`${owner}/${repoName}`, "repo-services"],
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

	const { isLoading: isLoadingDeployments } = useQuery({
		queryKey: [`${owner}/${repoName}`, "repo-deployments"],
		enabled: repoDeployments.length == 0,
		queryFn: async () => {
			if (!repo) return [];
			const newDeployments = await fetchRepoDeploymentsGraphql(repo.full_name);
			mergeDeployments(newDeployments);
			return newDeployments
		},
	});

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
				queryKey: [`${owner}/${repoName}`, "repo-services"],
			});
		},
		[
			repoUrl,
			mergeRepoRecords,
			queryClient,
			repo,
			owner,
			repoName,
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

	const loading = (isLoadingRepoRecord || isLoadingServices || isLoadingRepo || isLoadingDeployments);
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
		const existingDeployment = repoDeployments.find(dep => dep.serviceName == normalizedServiceName);

		if(!repo) {
			toast.error("An error occured. Refresh the page and try again.")
			return
		}

		if(!existingDeployment) {
			const newDeployment = createDefaultDeployment(repoName, normalizedServiceName, repoUrl, repo.default_branch)
			updateDeploymentById(newDeployment);
		}
		setActiveServiceName(normalizedServiceName);
	}, [repo, repoDeployments, repoName, repoUrl, services, setActiveServiceName, updateDeploymentById]);
	
	
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
