"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, AlertTriangle, Loader2 } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Button } from "@/components/ui/button";
import { useAppData } from "@/store/useAppData";
import type { DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";
import { toast } from "sonner";
import DeployWorkspace from "@/components/DeployWorkspace";
import Header from "@/components/Header";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import RepoServicesList from "@/components/RepoServicesList";
import { normalizeRepoUrl } from "@/lib/utils";

const normalizeRepoUrlForMatch = normalizeRepoUrl;

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

type RepoPageClientProps = {
	owner: string;
	repoName: string;
};


export default function RepoPageClient({ owner, repoName }: RepoPageClientProps) {
	const router = useRouter();
	const { repoList, deployments, repoServices, refetchAll, refetchRepoServices, getDetectedRepoCache, setDetectedRepoCache, removeDeployments, refetchDeployments, fetchRepoDeployments } = useAppData();
	const [isDeleting, setIsDeleting] = React.useState(false);
	const [services, setServices] = React.useState<DetectedServiceInfo[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [activeService, setActiveService] = React.useState<DetectedServiceInfo | null>(null);
	const [showDeleteAllConfirm, setShowDeleteAllConfirm] = React.useState(false);
	const { activeServiceName: storeActiveService, setActiveServiceName } = useAppData();

	const repoUrl = `https://github.com/${owner}/${repoName}`;
	const minimalRepo = React.useMemo(() => buildMinimalRepo(owner, repoName), [owner, repoName]);
	const resolvedRepo = React.useMemo<repoType>(() => {
		const normalizedTarget = normalizeRepoUrlForMatch(repoUrl);
		const fromStore = repoList.find((r) => {
			const sameFullName = r.full_name?.toLowerCase() === `${owner}/${repoName}`.toLowerCase();
			const sameUrl = normalizeRepoUrlForMatch(r.html_url) === normalizedTarget;
			return sameFullName || sameUrl;
		});
		return fromStore ?? minimalRepo;
	}, [repoList, repoUrl, owner, repoName, minimalRepo]);

	const activeBranch = resolvedRepo.default_branch || resolvedRepo.branches?.[0]?.name || "main";

	React.useEffect(() => {
		if (storeActiveService === null && activeService !== null) {
			setActiveService(null);
		}
	}, [storeActiveService, activeService]);

	React.useEffect(() => {
		setActiveServiceName(null);
	}, []);

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

	// Fetch deployments explicitly for this repo on mount if needed
	React.useEffect(() => {
		if (resolvedRepo.name) {
			fetchRepoDeployments(resolvedRepo.name);
		}
	}, [resolvedRepo.name, fetchRepoDeployments]);

	function openWorkspaceForService(svc: DetectedServiceInfo) {
		setActiveService(svc);
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
					const res = await fetch("/api/delete-deployment", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							repoName: dep.repo_name,
							serviceName: dep.service_name,
						}),
					});
					const data = await res.json();
					if (data.status === "success") {
						deletedKeys.push({ repoName: dep.repo_name, serviceName: dep.service_name });
					} else {
						toast.error(data.error || data.details || `Failed to delete ${dep.service_name}`);
					}
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
					<DeployWorkspace
						repoName={repoName}
						serviceName={activeService.name}
					/>
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
						setActiveService={setActiveService}
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
