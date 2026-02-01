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
import { configSnapshotFromDeployConfig } from "@/lib/utils";


export default function Page({ params }: { params: Promise<{ id: string, username: string, reponame: string }> }) {
	const { id, username, reponame } = use(params)
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();
	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const { repoList, deployments, updateDeploymentById } = useAppData();
	const [repo, setRepo] = useState<repoType | undefined>(
		repoList.find(rep => rep.full_name == `${username}/${reponame}`)
	);
	const [isLoadingRepo, setIsLoadingRepo] = useState(false);
	// Use existing deployment (e.g. from a previous Smart Project Scan) to pre-fill form and metadata
	const existingDeployment = deployments.find((dep) => dep.id === id);
	const shouldRecordHistoryRef = React.useRef(false);
	const [historyRefreshKey, setHistoryRefreshKey] = React.useState(0);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			addDeployment(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
		}
		// Record deployment history once when deploy completes (success or failure)
		if (shouldRecordHistoryRef.current && (deployStatus === "success" || deployStatus === "error") && deployConfigRef.current) {
			shouldRecordHistoryRef.current = false;
			const config = deployConfigRef.current;
			console.log("config", config);
			const recordHistory = () =>
				fetch("/api/deployment-history", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						deploymentId: id,
						success: deployStatus === "success",
						steps: steps ?? [],
						configSnapshot: configSnapshotFromDeployConfig(config),
						deployUrl: config.deployUrl ?? "",
					}),
				})
					.then((res) => res.json().then((data) => ({ ok: res.ok, data })))
					.then(({ ok, data }) => {
						if (ok && data?.status === "success") setHistoryRefreshKey((k) => k + 1);
						else if (!ok) console.error("Deployment history failed:", data?.message ?? data);
					})
					.catch((err) => console.error("Failed to save deployment history", err));

			// Ensure deployment doc exists before recording history (e.g. failed first deploy from repo page)
			const minimalDeployment: DeployConfig = {
				id,
				url: config.url ?? repo?.html_url ?? "",
				service_name: config.service_name ?? repo?.name ?? "app",
				branch: config.branch ?? repo?.default_branch ?? "main",
				use_custom_dockerfile: config.use_custom_dockerfile ?? false,
				status: deployStatus === "success" ? "running" : "didnt_deploy",
			};
			fetch("/api/update-deployments", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(minimalDeployment),
			})
				.then((res) => res.json())
				.then((data) => {
					if (data?.status === "success") {
						updateDeploymentById(minimalDeployment);
						recordHistory();
					} else {
						// Deployment doc may already exist (e.g. from Smart Project Scan); try recording
						recordHistory();
					}
				})
				.catch((err) => {
					console.error("Failed to ensure deployment doc:", err);
					recordHistory();
				});
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
		console.log("On Scan Complete", data);
		console.log("Session", session);
		console.log("Repo", repo);
		if (!session?.user || !repo) return;

		console.log("Data", data);
		const scanConfig: DeployConfig = {
			...existingDeployment,
			id,
			url: data.url || repo.html_url,
			service_name: data.service_name || repo.name,
			branch: data.branch || repo.default_branch || "main",
			install_cmd: data.install_cmd,
			build_cmd: data.build_cmd,
			run_cmd: data.run_cmd,
			workdir: data.workdir,
			use_custom_dockerfile: data.use_custom_dockerfile ?? false,
			env_vars: data.env_vars,
			// Preserve existing status (e.g. "running") when updating after Smart Project Scan
			status: existingDeployment?.status ?? "didnt_deploy",
			core_deployment_info: data.core_deployment_info,
			features_infrastructure: data.features_infrastructure,
			final_notes: data.final_notes,
			deploymentTarget: (data as DeployConfig).deploymentTarget,
			deployment_target_reason: (data as DeployConfig).deployment_target_reason,
		};
		await updateDeploymentById(scanConfig);
		toast.success("Scan saved to configuration");
	}

	function onSubmit(values: FormSchemaType & Partial<AIGenProjectMetadata>) {
		if (!session?.accessToken) {
			return console.log("Unauthenticated")
		}

		console.log("Values", values);

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}


		const payload: DeployConfig = {
			id,
			...values,
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

		shouldRecordHistoryRef.current = true;
		setIsDeploying(true);
		sendDeployConfig(payload, session?.accessToken);

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
				<ConfigTabs editMode={true} onSubmit={onSubmit} onScanComplete={onScanComplete} repo={repo}
					deployment={existingDeployment} service_name={reponame} id={id} isDeploying={isDeploying} serviceLogs={[]} steps={steps} deployError={deployError} />
				{deployConfigRef.current?.deployUrl && (
					<div className="mt-4 rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/60 px-4 py-3 text-sm">
						Deployment successful:{" "}
						<Link className="text-[#14b8a6] hover:underline font-medium" href={deployConfigRef.current.deployUrl}>
							Open link
						</Link>
					</div>
				)}
				<div className="mt-8">
					<DeploymentHistory key={historyRefreshKey} deploymentId={id} />
				</div>
			</div>
		</div>
	);
}
