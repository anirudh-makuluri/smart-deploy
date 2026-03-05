"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, AlertTriangle, Loader2 } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/store/useAppData";
import type { DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";
import NewDeploySheet from "@/components/NewDeploySheet";
import { getActiveDeployment } from "@/custom-hooks/useDeployLogs";
import { useActiveDeployment } from "@/components/ActiveDeploymentProvider";
import { toast } from "sonner";

type DetectedService = DetectedServiceInfo;

type RepoPageClientProps = {
	owner: string;
	repo: string;
};

function normalizeRepoUrl(url: string): string {
	return url.replace(/\.git$/, "").toLowerCase();
}

function buildMinimalRepo(owner: string, repoName: string): repoType {
	const fullName = `${owner}/${repoName}`;
	const htmlUrl = `https://github.com/${fullName}`;
	return {
		id: htmlUrl,
		name: repoName,
		full_name: fullName,
		html_url: htmlUrl,
		language: "",
		languages_url: "",
		created_at: "",
		updated_at: "",
		pushed_at: "",
		default_branch: "main",
		private: false,
		description: null,
		visibility: "public",
		license: null,
		forks_count: 0,
		watchers_count: 0,
		open_issues_count: 0,
		owner: { login: owner },
		latest_commit: null,
		branches: [{ name: "main", commit_sha: "", protected: false }],
	};
}

/** Deployment ID slug from repo URL (no slashes, for DB); e.g. owner-repo */
function repoSlugFromUrl(repoUrl: string): string {
	return repoUrl
		.replace(/\.git$/, "")
		.split("/")
		.filter(Boolean)
		.slice(-2)
		.join("-");
}

/** A service is deployed if there is a per-service deployment or a repo-level deployment. */
function getDeploymentForService(
	deployments: DeployConfig[],
	repoUrl: string,
	serviceName: string,
	repoName: string
): DeployConfig | undefined {
	const matches: DeployConfig[] = [];
	for (const d of deployments) {
		if (d.repo_name !== repoName && normalizeRepoUrl(d.url) !== normalizeRepoUrl(repoUrl)) continue;

		if (d.monorepo_services?.some((service) => service.name === serviceName)) {
			matches.push(d);
			continue;
		}

		const dbServiceName = d.service_name || "";
		const isExactHit = dbServiceName.toLowerCase() === serviceName.toLowerCase();
		const isRepoLevel = dbServiceName === "." || dbServiceName.toLowerCase() === repoName.toLowerCase();

		if (isExactHit || isRepoLevel) {
			matches.push(d);
		}
	}

	if (matches.length === 0) return undefined;

	const statusRank = (status?: string) => {
		if (status === "running") return 3;
		if (status === "paused" || status === "stopped") return 2;
		if (status === "didnt_deploy") return 1;
		return 0;
	};

	return matches.sort((a, b) => {
		const statusDelta = statusRank(b.status) - statusRank(a.status);
		if (statusDelta !== 0) return statusDelta;
		const aTime = new Date(a.last_deployment ?? 0).getTime();
		const bTime = new Date(b.last_deployment ?? 0).getTime();
		return bTime - aTime;
	})[0];
}

function normalizeRepoUrlForMatch(url: string): string {
	return url.replace(/\.git$/, "").toLowerCase();
}

export default function RepoPageClient({ owner, repo }: RepoPageClientProps) {
	const router = useRouter();
	const { repoList, deployments, repoServices, refetchAll, refetchRepoServices, getDetectedRepoCache, setDetectedRepoCache, removeDeployments, refetchDeployments } = useAppData();
	const [isDeleting, setIsDeleting] = React.useState(false);
	const [services, setServices] = React.useState<DetectedService[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = React.useState(false);
	/** When set, sheet is for this service (per-service deploy). When null, sheet is for deploy-all. */
	const [selectedService, setSelectedService] = React.useState<DetectedService | null>(null);

	const repoUrl = `https://github.com/${owner}/${repo}`;
	const minimalRepo = React.useMemo(() => buildMinimalRepo(owner, repo), [owner, repo]);
	const resolvedRepo = React.useMemo<repoType>(() => {
		const normalizedTarget = normalizeRepoUrlForMatch(repoUrl);
		const fromStore = repoList.find((r) => {
			const sameFullName = r.full_name?.toLowerCase() === `${owner}/${repo}`.toLowerCase();
			const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedTarget;
			return sameFullName || sameUrl;
		});
		return fromStore ?? minimalRepo;
	}, [repoList, repoUrl, owner, repo, minimalRepo]);
	const activeBranch = resolvedRepo.default_branch || resolvedRepo.branches?.[0]?.name || "main";
	const repoSlug = `${owner}-${repo}`;
	const { openLogsModal } = useActiveDeployment();
	const [activeDeploy, setActiveDeploy] = React.useState<{
		deploymentId: string;
		userID?: string;
	} | null>(() => {
		const a = getActiveDeployment();
		if (!a) return null;
		if (a.deploymentId === repoSlug || a.deploymentId.startsWith(`${repoSlug}-`)) return a;
		return null;
	});

	React.useEffect(() => {
		const tick = () => {
			const a = getActiveDeployment();
			if (!a) {
				setActiveDeploy(null);
				return;
			}
			if (a.deploymentId === repoSlug || a.deploymentId.startsWith(`${repoSlug}-`)) {
				setActiveDeploy(a);
			} else {
				setActiveDeploy(null);
			}
		};
		tick();
		const id = setInterval(tick, 2000);
		return () => clearInterval(id);
	}, [repoSlug]);

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
		fetch("/api/repos/detect-services", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: repoUrl, branch: activeBranch }),
		})
			.then((res) => res.json())
			.then((data) => {
				if (cancelled) return;
				if (data.error) {
					setError(data.error);
					setServices([]);
					return;
				}
				const list = data.services ?? [];
				setServices(list);
				setDetectedRepoCache(repoUrl, {
					services: list,
					isMonorepo: data.isMonorepo ?? false,
					isMultiService: data.isMultiService ?? false,
					packageManager: data.packageManager,
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

	function openSheetForService(svc: DetectedService) {
		setSelectedService(svc);
		setSheetOpen(true);
	}

	function openSheetForAll() {
		setSelectedService(null);
		setSheetOpen(true);
	}

	function closeSheet() {
		setSheetOpen(false);
		setSelectedService(null);
		refetchAll();
	}

	async function handleDeleteAllDeployments() {
		if (repoDeployments.length === 0) return;
		if (!window.confirm("Delete all deployments for this repository? This cannot be undone.")) return;
		setIsDeleting(true);
		const deletedIds: string[] = [];
		try {
			for (const dep of repoDeployments) {
				try {
					const res = await fetch("/api/delete-deployment", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							deploymentId: dep.id,
							serviceName: dep.service_name,
						}),
					});
					const data = await res.json();
					if (data.status === "success") {
						deletedIds.push(dep.id);
					} else {
						toast.error(data.error || data.details || `Failed to delete ${dep.service_name}`);
					}
				} catch (err: any) {
					toast.error(err?.message || `Failed to delete ${dep.service_name}`);
				}
			}
			if (deletedIds.length) {
				removeDeployments(deletedIds);
				await refetchDeployments();
			}
			toast.success("Finished deleting deployments for this repo.");
		} finally {
			setIsDeleting(false);
		}
	}

	return (
		<div className="dot-grid-bg min-h-svh flex flex-col text-foreground">
			{isDeleting && (
				<div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
					<span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
					<span className="text-sm font-medium text-foreground">Deleting deployments…</span>
				</div>
			)}
			<header className="shrink-0 border-b border-border bg-background/90">
				<div className="px-6 py-3 flex flex-row justify-between items-center">
					<SmartDeployLogo href="/home" showText size="md" />
					<div className="flex items-center gap-2">
						<Link href="/home">
							<Button variant="outline" size="sm">
								Dashboard
							</Button>
						</Link>
					</div>
				</div>
			</header>

			<main className="flex-1 min-h-0 overflow-auto p-6">
				{activeDeploy && (
					<button
						type="button"
						onClick={() => openLogsModal(activeDeploy.deploymentId, activeDeploy.userID)}
						className="mb-4 flex w-full cursor-pointer items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 py-3 px-4 text-left text-sm font-medium text-foreground transition-colors hover:bg-primary/15"
					>
						<Loader2 className="size-4 shrink-0 animate-spin text-primary" />
						<span>A deployment is in progress for this repo.</span>
						<span className="text-primary">Click to view logs</span>
					</button>
				)}
				<div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div>
						<h1 className="text-xl font-semibold text-foreground">
							{owner} / {repo}
						</h1>
						<p className="text-sm text-muted-foreground mt-0.5">
							{services.length} service{services.length !== 1 ? "s" : ""}
						</p>
					</div>
					{!loading && !error && services.length > 0 && (
						<div className="flex items-center gap-2">
							<Button onClick={openSheetForAll} className="shrink-0">
								Deploy all on one instance
							</Button>
							{repoDeployments.length > 0 && (
								<Button
									variant="outline"
									size="sm"
									onClick={handleDeleteAllDeployments}
								>
									Delete all deployments
								</Button>
							)}
						</div>
					)}
				</div>

				{loading && (
					<div className="text-muted-foreground py-8 text-center">Loading services…</div>
				)}
				{error && (
					<div className="rounded-xl border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3">
						{error}
					</div>
				)}
				{!loading && !error && services.length === 0 && (
					<div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-muted-foreground">
						No deployable services detected. Add a service or check the repository structure.
					</div>
				)}
				{!loading && !error && services.length > 0 && (
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
						{services.map((svc) => {
							const deployment = getDeploymentForService(
								repoDeployments,
								repoUrl,
								svc.name,
								resolvedRepo.name
							);
							const status = deployment?.status;
							const isOnline = status === "running";
							const isDraft = (status === "didnt_deploy") || !deployment;
							const isFailed = status === "failed";
							const canNavigateToService = !!deployment && !isDraft;

							const handleCardClick = () => {
								if (canNavigateToService) {
									router.push(`/services/${encodeURIComponent(deployment!.service_name)}?deploymentId=${encodeURIComponent(deployment!.id)}`);
								} else {
									openSheetForService(svc);
								}
							};

							return (
								<button
									key={svc.name}
									type="button"
									onClick={handleCardClick}
									className={`hover:cursor-pointer rounded-xl border p-4 text-left bg-card hover:border-primary/40 transition-colors ${isFailed ? "border-destructive/60" : "border-border"
										}`}
								>
									<div className="flex items-center gap-3">
										<Github className="size-6 shrink-0 text-muted-foreground" />
										<span className="font-semibold text-foreground truncate">
											@{repo}/{svc.name}
										</span>
									</div>
									<div className="mt-3 flex items-center gap-2">
										{isDraft && (
											<span className="text-sm text-muted-foreground">
												Draft (Not deployed)
											</span>
										)}
										{isFailed && (
											<>
												<span className="text-sm text-destructive flex items-center gap-1">
													Failed
												</span>
												<span className="flex items-center gap-0.5 text-destructive/80">
													<AlertTriangle className="size-4" />
												</span>
											</>
										)}
										{isOnline && (
											<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
												<span className="size-2 rounded-full bg-green-500" />
												Online
											</span>
										)}
									</div>
								</button>
							);
						})}
					</div>
				)}
			</main>

			{sheetOpen && (
				<NewDeploySheet
					open={sheetOpen}
					onClose={closeSheet}
					repo={resolvedRepo}
					selectedService={selectedService ?? undefined}
				/>
			)}
		</div>
	);
}
