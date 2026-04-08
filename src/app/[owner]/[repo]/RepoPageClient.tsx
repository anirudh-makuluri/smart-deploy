"use client";

import * as React from "react";
import { useAppData } from "@/store/useAppData";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { toast } from "sonner";
import DeployWorkspace from "@/components/DeployWorkspace";
import Header from "@/components/Header";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import RepoServicesList from "@/components/RepoServicesList";
import { deleteDeployment, resolveRepo, detectRepoServices } from "@/lib/graphqlClient";
import { normalizeRepoUrl } from "@/lib/utils";

const normalizeRepoUrlForMatch = normalizeRepoUrl;

type RepoPageClientProps = {
	owner: string;
	repoName: string;
};


export default function RepoPageClient({ owner, repoName }: RepoPageClientProps) {
	const {
		repoList,
		deployments,
		repoServices,
		refetchRepoServices,
		getDetectedRepoCache,
		setDetectedRepoCache,
		removeDeployments,
		refetchDeployments,
		fetchRepoDeployments,
		activeServiceName: storeActiveService,
		setActiveServiceName,
		setActiveRepo,
		activeRepo,
	} = useAppData();

	const [isDeleting, setIsDeleting] = React.useState(false);
	const [showDeleteAllConfirm, setShowDeleteAllConfirm] = React.useState(false);
	const [repoNotFound, setRepoNotFound] = React.useState(false);
	const [isLoadingRepo, setIsLoadingRepo] = React.useState(false);

	// Set active repo, fetching from GitHub if not in store
	React.useEffect(() => {
		// If activeRepo already matches current route, no need to refetch
		if (activeRepo?.full_name.toLowerCase() === `${owner}/${repoName}`.toLowerCase()) {
			setRepoNotFound(false);
			setIsLoadingRepo(false);
			return;
		}

		// Search store for the repo
		const normalizedUrl = normalizeRepoUrlForMatch(`https://github.com/${owner}/${repoName}`);
		const found = repoList.find((r) => {
			const sameFullName = r.full_name.toLowerCase() === `${owner}/${repoName}`.toLowerCase();
			const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedUrl;
			return sameFullName || sameUrl;
		});

		if (found) {
			setActiveRepo(found);
			setRepoNotFound(false);
			setIsLoadingRepo(false);
			return;
		}

		// Repo not in store, fetch from GitHub
		let cancelled = false;
		setIsLoadingRepo(true);
		setRepoNotFound(false);

		void (async () => {
			try {
				const repo = await resolveRepo(owner, repoName);
				if (!cancelled) {
					if (repo) {
						setActiveRepo(repo);
						setRepoNotFound(false);
					} else {
						setRepoNotFound(true);
					}
					setIsLoadingRepo(false);
				}
			} catch {
				if (!cancelled) {
					setRepoNotFound(true);
					setIsLoadingRepo(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [owner, repoName, repoList, activeRepo, setActiveRepo]);

	const repo = activeRepo;

	// Fetch repo services (detect services from repo content) with multi-level caching
	const [services, setServices] = React.useState<DetectedServiceInfo[]>([]);
	const [servicesLoading, setServicesLoading] = React.useState(true);
	const [servicesError, setServicesError] = React.useState<string | null>(null);

	React.useEffect(() => {
		const repoUrl = `https://github.com/${owner}/${repoName}`;
		const activeBranch = repo?.default_branch || "";

		// Check in-memory cache first
		const cached = getDetectedRepoCache(repoUrl);
		if (cached?.services?.length !== undefined) {
			setServices(cached.services);
			setServicesLoading(false);
			setServicesError(null);
			return;
		}

		// Fallback to DB cache if available
		const record = repoServices.find(
			(r) => normalizeRepoUrlForMatch(r.repo_url) === normalizeRepoUrlForMatch(repoUrl)
		);
		if (record?.services?.length) {
			setServices(record.services);
			setServicesLoading(false);
			setServicesError(null);
			setDetectedRepoCache(repoUrl, {
				services: record.services,
				isMonorepo: record.is_monorepo ?? false,
				isMultiService: record.services.length > 1,
				packageManager: undefined,
			});
			return;
		}

		// Fetch from API if no cache available
		let cancelled = false;
		setServicesLoading(true);
		setServicesError(null);
		detectRepoServices(repoUrl, activeBranch)
			.then((data) => {
				if (cancelled) return;
				const list = data.services ?? [];
				setServices(list);
				setDetectedRepoCache(repoUrl, {
					services: list,
					isMonorepo: data.isMonorepo ?? false,
					isMultiService: data.isMultiService ?? false,
					packageManager: data.packageManager ?? undefined,
				});
				refetchRepoServices();
			})
			.catch((err) => {
				if (!cancelled) {
					setServicesError(err?.message ?? "Failed to load services");
					setServices([]);
				}
			})
			.finally(() => {
				if (!cancelled) setServicesLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [owner, repoName, repo, repoServices, getDetectedRepoCache, setDetectedRepoCache, refetchRepoServices]);

	const loading = servicesLoading;
	const error = servicesError;

	const activeService = React.useMemo<DetectedServiceInfo | null>(() => {
		if (!storeActiveService) return null;
		// "Deploy all on one instance" sets activeServiceName to "." — that row is not in detected services.
		if (storeActiveService === "." && services.length > 0) {
			return { name: ".", path: ".", language: "unknown" };
		}
		return services.find((svc: DetectedServiceInfo) => svc.name === storeActiveService) ?? null;
	}, [services, storeActiveService]);

	// Filter deployments for current repo
	const repoDeployments = React.useMemo(() => {
		if (!repo) return [];
		const norm = normalizeRepoUrl(`https://github.com/${owner}/${repoName}`);
		return deployments.filter(
			(d) =>
				d.repoName === repo.name || normalizeRepoUrl(d.url) === norm
		);
	}, [deployments, owner, repoName, repo]);

	// Fetch deployments and reset active service on repo change
	React.useEffect(() => {
		setActiveServiceName(null);
		if (repo?.name) {
			fetchRepoDeployments(repo.name);
		}
	}, [repo, fetchRepoDeployments, setActiveServiceName]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
		};
	}, [setActiveRepo, setActiveServiceName]);

	function openWorkspaceForService(svc: DetectedServiceInfo) {
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
				} catch (err: any) {
					toast.error(err?.message || `Failed to delete ${dep.serviceName}`);
				}
			}
			if (deletedKeys.length) {
				removeDeployments(deletedKeys);
				await refetchDeployments();
			}
			toast.success("Finished deleting deployments for this repo.");
		} finally {
			setIsDeleting(false);
		}
	}

	async function handleDeleteAllDeployments() {
		if (repoDeployments.length === 0) {
			toast.error("No deployments found for this repo.");
			return;
		}
		setShowDeleteAllConfirm(true);
	}

	return (
		<div className="dot-grid-bg min-h-svh flex flex-col text-foreground">
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
						<a
							href="/"
							className="inline-block mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
						>
							Go Back Home
						</a>
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

					<main className="flex-1 min-h-0 overflow-auto p-6">
						{activeService ? (
							<DeployWorkspace />
						) : (
							<RepoServicesList
								owner={owner}
								repoName={repoName}
								repoUrl={`https://github.com/${owner}/${repoName}`}
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
