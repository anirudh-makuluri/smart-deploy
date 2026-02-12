"use client"

import * as React from "react"
import { z } from "zod"

import Header from "@/components/Header" // adjust based on your layout
import { use, useEffect, useState } from "react"
import Link from "next/link"
import { AIGenProjectMetadata, DeployConfig, repoType } from "@/app/types"
import { useSession } from "next-auth/react"
import { useDeployLogs } from "@/custom-hooks/useDeployLogs"
import { parseEnvVarsToStore } from "@/lib/utils"
import { useAppData } from "@/store/useAppData"
import { toast } from "sonner"
import ConfigTabs, { formSchema, FormSchemaType } from "@/components/ConfigTabs";
import DeploymentHistory from "@/components/DeploymentHistory";
import { configSnapshotFromDeployConfig, getDeploymentDisplayUrl, getDeploymentDnsTarget } from "@/lib/utils";


export default function Page({ params }: { params: Promise<{ id: string, username: string, reponame: string }> }) {
	const { id, username, reponame } = use(params)
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, vercelDnsStatus, vercelDnsError } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const [deployingCommitInfo, setDeployingCommitInfo] = useState<{ sha: string; message: string; author: string; date: string } | null>(null);
	const { data: session } = useSession();
	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const { repoList, deployments, updateDeploymentById } = useAppData();
	const [repo, setRepo] = useState<repoType | undefined>(
		repoList.find(rep => rep.full_name == `${username}/${reponame}`)
	);
	const [isLoadingRepo, setIsLoadingRepo] = useState(false);
	// Use existing deployment (e.g. from a previous Smart Project Scan) to pre-fill form and metadata
	const existingDeployment = deployments.find((dep) => dep.id === id);
	const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
			addDeployment(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
			setDeployingCommitInfo(null);
		}
		// Refresh history when deployment completes (backend handles saving)
		if ((deployStatus === "success" || deployStatus === "error")) {
			setHistoryRefreshKey((k) => k + 1);
		}
	}, [deployStatus, id, steps, repo]);

	// Fetch repo if not found in repoList (public repo)
	React.useEffect(() => {
		if (!repo && session?.accessToken) {
			setIsLoadingRepo(true);
			fetch("/api/repos/public", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner: username,
					repo: reponame,
				}),
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
	}, [repo, username, reponame, session?.accessToken]);

	if (isLoadingRepo) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-[#e2e8f0]">
				<Header />
				<div className="flex flex-col items-center gap-4">
					<div className="h-10 w-10 rounded-full border-2 border-[#1e3a5f] border-t-[#1d4ed8] animate-spin" />
					<p className="text-[#94a3b8]">Loading repository...</p>
				</div>
			</div>
		);
	}

	if (!repo) {
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-[#e2e8f0]">
				<Header />
				<p className="text-[#94a3b8]">Repo not found</p>
			</div>
		);
	}

	async function onScanComplete(data: FormSchemaType & Partial<AIGenProjectMetadata>) {

		if (!session?.user || !repo) return;

		const scanConfig: DeployConfig = {
			...existingDeployment,
			id,
			url: data.url || repo.html_url,
			service_name: data.service_name || repo.name,
			branch: data.branch || repo.default_branch || "main",
			use_custom_dockerfile: data.use_custom_dockerfile ?? false,
			env_vars: data.env_vars,
			// Preserve existing status (e.g. "running") when updating after Smart Project Scan
			status: existingDeployment?.status ?? "didnt_deploy",
			core_deployment_info: {
				...(data.core_deployment_info || existingDeployment?.core_deployment_info || {} as any),
				...(data.install_cmd != null && { install_cmd: data.install_cmd }),
				...(data.build_cmd != null && { build_cmd: data.build_cmd }),
				...(data.run_cmd != null && { run_cmd: data.run_cmd }),
				...(data.workdir != null && { workdir: data.workdir }),
			},
			features_infrastructure: data.features_infrastructure,
			final_notes: data.final_notes,
			deploymentTarget: (data as DeployConfig).deploymentTarget,
			deployment_target_reason: (data as DeployConfig).deployment_target_reason,
		};
		await updateDeploymentById(scanConfig);
		toast.success("Scan saved to configuration");
	}

	function onSubmit(
		values: FormSchemaType &
			Partial<AIGenProjectMetadata> & {
				deploymentTarget?: DeployConfig["deploymentTarget"];
				deployment_target_reason?: string;
				commitSha?: string;
			}
	) {
		if (!session?.accessToken) {
			return console.log("Unauthenticated")
		}


		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}


		// Build core_deployment_info by merging user-edited form fields into existing AI-scanned data
		const baseCoreInfo = values.core_deployment_info ?? existingDeployment?.core_deployment_info;
		const coreDeploymentInfo = baseCoreInfo
			? {
					...baseCoreInfo,
					...(values.install_cmd != null && { install_cmd: values.install_cmd }),
					...(values.run_cmd != null && { run_cmd: values.run_cmd }),
					...(values.workdir != null && { workdir: values.workdir || null }),
				}
			: undefined;

		const payload: DeployConfig = {
			id,
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
			// Preserve service details so redeploy can reuse/update/delete existing resources
			...(existingDeployment?.ec2 && { ec2: existingDeployment.ec2 }),
			...(existingDeployment?.ecs && { ecs: existingDeployment.ecs }),
			...(existingDeployment?.amplify && { amplify: existingDeployment.amplify }),
			...(existingDeployment?.elasticBeanstalk && { elasticBeanstalk: existingDeployment.elasticBeanstalk }),
		};

		if (values.use_custom_dockerfile) {
			if (dockerfile) {
				payload.dockerfile = dockerfile;
			} else {
				toast("Dockerfile not provided")
				return;
			}
		}

		console.log("Form Data", payload);

		// Fetch commit info for the branch (always fetch to show in deploy logs)
		if (repo) {
			// Derive owner/repo from URL when repo.owner is missing
			const ownerFromUrl = payload.url?.match(/github\.com[/]([^/]+)/)?.[1];
			const repoNameFromUrl = payload.url?.split("/").filter(Boolean).pop()?.replace(/\.git$/, "");
			const owner = repo.owner?.login ?? ownerFromUrl ?? username;
			const repoName = repo.name ?? repoNameFromUrl ?? reponame;

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
						// If deploying specific commit, verify it matches; otherwise use latest
						if (payload.commitSha && data.commit.sha === payload.commitSha) {
							setDeployingCommitInfo({
								sha: data.commit.sha,
								message: data.commit.message,
								author: data.commit.author,
								date: data.commit.date,
							});
						} else if (!payload.commitSha) {
							// Deploying from branch - use latest commit
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

	async function addDeployment(deployment: DeployConfig) {
		deployment.first_deployment = new Date().toISOString();
		deployment.last_deployment = new Date().toISOString();
		deployment.revision = 1
		await updateDeploymentById(deployment)
	}

	return (
		<div className="landing-bg min-h-svh flex flex-col text-[#e2e8f0]">
			<Header />
			<div className="w-full mx-auto p-6 flex-1 max-w-4xl">
				<ConfigTabs
					editMode={true}
					onSubmit={onSubmit}
					onScanComplete={onScanComplete}
					onConfigChange={(partial) => {
						const base = existingDeployment ?? {
							id,
							url: repo?.html_url ?? "",
							service_name: reponame,
							branch: repo?.default_branch ?? "main",
							use_custom_dockerfile: false,
							status: "didnt_deploy",
						};
						updateDeploymentById({ ...base, ...partial });
					}}
					repo={repo}
					deployment={existingDeployment ?? { id, url: repo?.html_url ?? "", service_name: reponame, branch: repo?.default_branch ?? "main", use_custom_dockerfile: false, status: "didnt_deploy" }}
					service_name={reponame}
					id={id}
					isDeploying={isDeploying}
					serviceLogs={[]}
					steps={steps}
					deployError={deployError}
					deployingCommitInfo={deployingCommitInfo}
				/>
				{isDeploying && deployingCommitInfo && (
					<div className="mt-4 rounded-lg border border-[#1d4ed8]/60 bg-[#1d4ed8]/10 px-4 py-3 text-sm space-y-2">
						<div className="font-semibold text-[#e2e8f0]">🚀 Deploying commit: {deployingCommitInfo.sha.substring(0, 7)}</div>
						<div className="text-[#94a3b8]">
							<div className="font-medium text-[#e2e8f0]">{deployingCommitInfo.message.split('\n')[0]}</div>
							<div className="text-xs mt-1">Author: {deployingCommitInfo.author} • {new Date(deployingCommitInfo.date).toLocaleString()}</div>
						</div>
					</div>
				)}
				{
					deployStatus === "success" && (
						<div className="mt-4 rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/60 px-4 py-3 text-sm space-y-1">
							<div>
								Deployment successful:{" "}
								<Link target="_blank" rel="noopener noreferrer" className="text-[#14b8a6] hover:underline font-medium" href={deployConfigRef.current?.custom_url ?? deployConfigRef.current?.deployUrl ?? ""}>
									Open link
								</Link>
							</div>
						</div>
					)
				}
				<div className="mt-8">
					<DeploymentHistory key={historyRefreshKey} deploymentId={id} />
				</div>
			</div>
		</div>
	);
}
