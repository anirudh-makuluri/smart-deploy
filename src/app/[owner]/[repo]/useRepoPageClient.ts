"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppData } from "@/store/useAppData";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { toast } from "sonner";
import {
	resolveRepo,
	detectRepoServices,
	fetchRepoServices,
	fetchRepoDeployments as fetchRepoDeploymentsGraphql,
	addRepoServiceRoot,
	type DetectServicesResult,
} from "@/lib/graphqlClient";
import { getDeploymentForService, normalizeRepoUrl } from "@/lib/utils";
import { generateDefaultHostedSubdomain, normalizeHostedSubdomain } from "@/lib/hostedUrl";
import config from "@/config";

const normalizeRepoUrlForMatch = normalizeRepoUrl;

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
		repoList,
		activeRepo,
		deployments,
		repoServices,
		getDetectedRepoCache,
		setDetectedRepoCache,
		mergeRepoServices,
		syncRepoDeployments,
		updateDeploymentById,
		activeServiceName: storeActiveService,
		setActiveServiceName,
		setActiveRepo,
	} = useAppData();

	const [catalogBusy, setCatalogBusy] = React.useState(false);
	const [mobileWorkspaceNavOpen, setMobileWorkspaceNavOpen] = React.useState(false);
	const deploymentsLoadStartedRef = React.useRef(false);

	const repoFullName = `${owner}/${repoName}`;
	const routeRepoLower = repoFullName.toLowerCase();
	const repoUrl = `https://github.com/${owner}/${repoName}`;

	const repoFromStore = React.useMemo(() => {
		if (activeRepo?.full_name?.toLowerCase() === routeRepoLower) {
			return activeRepo;
		}
		return (
			repoList.find((r) => {
				const sameFullName = r.full_name.toLowerCase() === routeRepoLower;
				const sameUrl = normalizeRepoUrlForMatch(r.html_url) === repoUrl;
				return sameFullName || sameUrl;
			}) ?? null
		);
	}, [activeRepo, repoList, routeRepoLower, repoUrl]);

	const repoQuery = useQuery({
		queryKey: ["repo-resolve", owner, repoName],
		enabled: !repoFromStore,
		queryFn: async () => {
			const resolved = await resolveRepo(owner, repoName);
			return resolved ?? null;
		},
	});

	const repo = repoFromStore ?? repoQuery.data ?? null;
	const detectionBranch = repo?.default_branch ?? "";
	const isLoadingRepo = !repo && repoQuery.isLoading;
	const repoNotFound = !repo && !repoQuery.isLoading && (repoQuery.isError || repoQuery.data === null);

	const cachedServices = React.useMemo(() => {
		const inMemory = getDetectedRepoCache(repoUrl, detectionBranch);
		if (inMemory?.services?.length !== undefined) {
			return inMemory.services;
		}

		const record = repoServices.find(
			(r) => normalizeRepoUrlForMatch(r.repo_url) === repoUrl && (detectionBranch ? r.branch === detectionBranch : true)
		);
		if (record?.services?.length) return record.services;

		return null;
	}, [detectionBranch, getDetectedRepoCache, repoServices, repo, repoUrl]);

	const storedRepoServicesQuery = useQuery({
		queryKey: ["stored-repo-services"],
		enabled: Boolean(repo) && !cachedServices && repoServices.length === 0,
		staleTime: 60_000,
		queryFn: async () => {
			const records = await fetchRepoServices();
			mergeRepoServices(records ?? []);
			return records ?? [];
		},
	});

	React.useEffect(() => {
		const inMemory = getDetectedRepoCache(repoUrl, detectionBranch);
		if (inMemory?.services?.length !== undefined) return () => {};

		const record = repoServices.find(
			(r) => normalizeRepoUrlForMatch(r.repo_url) === repoUrl && (detectionBranch ? r.branch === detectionBranch : true)
		);
		if (!record?.services?.length) return () => {};

		setDetectedRepoCache(repoUrl, detectionBranch, {
			services: record.services,
			isMonorepo: record.is_monorepo ?? false,
			isMultiService: record.services.length > 1,
			packageManager: undefined,
		});
		return () => {};
	}, [detectionBranch, getDetectedRepoCache, repo, repoServices, repoUrl, setDetectedRepoCache]);

	const applyCatalogResult = React.useCallback(
		(data: DetectServicesResult) => {
			const list = data.services ?? [];
			setDetectedRepoCache(repoUrl, repo?.default_branch, {
				services: list,
				isMonorepo: data.isMonorepo ?? false,
				isMultiService: data.isMultiService ?? list.length > 1,
				packageManager: data.packageManager ?? undefined,
			});
			mergeRepoServices([
				{
					repo_url: repoUrl,
					branch: repo?.default_branch ?? "",
					repo_owner: owner,
					repo_name: repoName,
					is_monorepo: data.isMonorepo ?? false,
					updated_at: new Date().toISOString(),
					services: list,
				},
			]);
			void queryClient.invalidateQueries({
				queryKey: ["repo-services", repo?.full_name ?? repoFullName, repo?.default_branch ?? ""],
			});
		},
		[
			repoUrl,
			setDetectedRepoCache,
			mergeRepoServices,
			queryClient,
			repo,
			owner,
			repoName,
			repoFullName,
		]
	);

	const servicesQuery = useQuery({
		queryKey: ["repo-services", repo?.full_name ?? repoFullName, repo?.default_branch ?? ""],
		enabled: Boolean(repo) && !cachedServices && !storedRepoServicesQuery.isLoading,
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
			setDetectedRepoCache(repoUrl, repo?.default_branch, {
				services: list,
				isMonorepo: data.isMonorepo ?? false,
				isMultiService: data.isMultiService ?? false,
				packageManager: data.packageManager ?? undefined,
			});
			mergeRepoServices([nextRecord]);
			return nextRecord;
		},
	});

	const catalogActions = React.useMemo(
		() => ({
			busy: catalogBusy,
			onRefresh: async () => {
				if (!repo) return false;
				setCatalogBusy(true);
				try {
					const data = await detectRepoServices(repoUrl, repo.default_branch ?? "");
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
					const data = await addRepoServiceRoot(repoUrl, repo?.default_branch, rootPath, displayName);
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

	const services = React.useMemo(
		() => cachedServices ?? [],
		[cachedServices]
	);
	const loading = !cachedServices && (storedRepoServicesQuery.isLoading || servicesQuery.isLoading);
	const error = servicesQuery.error
		? getErrorMessage(servicesQuery.error as Error | { message?: string } | string, "Failed to load services")
		: null;

	const repoDeploymentsFromStore = React.useMemo(() => {
		if (!repo) return [];
		return deployments.filter((deployment) => {
			const deploymentUrl = normalizeRepoUrl(deployment.repoUrl ?? "");
			if (deploymentUrl) {
				return deploymentUrl === repoUrl;
			}
			return deployment.repoName === repo.name;
		});
	}, [deployments, repo, repo]);

	const repoDeploymentsQuery = useQuery({
		queryKey: ["repo-deployments", repo?.full_name ?? repoFullName],
		enabled: false,
		queryFn: async () => {
			if (!repo) return [];
			return fetchRepoDeploymentsGraphql(repo.full_name);
		},
	});

	const startDeploymentsLoad = React.useCallback(() => {
		if (!repo || deploymentsLoadStartedRef.current) return;
		deploymentsLoadStartedRef.current = true;
		void queryClient.fetchQuery({
			queryKey: ["repo-deployments", repo.full_name],
			queryFn: async () => fetchRepoDeploymentsGraphql(repo.full_name),
		});
	}, [queryClient, repo]);

	React.useEffect(() => {
		if (!repo || repoDeploymentsQuery.data === undefined) return () => {};
		syncRepoDeployments(repo.full_name, repoDeploymentsQuery.data);
		return () => {};
	}, [repo, repoDeploymentsQuery.data, syncRepoDeployments]);

	const repoDeployments = repoDeploymentsFromStore;

	const activeService = React.useMemo<DetectedServiceInfo | null>(() => {
		if (activeRepo?.full_name?.toLowerCase() !== routeRepoLower) return null;
		if (!storeActiveService) return null;
		// "Deploy all on one instance" sets activeServiceName to "."; that row is not in detected services.
		if (storeActiveService === "." && services.length > 0) {
			return { name: ".", path: ".", language: "unknown", deployMode: "container" };
		}
		return services.find((svc: DetectedServiceInfo) => svc.name === storeActiveService) ?? null;
	}, [activeRepo, routeRepoLower, services, storeActiveService]);

	const scheduleLazyDeploymentFetch = React.useCallback(() => {
		if (!repo || deploymentsLoadStartedRef.current) return;
		if (typeof window !== "undefined" && "requestIdleCallback" in window) {
			const idleWindow = window as Window & {
				requestIdleCallback?: (callback: () => void) => number;
			};
			idleWindow.requestIdleCallback?.(() => {
				startDeploymentsLoad();
			});
			return;
		}
		setTimeout(() => {
			startDeploymentsLoad();
		}, 0);
	}, [repo, startDeploymentsLoad]);

	React.useEffect(() => {
		scheduleLazyDeploymentFetch();
	}, [scheduleLazyDeploymentFetch]);

	React.useEffect(() => {
		if (!repo) return () => {};
		if (activeRepo?.full_name?.toLowerCase() !== repo.full_name.toLowerCase()) {
			setActiveRepo(repo as repoType);
		}
		startDeploymentsLoad();
		return () => {};
	}, [activeRepo, repo, setActiveRepo, startDeploymentsLoad]);

	React.useEffect(() => {
		setActiveServiceName(null);
	}, [routeRepoLower, setActiveServiceName]);

	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
		};
	}, [setActiveRepo, setActiveServiceName]);

	const openWorkspaceForService = React.useCallback(async (svc: DetectedServiceInfo) => {
		const normalizedServiceName =
			svc.name === "." && services.length === 1 ? services[0]?.name ?? "." : svc.name;

		let deploymentsForRepo = repoDeployments;
		if (repo && repoDeployments.length === 0) {
			try {
				const fetchedDeployments = await fetchRepoDeploymentsGraphql(repo.full_name);
				syncRepoDeployments(repo.full_name, fetchedDeployments);
				deploymentsForRepo = fetchedDeployments;
			} catch {
				// Non-blocking: we can still open the workspace using local state.
			}
		}

		// Ensure a deployment row exists before entering DeployWorkspace.
		// (useActiveDeployment can synthesize a draft locally, but we want an immediate persisted record.)
		const existingDeployment = repo
			? getDeploymentForService(deploymentsForRepo, repo.html_url, normalizedServiceName, repo.name)
			: null;

		if (repo && !existingDeployment) {
			try {
				await updateDeploymentById({
					repoName: repo.name,
					serviceName: normalizedServiceName,
					repoUrl: repo.html_url,
					branch: repo.default_branch ?? "main",
					hostedSubdomain: generateDefaultHostedSubdomain(repo.name),
					status: "didnt_deploy",
					cloudProvider: "aws",
					deploymentTarget: "ecs",
					region: process.env.NEXT_PUBLIC_AWS_REGION || config.AWS_REGION || "us-west-2",
				});
			} catch (e) {
				// Non-blocking: still allow the workspace to open using the local draft deployment.
				toast.error(getErrorMessage(e as Error, "Failed to create deployment"));
			}
		} else if (
			repo &&
			existingDeployment &&
			!normalizeHostedSubdomain(existingDeployment.hostedSubdomain)
		) {
			try {
				await updateDeploymentById({
					repoName: repo.name,
					serviceName: normalizedServiceName,
					hostedSubdomain: generateDefaultHostedSubdomain(repo.name),
				});
			} catch {
				// Non-blocking: local draft still gets a generated subdomain via useActiveDeployment.
			}
		}

		if (repo) {
			setActiveRepo(repo as repoType);
		}
		startDeploymentsLoad();
		setActiveServiceName(normalizedServiceName);
	}, [
		repo,
		repoDeployments,
		services,
		setActiveRepo,
		setActiveServiceName,
		startDeploymentsLoad,
		syncRepoDeployments,
		updateDeploymentById,
	]);

	return {
		repo,
		repoUrl,
		isLoadingRepo,
		repoNotFound,
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
