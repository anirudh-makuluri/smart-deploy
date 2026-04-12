"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAppData } from "@/store/useAppData";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { toast } from "sonner";
import DeployWorkspace from "@/components/DeployWorkspace";
import Header from "@/components/Header";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import RepoServicesList from "@/components/RepoServicesList";
import { deleteDeployment, resolveRepo, detectRepoServices, fetchRepoDeployments as fetchRepoDeploymentsGraphql } from "@/lib/graphqlClient";
import { normalizeRepoUrl } from "@/lib/utils";

const normalizeRepoUrlForMatch = normalizeRepoUrl;

type RepoPageClientProps = {
	owner: string;
	repoName: string;
};

function getErrorMessage(error: Error | { message?: string } | string | null | undefined, fallback: string): string {
	if (!error) return fallback;
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	if (typeof error.message === "string" && error.message.length > 0) return error.message;
	return fallback;
}


export default function RepoPageClient({ owner, repoName }: RepoPageClientProps) {
	const {
		repoList,
		activeRepo,
		deployments,
		repoServices,
		refetchRepoServices,
		getDetectedRepoCache,
		setDetectedRepoCache,
		removeDeployments,
		activeServiceName: storeActiveService,
		setActiveServiceName,
		setActiveRepo,
	} = useAppData();

	const [isDeleting, setIsDeleting] = React.useState(false);
	const [showDeleteAllConfirm, setShowDeleteAllConfirm] = React.useState(false);
	const [shouldLoadDeployments, setShouldLoadDeployments] = React.useState(false);

	const repoFullName = `${owner}/${repoName}`;
	const routeRepoLower = repoFullName.toLowerCase();
	const repoUrl = `https://github.com/${owner}/${repoName}`;
	const normalizedRepoUrl = normalizeRepoUrlForMatch(repoUrl);

	const repoFromStore = React.useMemo(() => {
		if (activeRepo?.full_name?.toLowerCase() === routeRepoLower) {
			return activeRepo;
		}
		return (
			repoList.find((r) => {
				const sameFullName = r.full_name.toLowerCase() === routeRepoLower;
				const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedRepoUrl;
				return sameFullName || sameUrl;
			}) ?? null
		);
	}, [activeRepo, repoList, routeRepoLower, normalizedRepoUrl]);

	const repoQuery = useQuery({
		queryKey: ["repo-resolve", owner, repoName],
		enabled: !repoFromStore,
		queryFn: async () => {
			const resolved = await resolveRepo(owner, repoName);
			return resolved ?? null;
		},
	});

	const repo = repoFromStore ?? repoQuery.data ?? null;
	const isLoadingRepo = !repo && repoQuery.isLoading;
	const repoNotFound = !repo && !repoQuery.isLoading && (repoQuery.isError || repoQuery.data === null);

	const cachedServices = React.useMemo(() => {
		const inMemory = getDetectedRepoCache(repoUrl);
		if (inMemory?.services?.length !== undefined) {
			return inMemory.services;
		}

		const record = repoServices.find((r) => normalizeRepoUrlForMatch(r.repo_url) === normalizedRepoUrl);
		if (record?.services?.length) return record.services;

		return null;
	}, [getDetectedRepoCache, repoServices, normalizedRepoUrl, repoUrl]);

	React.useEffect(() => {
		const inMemory = getDetectedRepoCache(repoUrl);
		if (inMemory?.services?.length !== undefined) return;

		const record = repoServices.find((r) => normalizeRepoUrlForMatch(r.repo_url) === normalizedRepoUrl);
		if (!record?.services?.length) return;

		setDetectedRepoCache(repoUrl, {
			services: record.services,
			isMonorepo: record.is_monorepo ?? false,
			isMultiService: record.services.length > 1,
			packageManager: undefined,
		});
	}, [getDetectedRepoCache, normalizedRepoUrl, repoServices, repoUrl, setDetectedRepoCache]);

	const servicesQuery = useQuery({
		queryKey: ["repo-services", repo?.full_name ?? repoFullName, repo?.default_branch ?? ""],
		enabled: Boolean(repo) && !cachedServices,
		queryFn: async () => {
			const data = await detectRepoServices(repoUrl, repo?.default_branch ?? "");
			const list = data.services ?? [];
			setDetectedRepoCache(repoUrl, {
				services: list,
				isMonorepo: data.isMonorepo ?? false,
				isMultiService: data.isMultiService ?? false,
				packageManager: data.packageManager ?? undefined,
			});
			void refetchRepoServices();
			return list;
		},
	});

	const services = React.useMemo(
		() => cachedServices ?? servicesQuery.data ?? [],
		[cachedServices, servicesQuery.data]
	);
	const loading = !cachedServices && servicesQuery.isLoading;
	const error = servicesQuery.error
		? getErrorMessage(servicesQuery.error as Error | { message?: string } | string, "Failed to load services")
		: null;

	const repoDeploymentsFromStore = React.useMemo(() => {
		if (!repo) return [];
		return deployments.filter((deployment) => {
			const deploymentUrl = normalizeRepoUrl(deployment.url ?? "");
			if (deploymentUrl) {
				return deploymentUrl === normalizedRepoUrl;
			}
			return deployment.repoName === repo.name;
		});
	}, [deployments, normalizedRepoUrl, repo]);

	const repoDeploymentsQuery = useQuery({
		queryKey: ["repo-deployments", repo?.full_name ?? repoFullName],
		enabled: shouldLoadDeployments && Boolean(repo),
		queryFn: async () => {
			if (!repo) return [];
			return fetchRepoDeploymentsGraphql(repo.full_name);
		},
	});

	const repoDeployments = shouldLoadDeployments
		? repoDeploymentsQuery.data ?? repoDeploymentsFromStore
		: repoDeploymentsFromStore;

	const activeService = React.useMemo<DetectedServiceInfo | null>(() => {
		if (activeRepo?.full_name?.toLowerCase() !== routeRepoLower) return null;
		if (!storeActiveService) return null;
		// "Deploy all on one instance" sets activeServiceName to "." — that row is not in detected services.
		if (storeActiveService === "." && services.length > 0) {
			return { name: ".", path: ".", language: "unknown" };
		}
		return services.find((svc: DetectedServiceInfo) => svc.name === storeActiveService) ?? null;
	}, [activeRepo, routeRepoLower, services, storeActiveService]);

	const scheduleLazyDeploymentFetch = React.useCallback(() => {
		if (!repo || shouldLoadDeployments) return;
		if (typeof window !== "undefined" && "requestIdleCallback" in window) {
			const idleWindow = window as Window & {
				requestIdleCallback?: (callback: () => void) => number;
			};
			idleWindow.requestIdleCallback?.(() => {
				setShouldLoadDeployments(true);
			});
			return;
		}
		setTimeout(() => {
			setShouldLoadDeployments(true);
		}, 0);
	}, [repo, shouldLoadDeployments]);

	React.useEffect(() => {
		scheduleLazyDeploymentFetch();
	}, [scheduleLazyDeploymentFetch]);

	React.useEffect(() => {
		setActiveServiceName(null);
	}, [routeRepoLower, setActiveServiceName]);

	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
		};
	}, [setActiveRepo, setActiveServiceName]);

	function openWorkspaceForService(svc: DetectedServiceInfo) {
		if (repo) {
			setActiveRepo(repo as repoType);
		}
		setShouldLoadDeployments(true);
		setActiveServiceName(svc.name);
	}

	async function handleConfirmDeleteAll() {
		if (repoDeployments.length === 0) return;
		setIsDeleting(true);
		setShowDeleteAllConfirm(false);
		const deletedKeys: { repoName: string; serviceName: string }[] = [];
		try {
			for (const dep of repoDeployments) {
				try {
				await deleteDeployment(dep.repoName, dep.serviceName);
				deletedKeys.push({ repoName: dep.repoName, serviceName: dep.serviceName });
				} catch (error) {
					toast.error(getErrorMessage(error as Error | { message?: string } | string, `Failed to delete ${dep.serviceName}`));
				}
			}
			if (deletedKeys.length) {
				removeDeployments(deletedKeys);
				await repoDeploymentsQuery.refetch();
			}
			toast.success("Finished deleting deployments for this repo.");
		} finally {
			setIsDeleting(false);
		}
	}

	async function handleDeleteAllDeployments() {
		setShouldLoadDeployments(true);
		let nextDeployments = repoDeployments;
		if (!shouldLoadDeployments) {
			const refetchResult = await repoDeploymentsQuery.refetch();
			nextDeployments = refetchResult.data ?? [];
		}
		if (nextDeployments.length === 0) {
			toast.error("No deployments found for this repo.");
			return;
		}
		setShowDeleteAllConfirm(true);
	}

	return (
		<div className={`dot-grid-bg flex flex-col text-foreground ${activeService ? "h-svh overflow-hidden" : "min-h-svh"}`}>
			{isLoadingRepo && (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center space-y-4">
						<div className="inline-block">
							<div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
						</div>
						<p className="text-muted-foreground">Loading repository…</p>
					</div>
				</div>
			)}
			{repoNotFound && !isLoadingRepo && (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center space-y-4">
						<h1 className="text-3xl font-bold">Repository Not Found</h1>
						<p className="text-muted-foreground">
							The repository <span className="font-mono font-semibold">{owner}/{repoName}</span> does not exist or is not accessible.
						</p>
						<Link
							href="/"
							className="inline-block mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
						>
							Go Back Home
						</Link>
					</div>
				</div>
			)}
			{!repoNotFound && !isLoadingRepo && repo && (
				<>
					{isDeleting && (
						<div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
							<span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
							<span className="text-sm font-medium text-foreground">Deleting deployments…</span>
						</div>
					)}
					<Header />

					<main className={activeService ? "flex-1 min-h-0 overflow-hidden" : "flex-1 min-h-0 overflow-auto"}>
						{activeService ? (
							<DeployWorkspace key={`${repo.full_name}:${activeService.name}`} />
						) : (
							<RepoServicesList
								owner={owner}
								repoName={repoName}
								repoUrl={repoUrl}
								services={services}
								loading={loading}
								error={error}
								repoDeployments={repoDeployments}
								resolvedRepo={repo}
								setActiveService={openWorkspaceForService}
								handleDeleteAllDeployments={handleDeleteAllDeployments}
								openWorkspaceForService={openWorkspaceForService}
							/>
						)}
					</main>

					<ConfirmDialog
						open={showDeleteAllConfirm}
						onOpenChange={setShowDeleteAllConfirm}
						onConfirm={handleConfirmDeleteAll}
						title="Delete All Deployments?"
						description={`This will permanently delete all ${repoDeployments.length} deployments associated with this repository. This action cannot be undone and will stop all running services.`}
						confirmText="Delete All"
						variant="destructive"
					/>
				</>
			)}
		</div>
	);
}
