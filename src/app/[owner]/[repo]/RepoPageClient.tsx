"use client";

import * as React from "react";
import { useAppData } from "@/store/useAppData";
import type { DetectedServiceInfo, repoType } from "@/app/types";
import { resolveInitialRepoBranch } from "@/lib/repoBranch";
import { toast } from "sonner";
import DeployWorkspace from "@/components/DeployWorkspace";
import Header from "@/components/Header";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import RepoServicesList from "@/components/RepoServicesList";
import { deleteDeployment, detectRepoServices, resolveRepo } from "@/lib/graphqlClient";
import { normalizeRepoUrl } from "@/lib/utils";

const normalizeRepoUrlForMatch = normalizeRepoUrl;

function repoMatchesPage(r: repoType, owner: string, repoName: string, normalizedRepoTarget: string): boolean {
	const sameFullName = r.full_name?.toLowerCase() === `${owner}/${repoName}`.toLowerCase();
	const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedRepoTarget;
	return sameFullName || sameUrl;
}

function sortReposList(list: repoType[]): repoType[] {
	return [...list].sort((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});
}

function repoMetadataLooksComplete(r: repoType | undefined): boolean {
	return Boolean(r?.default_branch?.trim());
}

function buildMinimalRepo(owner: string, repoName: string): repoType {
	const normalizedOwner = owner.trim();
	const normalizedRepoName = repoName.trim();
	const fullName = `${normalizedOwner}/${normalizedRepoName}`;
	const htmlUrl = `https://github.com/${fullName}`;
	const nowIso = new Date().toISOString();
	return {
		id: htmlUrl,
		name: normalizedRepoName,
		full_name: fullName,
		html_url: htmlUrl,
		language: "Unknown",
		languages_url: `https://api.github.com/repos/${fullName}/languages`,
		created_at: nowIso,
		updated_at: nowIso,
		pushed_at: nowIso,
		default_branch: "",
		private: false,
		description: null,
		visibility: "public",
		license: null,
		forks_count: 0,
		watchers_count: 0,
		open_issues_count: 0,
		owner: { login: normalizedOwner },
		latest_commit: null,
		branches: [],
	};
}

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
	} = useAppData();

	const [isDeleting, setIsDeleting] = React.useState(false);
	const [services, setServices] = React.useState<DetectedServiceInfo[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [showDeleteAllConfirm, setShowDeleteAllConfirm] = React.useState(false);
	const prevRepoUrlRef = React.useRef<string | null>(null);

	const repoUrl = `https://github.com/${owner}/${repoName}`;
	const minimalRepo = React.useMemo(() => buildMinimalRepo(owner, repoName), [owner, repoName]);
	const normalizedRepoTarget = React.useMemo(() => normalizeRepoUrlForMatch(repoUrl), [repoUrl]);
	const fromStoreRepo = React.useMemo<repoType | undefined>(() => {
		return repoList.find((r) => {
			const sameFullName = r.full_name?.toLowerCase() === `${owner}/${repoName}`.toLowerCase();
			const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedRepoTarget;
			return sameFullName || sameUrl;
		});
	}, [repoList, owner, repoName, normalizedRepoTarget]);
	const resolvedRepo = React.useMemo<repoType>(() => {
		return fromStoreRepo ?? minimalRepo;
	}, [fromStoreRepo, minimalRepo]);
	const activeService = React.useMemo<DetectedServiceInfo | null>(() => {
		if (!storeActiveService) return null;
		// "Deploy all on one instance" sets activeServiceName to "." — that row is not in detected services.
		if (storeActiveService === "." && services.length > 0) {
			return { name: ".", path: ".", language: "unknown" };
		}
		return services.find((svc) => svc.name === storeActiveService) ?? null;
	}, [services, storeActiveService]);

	React.useEffect(() => {
		if (repoMetadataLooksComplete(fromStoreRepo)) return;

		let cancelled = false;
		void (async () => {
			try {
				const fetchedRepo = await resolveRepo(owner, repoName);
				if (cancelled) return;

				if (fetchedRepo) {
					useAppData.setState((state) => {
						const idx = state.repoList.findIndex((r) =>
							repoMatchesPage(r, owner, repoName, normalizedRepoTarget)
						);
						if (idx >= 0) {
							const next = [...state.repoList];
							next[idx] = fetchedRepo;
							return { repoList: sortReposList(next) };
						}
						return { repoList: sortReposList([...state.repoList, fetchedRepo]) };
					});
					return;
				}

				useAppData.setState((state) => {
					if (state.repoList.some((r) => repoMatchesPage(r, owner, repoName, normalizedRepoTarget))) {
						return state;
					}
					return { repoList: sortReposList([...state.repoList, minimalRepo]) };
				});
			} catch {
				if (cancelled) return;
				useAppData.setState((state) => {
					if (state.repoList.some((r) => repoMatchesPage(r, owner, repoName, normalizedRepoTarget))) {
						return state;
					}
					return { repoList: sortReposList([...state.repoList, minimalRepo]) };
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fromStoreRepo, owner, repoName, normalizedRepoTarget, minimalRepo]);

	const activeBranch = resolveInitialRepoBranch(resolvedRepo) || "";

	React.useEffect(() => {
		const cached = getDetectedRepoCache(repoUrl);
		if (cached?.services?.length !== undefined) {
			setServices(cached.services);
			setLoading(false);
			setError(null);
			return;
		}
		// Fallback: use repoServices from store (from DB) if we have a record for this repo
		const record = repoServices.find((r) => normalizeRepoUrlForMatch(r.repo_url) === normalizeRepoUrlForMatch(repoUrl));
		if (record?.services?.length) {
			setServices(record.services);
			setLoading(false);
			setError(null);
			setDetectedRepoCache(repoUrl, {
				services: record.services,
				isMonorepo: record.is_monorepo,
				isMultiService: record.services.length > 1,
				packageManager: undefined,
			});
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);
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
					setError(err?.message ?? "Failed to load services");
					setServices([]);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [repoUrl, activeBranch, repoServices, getDetectedRepoCache, setDetectedRepoCache, refetchRepoServices]);

	const repoDeployments = React.useMemo(() => {
		const norm = normalizeRepoUrl(repoUrl);
		return deployments.filter((d) => (d.status !== "didnt_deploy" && (d.repo_name === resolvedRepo.name || normalizeRepoUrl(d.url) === norm)));
	}, [deployments, repoUrl, resolvedRepo]);

	// Fetch deployments explicitly for this repo on mount if needed
	React.useEffect(() => {
		const prevRepoUrl = prevRepoUrlRef.current;
		const isRepoChange = prevRepoUrl !== null && prevRepoUrl !== repoUrl;
		prevRepoUrlRef.current = repoUrl;

		// Only reset active service when navigating to a different repo.
		if (isRepoChange) {
			setActiveServiceName(null);
		}

		setActiveRepo(resolvedRepo);
		if (resolvedRepo.name) {
			fetchRepoDeployments(resolvedRepo.name);
		}
	}, [repoUrl, resolvedRepo, fetchRepoDeployments, setActiveServiceName, setActiveRepo]);

	React.useEffect(() => {
		return () => {
			setActiveServiceName(null);
			setActiveRepo(null);
		};
	}, [setActiveRepo, setActiveServiceName]);

	function openWorkspaceForService(svc: DetectedServiceInfo) {
		setActiveRepo(resolvedRepo);
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
					await deleteDeployment(dep.repo_name, dep.service_name);
					deletedKeys.push({ repoName: dep.repo_name, serviceName: dep.service_name });
				} catch (err: any) {
					toast.error(err?.message || `Failed to delete ${dep.service_name}`);
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
						repoUrl={repoUrl}
						services={services}
						loading={loading}
						error={error}
						repoDeployments={repoDeployments}
						resolvedRepo={resolvedRepo}
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
		</div>
	);
}
