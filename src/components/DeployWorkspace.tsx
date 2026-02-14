"use client";

import * as React from "react";
import Header from "@/components/Header";
import ConfigTabs, { FormSchemaType } from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import DeployWorkspaceMenu, { MenuSection } from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployOverview from "@/components/deploy-workspace/DeployOverview";
import DeployLogsView, { DeployStatus } from "@/components/deploy-workspace/DeployLogsView";
 
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AIGenProjectMetadata, DeployConfig, repoType } from "@/app/types";
import { parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { isEqual } from "lodash";

type RepoParams = { id: string; username: string; reponame: string };

type DeployWorkspaceProps = {
	repoParams?: RepoParams;
	serviceName?: string;
	deploymentId?: string;
};

export default function DeployWorkspace({ repoParams, serviceName, deploymentId }: DeployWorkspaceProps) {
	const { deployments, updateDeploymentById, repoList } = useAppData();
	const router = useRouter();
	const { data: session } = useSession();
	const isRepoRoute = Boolean(repoParams);

	const deploymentFromRepoId = repoParams
		? deployments.find((dep) => dep.id === repoParams.id)
		: undefined;
	const deploymentFromId = deploymentId
		? deployments.find((dep) => dep.id === deploymentId)
		: undefined;
	const deploymentFromServiceName = serviceName
		? deployments.find((dep) => dep.service_name === serviceName)
		: undefined;
	const deployment = deploymentFromRepoId ?? deploymentFromId ?? deploymentFromServiceName;

	const repoFromList = isRepoRoute && repoParams
		? repoList.find((rep) => rep.full_name === `${repoParams.username}/${repoParams.reponame}`)
		: repoList.find((rep) => rep.id === deployment?.id);
	const [repo, setRepo] = React.useState<repoType | undefined>(repoFromList);
	const [isLoadingRepo, setIsLoadingRepo] = React.useState(false);
	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = React.useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0);
	const [editMode, setEditMode] = React.useState(!deployment || deployment.status === "didnt_deploy");
	const [activeSection, setActiveSection] = React.useState<MenuSection>("overview");

	const serviceNameForLogs = deployment?.service_name ?? repo?.name ?? serviceName;
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs } = useDeployLogs(serviceNameForLogs);
	const deployLogEntries = React.useMemo(() => {
		const entries: { timestamp?: string; message?: string }[] = [];
		steps.forEach((step) => {
			step.logs.forEach((log) => {
				const prefix = step.label ? `[${step.label}] ` : "";
				entries.push({ message: `${prefix}${log}` });
			});
		});
		return entries;
	}, [steps]);
	const showDeployLogs = (isDeploying || deployStatus === "running" || deployStatus === "error");
	const effectiveDeployStatus: DeployStatus = deployStatus === "not-started" ? "not-started" : 
		deployStatus === "running" ? "running" : 
		deployStatus === "success" ? "success" : 
		deployStatus === "error" ? "error" : "not-started";

	React.useEffect(() => {
		if (repoFromList && repoFromList !== repo) {
			setRepo(repoFromList);
		}
	}, [repoFromList, repo]);

	React.useEffect(() => {
		if (!isRepoRoute) return;
		if (!repo && session?.accessToken) {
			const ownerFromUrl = deployment?.url?.match(/github\.com[/]([^/]+)/)?.[1];
			const repoNameFromUrl = deployment?.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
			const owner = repoParams?.username ?? ownerFromUrl;
			const repoName = repoParams?.reponame ?? repoNameFromUrl;
			if (!owner || !repoName) return;

			setIsLoadingRepo(true);
			fetch("/api/repos/public", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ owner, repo: repoName }),
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.repo) {
						setRepo(data.repo);
					}
				})
				.catch((err) => {
					console.error("Failed to fetch repo:", err);
				})
				.finally(() => {
					setIsLoadingRepo(false);
				});
		}
	}, [isRepoRoute, repo, repoParams?.username, repoParams?.reponame, session?.accessToken, deployment?.url]);

	React.useEffect(() => {
		if (!isRepoRoute) return;
		if (!isLoadingRepo && !repo) {
			router.replace("/");
		}
	}, [isRepoRoute, isLoadingRepo, repo, router]);

	const hasDeployment = Boolean(deployment && deployment.status !== "didnt_deploy");
	const showMenu = isDeploying || deployStatus === "error" || hasDeployment;
	const showFullMenu = hasDeployment;
	const shouldShowHeader = showMenu;

	React.useEffect(() => {
		if (!showMenu) return;
		const allowed = showFullMenu ? ["overview", "env", "logs", "history"] : ["env", "logs"];
		if (!allowed.includes(activeSection)) {
			setActiveSection(showFullMenu ? "overview" : "logs");
		}
		if (isDeploying) {
			setActiveSection("logs");
		}
	}, [showMenu, showFullMenu, isDeploying, activeSection]);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
			upsertDeploymentAfterDeploy(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
		}
		if (deployStatus === "success" || deployStatus === "error") {
			setHistoryRefreshKey((k) => k + 1);
		}
	}, [deployStatus, deployment?.id]);

	React.useEffect(() => {
		if (hasDeployment) {
			setEditMode(false);
		} else {
			setEditMode(true);
		}
	}, [hasDeployment]);

	if (isRepoRoute && isLoadingRepo) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				{shouldShowHeader && <Header />}
				<div className="flex flex-col items-center gap-4">
					<div className="h-10 w-10 rounded-full border-2 border-border border-t-primary animate-spin" />
					<p className="text-muted-foreground">Loading repository...</p>
				</div>
			</div>
		);
	}

	if (!repo && !deployment) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				{shouldShowHeader && <Header />}
				<p className="text-muted-foreground">Service not found</p>
			</div>
		);
	}

	if (!repo) {
		if (isRepoRoute) {
			return null;
		}
	}

	const resolvedRepo: repoType = repo ?? (() => {
		const fallbackName = deployment?.service_name ?? serviceName ?? "service";
		const defaultBranch = deployment?.branch ?? "main";
		const url = deployment?.url ?? "";
		const ownerFromUrl = url.match(/github\.com[/]([^/]+)/)?.[1] ?? "unknown";
		const repoNameFromUrl = url.split("/").filter(Boolean).pop()?.replace(/\.git$/, "") ?? fallbackName;
		const fullName = `${ownerFromUrl}/${repoNameFromUrl}`;
		const now = new Date(0).toISOString();
		return {
			id: deployment?.id ?? "",
			name: repoNameFromUrl,
			full_name: fullName,
			html_url: url,
			language: "",
			languages_url: "",
			created_at: now,
			updated_at: now,
			pushed_at: now,
			default_branch: defaultBranch,
			private: false,
			description: null,
			visibility: "public",
			license: null,
			forks_count: 0,
			watchers_count: 0,
			open_issues_count: 0,
			owner: { login: ownerFromUrl },
			latest_commit: null,
			branches: [
				{ name: defaultBranch, commit_sha: deployment?.commitSha ?? "", protected: false },
			],
		};
	})();
	const resolvedDeployment = deployment as DeployConfig | undefined;
	const resolvedDeploymentId = resolvedDeployment?.id ?? deploymentId ?? repoParams?.id ?? "";

	async function upsertDeploymentAfterDeploy(config: DeployConfig) {
		const now = new Date().toISOString();
		const next: DeployConfig = {
			...config,
			first_deployment: deployment?.first_deployment ?? now,
			last_deployment: now,
			revision: deployment?.revision ? deployment.revision + 1 : 1,
		};
		await updateDeploymentById(next);
	}

	async function onScanComplete(data: FormSchemaType & Partial<AIGenProjectMetadata>) {
		if (!session?.user) return;

		const base: DeployConfig = resolvedDeployment ?? {
			id: resolvedDeploymentId,
			url: data.url || resolvedRepo.html_url,
			service_name: data.service_name || resolvedRepo.name,
			branch: data.branch || resolvedRepo.default_branch || "main",
			use_custom_dockerfile: data.use_custom_dockerfile ?? false,
			status: "didnt_deploy",
		};

		const scanConfig: DeployConfig = {
			...base,
			url: data.url || base.url,
			service_name: data.service_name || base.service_name,
			branch: data.branch || base.branch,
			use_custom_dockerfile: data.use_custom_dockerfile ?? base.use_custom_dockerfile,
			env_vars: data.env_vars,
			status: resolvedDeployment?.status ?? base.status,
			core_deployment_info: {
				...(data.core_deployment_info || resolvedDeployment?.core_deployment_info || ({} as any)),
				...(data.install_cmd != null && { install_cmd: data.install_cmd }),
				...(data.build_cmd != null && { build_cmd: data.build_cmd }),
				...(data.run_cmd != null && { run_cmd: data.run_cmd }),
				...(data.workdir != null && { workdir: data.workdir }),
			},
			features_infrastructure: data.features_infrastructure ?? resolvedDeployment?.features_infrastructure,
			final_notes: data.final_notes ?? resolvedDeployment?.final_notes,
			deploymentTarget: (data as DeployConfig).deploymentTarget ?? resolvedDeployment?.deploymentTarget,
			deployment_target_reason: (data as DeployConfig).deployment_target_reason ?? resolvedDeployment?.deployment_target_reason,
		};

		await updateDeploymentById(scanConfig);
		toast.success("Scan saved to configuration");
	}

	async function onSubmit(
		values: FormSchemaType &
			Partial<AIGenProjectMetadata> & {
				deploymentTarget?: DeployConfig["deploymentTarget"];
				deployment_target_reason?: string;
				commitSha?: string;
			}
	) {
		if (!session?.accessToken) {
			return console.log("Unauthenticated");
		}

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars);
		}

		const hasExistingDeployment = Boolean(resolvedDeployment && resolvedDeployment.status !== "didnt_deploy");
		if (hasExistingDeployment && resolvedDeployment) {
			const updated: DeployConfig = { ...resolvedDeployment, ...values };
			if (!isEqual(updated, resolvedDeployment)) {
				updated.last_deployment = new Date().toISOString();
				updated.revision = updated.revision ? updated.revision + 1 : 2;
				await updateDeploymentById(updated);
			}
			return;
		}

		const baseCoreInfo = values.core_deployment_info ?? resolvedDeployment?.core_deployment_info;
		const coreDeploymentInfo = baseCoreInfo
			? {
					...baseCoreInfo,
					...(values.install_cmd != null && { install_cmd: values.install_cmd }),
					...(values.run_cmd != null && { run_cmd: values.run_cmd }),
					...(values.workdir != null && { workdir: values.workdir || null }),
				}
			: undefined;

		const payload: DeployConfig = {
			id: resolvedDeploymentId,
			url: values.url,
			service_name: values.service_name,
			branch: values.branch,
			use_custom_dockerfile: values.use_custom_dockerfile,
			env_vars: values.env_vars,
			...(values.commitSha && { commitSha: values.commitSha }),
			...(coreDeploymentInfo && { core_deployment_info: coreDeploymentInfo }),
			...(values.features_infrastructure && { features_infrastructure: values.features_infrastructure }),
			...(values.final_notes && { final_notes: values.final_notes }),
			...(values.deploymentTarget && { deploymentTarget: values.deploymentTarget }),
			...(values.deployment_target_reason && { deployment_target_reason: values.deployment_target_reason }),
			...(resolvedDeployment?.ec2 && { ec2: resolvedDeployment.ec2 }),
			...(resolvedDeployment?.ecs && { ecs: resolvedDeployment.ecs }),
			...(resolvedDeployment?.amplify && { amplify: resolvedDeployment.amplify }),
			...(resolvedDeployment?.elasticBeanstalk && { elasticBeanstalk: resolvedDeployment.elasticBeanstalk }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = resolvedRepo.owner?.login ?? ownerFromUrl ?? repoParams?.username;
		const repoName = resolvedRepo.name ?? repoNameFromUrl ?? repoParams?.reponame;
		if (owner && repoName) {
			fetch("/api/commits/latest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner,
					repo: repoName,
					branch: payload.branch,
				}),
			})
				.then((res) => res.json())
				.then((data) => {
					if (data.commit) {
						if (payload.commitSha && data.commit.sha === payload.commitSha) {
							setDeployingCommitInfo({
								sha: data.commit.sha,
								message: data.commit.message,
								author: data.commit.author,
								date: data.commit.date,
							});
						} else if (!payload.commitSha) {
							setDeployingCommitInfo({
								sha: data.commit.sha,
								message: data.commit.message,
								author: data.commit.author,
								date: data.commit.date,
							});
						}
					}
				})
				.catch((err) => {
					console.error("Failed to fetch commit info:", err);
				});
		}

		setIsDeploying(true);
		sendDeployConfig(payload, session?.accessToken, session?.userID);
	}

	function renderActiveSection() {
		if (!showMenu) {
			return (
				<div className="w-full mx-auto p-6 flex-1 max-w-4xl">
					<ConfigTabs
						editMode={true}
						onSubmit={onSubmit}
						onScanComplete={onScanComplete}
						onConfigChange={(partial) => {
							const base = resolvedDeployment ?? {
								id: resolvedDeploymentId,
								url: resolvedRepo.html_url ?? "",
								service_name: repoParams?.reponame ?? resolvedRepo.name,
								branch: resolvedRepo.default_branch ?? "main",
								use_custom_dockerfile: false,
								status: "didnt_deploy",
							};
							updateDeploymentById({ ...base, ...partial });
						}}
						repo={resolvedRepo}
						deployment={resolvedDeployment ?? { id: resolvedDeploymentId, url: resolvedRepo.html_url ?? "", service_name: repoParams?.reponame ?? resolvedRepo.name, branch: resolvedRepo.default_branch ?? "main", use_custom_dockerfile: false, status: "didnt_deploy" }}
						service_name={repoParams?.reponame ?? resolvedRepo.name}
						id={resolvedDeploymentId}
						isDeploying={isDeploying}
					/>
				</div>
			);
		}

		switch (activeSection) {
			case "overview":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{resolvedDeployment && <DeployOverview deployment={resolvedDeployment} />}
					</div>
				);
			case "history":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{resolvedDeployment && <DeploymentHistory key={historyRefreshKey} deploymentId={resolvedDeployment.id} />}
					</div>
				);
			case "logs":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<DeployLogsView
							showDeployLogs={showDeployLogs}
							deployLogEntries={deployLogEntries}
							serviceLogs={serviceLogs}
							deployStatus={effectiveDeployStatus}
							deployError={deployError}
							deployingCommitInfo={deployingCommitInfo}
						/>
					</div>
				);
			case "env":
			default:
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						<ConfigTabs
							editMode={editMode}
							onSubmit={onSubmit}
							onScanComplete={onScanComplete}
							onConfigChange={(partial) => {
								if (!resolvedDeployment) return;
								updateDeploymentById({ ...resolvedDeployment, ...partial });
							}}
							repo={resolvedRepo}
							deployment={resolvedDeployment}
							service_name={resolvedDeployment?.service_name ?? resolvedRepo.name}
							id={resolvedDeployment?.id ?? resolvedDeploymentId}
							isDeploying={isDeploying}
						/>
					</div>
				);
		}
	}

	return (
		<div className="landing-bg min-h-svh flex flex-col text-foreground">
			{shouldShowHeader && <Header />}
			<DeployWorkspaceMenu
				showMenu={showMenu}
				showFullMenu={showFullMenu}
				activeSection={activeSection}
				onChange={setActiveSection}
			/>
			{isDeploying && deployingCommitInfo && showMenu && (
				<div className="mx-auto mt-4 w-full max-w-6xl px-6">
					<div className="rounded-lg border border-border bg-card px-4 py-3 text-sm space-y-2">
						<div className="font-semibold text-foreground">Deploying commit: {deployingCommitInfo.sha.substring(0, 7)}</div>
						<div className="text-muted-foreground">
							<div className="font-medium text-foreground">{deployingCommitInfo.message.split("\n")[0]}</div>
							<div className="text-xs mt-1">Author: {deployingCommitInfo.author} - {new Date(deployingCommitInfo.date).toLocaleString()}</div>
						</div>
					</div>
				</div>
			)}
			{renderActiveSection()}
		</div>
	);
}
