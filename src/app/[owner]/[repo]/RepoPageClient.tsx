"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, AlertTriangle } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/store/useAppData";
import type { DeployConfig, repoType } from "@/app/types";
import NewDeploySheet from "@/components/NewDeploySheet";

type DetectedService = {
	name: string;
	path: string;
	language?: string;
	framework?: string;
	port?: number;
};

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

/** A service is deployed if there is a per-service deployment or a repo-level deployment. */
function getDeploymentForService(
	deployments: DeployConfig[],
	repoUrl: string,
	serviceName: string,
	repoName: string,
	repoId: string
): DeployConfig | undefined {
	const norm = normalizeRepoUrl(repoUrl);
	for (const d of deployments) {
		if (normalizeRepoUrl(d.url) !== norm) continue;
		if (d.monorepo_service_name === serviceName) return d;
		if (d.service_name === `${repoName}-${serviceName}`) return d;
		if (d.id === repoId) return d; // repo-level deployment covers all services
		if (d.service_name === repoName) return d;
	}
	return undefined;
}

function normalizeRepoUrlForMatch(url: string): string {
	return url.replace(/\.git$/, "").toLowerCase();
}

export default function RepoPageClient({ owner, repo }: RepoPageClientProps) {
	const router = useRouter();
	const { deployments, repoServices, refetchAll, refetchRepoServices, getDetectedRepoCache, setDetectedRepoCache } = useAppData();
	const [services, setServices] = React.useState<DetectedService[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [sheetOpen, setSheetOpen] = React.useState(false);
	/** When set, sheet is for this service (per-service deploy). When null, sheet is for deploy-all. */
	const [selectedService, setSelectedService] = React.useState<DetectedService | null>(null);

	const repoUrl = `https://github.com/${owner}/${repo}`;
	const minimalRepo = React.useMemo(() => buildMinimalRepo(owner, repo), [owner, repo]);

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
			body: JSON.stringify({ url: repoUrl, branch: "main" }),
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
	}, [repoUrl, repoServices, getDetectedRepoCache, setDetectedRepoCache, refetchRepoServices]);

	const repoDeployments = React.useMemo(() => {
		const norm = normalizeRepoUrl(repoUrl);
		return deployments.filter((d) => normalizeRepoUrl(d.url) === norm);
	}, [deployments, repoUrl]);

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

	return (
		<div className="dot-grid-bg min-h-svh flex flex-col text-foreground">
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
							<Button onClick={openSheetForAll} className="shrink-0">
								Deploy all on one instance
							</Button>
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
									repo,
									minimalRepo.id
								);
								const status = deployment?.status;
								const isOnline = status === "running";
								const isCrashed = status === "stopped" || status === "paused";
								const isNotDeployed = !deployment;

								const handleCardClick = () => {
									if (deployment) {
										router.push(`/services/${encodeURIComponent(deployment.service_name)}?deploymentId=${encodeURIComponent(deployment.id)}`);
									} else {
										openSheetForService(svc);
									}
								};

								return (
									<button
										key={svc.name}
										type="button"
										onClick={handleCardClick}
										className={`hover:cursor-pointer rounded-xl border p-4 text-left bg-card hover:border-primary/40 transition-colors ${
											isCrashed ? "border-destructive/60" : "border-border"
										}`}
									>
										<div className="flex items-center gap-3">
											<Github className="size-6 shrink-0 text-muted-foreground" />
											<span className="font-semibold text-foreground truncate">
												@{repo}/{svc.name}
											</span>
										</div>
										<div className="mt-3 flex items-center gap-2">
											{isNotDeployed && (
												<span className="text-sm text-muted-foreground">
													Not deployed
												</span>
											)}
											{isOnline && (
												<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
													<span className="size-2 rounded-full bg-green-500" />
													Online
												</span>
											)}
											{isCrashed && (
												<>
													<span className="text-sm text-destructive flex items-center gap-1">
														Crashed
													</span>
													<span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
														<AlertTriangle className="size-4" />
													</span>
												</>
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
					repo={minimalRepo}
					selectedServiceName={selectedService?.name ?? undefined}
					selectedServicePath={selectedService?.path ?? undefined}
				/>
			)}
		</div>
	);
}
