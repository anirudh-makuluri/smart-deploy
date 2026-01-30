"use client"

import * as React from "react"
import { z } from "zod"

import Header from "@/components/Header" // adjust based on your layout
import { use, useEffect, useState } from "react"
import Link from "next/link"
import { AIGenProjectMetadata, DeployConfig } from "@/app/types"
import { useSession } from "next-auth/react"
import { useDeployLogs } from "@/custom-hooks/useDeployLogs"
import { parseEnvVarsToStore } from "@/lib/utils"
import { useAppData } from "@/store/useAppData"
import { toast } from "sonner"
import ConfigTabs, { formSchema, FormSchemaType } from "@/components/ConfigTabs"


export default function Page({ params }: { params: Promise<{ id: string, username: string, reponame: string }> }) {
	const { id, username, reponame } = use(params)
	const { steps, sendDeployConfig, deployConfigRef, deployStatus } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();
	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const { repoList, deployments, updateDeploymentById } = useAppData();
	const repo = repoList.find(rep => rep.full_name == `${username}/${reponame}`);
	// Use existing deployment (e.g. from a previous Smart Project Scan) to pre-fill form and metadata
	const existingDeployment = deployments.find((dep) => dep.id === id);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			addDeployment(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
		}
	}, [deployStatus]);

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
			<div className="w-full mx-auto p-6 flex-1">
				<ConfigTabs editMode={true} onSubmit={onSubmit} onScanComplete={onScanComplete} repo={repo}
					deployment={existingDeployment} service_name={reponame} id={id} isDeploying={isDeploying} serviceLogs={[]} steps={steps} />
				{deployConfigRef.current?.deployUrl && (
					<div className="mt-4 rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/60 px-4 py-3 text-sm">
						Deployment successful:{" "}
						<Link className="text-[#14b8a6] hover:underline font-medium" href={deployConfigRef.current.deployUrl}>
							Open link
						</Link>
					</div>
				)}
			</div>
		</div>
	);
}
