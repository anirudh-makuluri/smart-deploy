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
import { toast } from "sonner";
import { AIGenProjectMetadata, DeployConfig, repoType } from "@/app/types";
import { parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { isEqual } from "lodash";

type DeployWorkspaceProps = {
	serviceName?: string;
	deploymentId?: string;
};

export default function DeployWorkspace({ serviceName, deploymentId }: DeployWorkspaceProps) {
	const { deployments, updateDeploymentById, repoList } = useAppData();
	const { data: session } = useSession();
	const deploymentFromId = deploymentId
		? deployments.find((dep) => dep.id === deploymentId)
		: undefined;
	const deploymentFromServiceName = serviceName
		? deployments.find((dep) => dep.service_name === serviceName)
		: undefined;
	const deployment = deploymentFromId ?? deploymentFromServiceName;

	const repo = React.useMemo(() => {
		if (!deployment) return undefined;
		return repoList.find((rep) => rep.id === deployment.id || rep.html_url === deployment.url);
	}, [repoList, deployment]);
	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = React.useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const [activeSection, setActiveSection] = React.useState<MenuSection>("overview");
	const [deploymentHistory, setDeploymentHistory] = React.useState<any[] | null>(null);
	const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
	const [editMode, setEditMode] = React.useState(false);

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
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
			upsertDeploymentAfterDeploy(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
		}
	}, [deployStatus, deployment?.id]);

	if (!repo && !deployment) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
				{<Header />}
				<p className="text-muted-foreground">Service not found</p>
			</div>
		);
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
	const resolvedDeploymentId = resolvedDeployment?.id ?? deploymentId ?? "";

	// Fetch deployment history once when page loads
	React.useEffect(() => {
		if (!resolvedDeploymentId || deploymentHistory !== null) return;
		
		setIsLoadingHistory(true);
		fetch(`/api/deployment-history?deploymentId=${encodeURIComponent(resolvedDeploymentId)}`)
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "success" && Array.isArray(data.history)) {
					setDeploymentHistory(data.history);
				}
			})
			.catch((err) => {
				console.error("Failed to fetch deployment history:", err);
			})
			.finally(() => setIsLoadingHistory(false));
	}, [resolvedDeploymentId, deploymentHistory]);

	// Refetch history after deployment completes
	React.useEffect(() => {
		if ((deployStatus === "success" || deployStatus === "error") && resolvedDeploymentId) {
			fetch(`/api/deployment-history?deploymentId=${encodeURIComponent(resolvedDeploymentId)}`)
				.then((res) => res.json())
				.then((data) => {
					if (data.status === "success" && Array.isArray(data.history)) {
						setDeploymentHistory(data.history);
					}
				})
				.catch((err) => {
					console.error("Failed to refetch deployment history:", err);
				});
		}
	}, [deployStatus, resolvedDeploymentId]);

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

	async function handleRedeploy(commitSha?: string) {
		if (!session?.accessToken || !resolvedDeployment) {
			return console.log("Unauthenticated or no deployment");
		}

		const payload: DeployConfig = {
			...resolvedDeployment,
			...(commitSha && { commitSha }),
		};

		const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
		const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
		const owner = resolvedRepo.owner?.login ?? ownerFromUrl;
		const repoName = resolvedRepo.name ?? repoNameFromUrl;

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
						setDeployingCommitInfo({
							sha: data.commit.sha,
							message: data.commit.message,
							author: data.commit.author,
							date: data.commit.date,
						});
					}
				})
				.catch((err) => {
					console.error("Failed to fetch commit info:", err);
				});
		}

		setIsDeploying(true);
		sendDeployConfig(payload, session?.accessToken, session?.userID);
		setActiveSection("logs");
	}

	async function onSubmit(
		values: FormSchemaType &
			Partial<AIGenProjectMetadata> & {
				deploymentTarget?: DeployConfig["deploymentTarget"];
				deployment_target_reason?: string;
				commitSha?: string;
			}
	) {
		setEditMode(false);

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
		const owner = resolvedRepo.owner?.login ?? ownerFromUrl;
		const repoName = resolvedRepo.name ?? repoNameFromUrl;
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

		switch (activeSection) {
			case "history":
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{resolvedDeployment && (
							<DeploymentHistory 
								deploymentId={resolvedDeployment.id} 
								prefetchedData={deploymentHistory} 
								isPrefetching={isLoadingHistory}
							/>
						)}
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
							isDeploying={isDeploying}
						/>
					</div>
				);
			case "overview":
			default:
				return (
					<div className="w-full mx-auto p-6 flex-1 max-w-6xl">
						{resolvedDeployment && (
							<DeployOverview 
								deployment={resolvedDeployment} 
								isDeploying={isDeploying}
								onRedeploy={handleRedeploy}
								onEditConfiguration={() => {setActiveSection("env"); setEditMode(true);}}
								repo={resolvedRepo}
							/>
						)}
					</div>
				);

		}
	}

	return (
		<div className="landing-bg min-h-svh flex flex-col text-foreground">
			<Header />
			<DeployWorkspaceMenu
				activeSection={activeSection}
				onChange={setActiveSection}
			/>
			{isDeploying && deployingCommitInfo && (
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
