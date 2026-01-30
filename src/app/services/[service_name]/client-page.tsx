"use client";

import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { formatTimestamp, formatDeploymentTargetName, parseEnvVarsToStore, readDockerfile } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { useState } from "react";
import * as React from "react";
import { z } from "zod";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { isEqual } from "lodash";

import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { AIGenProjectMetadata, DeployConfig, DeploymentTarget } from "@/app/types";
import ConfigTabs, { formSchema, FormSchemaType } from "@/components/ConfigTabs";
import { ExternalLink, Calendar, Hash } from "lucide-react";

export default function Page({ service_name }: { service_name: string }) {
	const { deployments, updateDeploymentById, removeDeployment, repoList } = useAppData();
	const router = useRouter();
	const searchParams = useSearchParams();
	const new_change = searchParams.get("new-change");

	const { steps, sendDeployConfig, deployStatus, deployConfigRef, serviceLogs } = useDeployLogs(service_name);
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();

	const [editMode, setEditMode] = useState(false);
	const [newChanges, setNewChanges] = useState(new_change ?? false);
	const [dockerfile, setDockerfile] = useState<File | null>(null);

	const deployment = deployments.find((dep) => dep.service_name == service_name);
	const repo = repoList.find((rep) => rep.id == deployment?.id);

	const [dockerfileContent, setDockerfileContent] = useState<string | undefined>(deployment?.dockerfileContent);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			setIsDeploying(false);
			updateDeployment(deployConfigRef.current);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
		}
	}, [deployStatus]);

	React.useEffect(() => {
		if (!dockerfile) return;
		readDockerfile(dockerfile).then((res) => setDockerfileContent(res));
	}, [dockerfile]);

	if (!deployment || !repo)
		return (
			<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-[#e2e8f0]">
				<Header />
				<p className="text-[#94a3b8]">Service not found</p>
			</div>
		);

	async function onSubmit(values: FormSchemaType & Partial<AIGenProjectMetadata>) {
		setEditMode(false);

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars);
		}

		if (deployment?.id) {
			const newDeployment = { ...deployment, ...values };
			updateDeployment(newDeployment);
		} else {
			console.log("Could not update");
		}
	}

	async function updateDeployment(newDeployment: DeployConfig) {
		if (!deployment || isEqual(deployment, newDeployment)) return;

		newDeployment.last_deployment = new Date().toISOString();
		newDeployment.revision = newDeployment.revision ? newDeployment.revision + 1 : 2;
		await updateDeploymentById(newDeployment);
		setNewChanges(true);
		if (newDeployment.service_name != deployment.service_name) {
			router.replace(`/services/${newDeployment.service_name}?new-change=true`);
		}

		if (newDeployment.status == "stopped") {
			router.replace("/");
		}
	}

	async function onScanComplete(
		data: FormSchemaType & Partial<AIGenProjectMetadata> & {
			deploymentTarget?: DeployConfig["deploymentTarget"];
			deployment_target_reason?: string;
		}
	) {
		if (!deployment) return;
		const merged: DeployConfig = {
			...deployment,
			install_cmd: data.install_cmd ?? deployment.install_cmd,
			build_cmd: data.build_cmd ?? deployment.build_cmd,
			run_cmd: data.run_cmd ?? deployment.run_cmd,
			workdir: data.workdir ?? deployment.workdir,
			core_deployment_info: data.core_deployment_info ?? deployment.core_deployment_info,
			features_infrastructure: data.features_infrastructure ?? deployment.features_infrastructure,
			final_notes: data.final_notes ?? deployment.final_notes,
			deploymentTarget: data.deploymentTarget ?? deployment.deploymentTarget,
			deployment_target_reason: data.deployment_target_reason ?? deployment.deployment_target_reason,
		};
		await updateDeployment(merged);
	}

	function handleRedeploy() {
		if (!session?.accessToken) {
			return console.log("Unauthorized");
		}

		if (!deployment) return;

		setIsDeploying(true);
		setNewChanges(false);

		if (deployment.env_vars) {
			deployment.env_vars = parseEnvVarsToStore(deployment.env_vars);
		}

		sendDeployConfig(deployment, session?.accessToken);
	}

	function handleDeploymentControl(action: string) {
		if (!deployment) return;

		// Stop = full delete: remove Cloud Run service and DB record (no traces left)
		if (action === "stop") {
			fetch("/api/delete-deployment", {
				method: "POST",
				body: JSON.stringify({
					deploymentId: deployment.id,
					serviceName: deployment.service_name,
				}),
				headers: { "Content-Type": "application/json" },
			})
				.then((res) => res.json())
				.then((response) => {
					if (response.status === "success") {
						removeDeployment(deployment.id);
						router.replace("/");
					}
				});
			return;
		}

		fetch("/api/deployment-control", {
			method: "PUT",
			body: JSON.stringify({ action, serviceName: service_name, id: deployment.id }),
			headers: { "Content-Type": "application/json" },
		})
			.then((res) => res.json())
			.then((response) => {
				if (response.status == "success") {
					const newStatus: "running" | "paused" = action === "resume" ? "running" : "paused";
					const newDeployment: DeployConfig = { ...deployment, status: newStatus };
					updateDeployment(newDeployment);
				}
			});
	}

	return (
		<div className="landing-bg min-h-svh flex flex-col text-[#e2e8f0]">
			<Header />
			<div className="flex flex-1 min-h-0">
				{/* Sidebar */}
				<aside className="flex-shrink-0 w-80 border-r border-[#1e3a5f]/60 bg-[#132f4c]/40 p-6 flex flex-col gap-6">
					<div>
						<p className="text-[#94a3b8] text-xs uppercase tracking-wider font-medium mb-1">Service Overview</p>
						<p className="font-semibold text-xl text-[#e2e8f0]">{deployment.service_name}</p>
						<span className="inline-flex mt-2 px-2 py-0.5 rounded text-xs font-medium bg-[#14b8a6]/20 text-[#14b8a6] border border-[#14b8a6]/40">
							{deployment.status}
						</span>
					</div>
					{(deployment["deployed-service"] || deployment.deploymentTarget) && (
						<div>
							<p className="text-[#94a3b8] text-xs mb-1">Deployed Service</p>
							<p className="text-sm font-medium text-[#e2e8f0]">
								{formatDeploymentTargetName(deployment["deployed-service"] || deployment.deploymentTarget)}
							</p>
						</div>
					)}
					{deployment.deployUrl && (
						<div>
							<p className="text-[#94a3b8] text-xs mb-1">Live URL</p>
							<a
								href={deployment.deployUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1.5 text-sm text-[#14b8a6] hover:underline truncate"
							>
								<ExternalLink className="size-4 shrink-0" />
								<span className="truncate">{deployment.deployUrl}</span>
							</a>
						</div>
					)}
					<div className="flex items-center gap-2 text-sm text-[#94a3b8]">
						<Calendar className="size-4" />
						Last deployed: {formatTimestamp(deployment.last_deployment)}
					</div>
					<div className="flex items-center gap-2 text-sm text-[#94a3b8]">
						<Hash className="size-4" />
						Revision: {deployment.revision ?? 1}
					</div>
					<div className="pt-4 border-t border-[#1e3a5f]/60">
						<p className="font-semibold text-[#e2e8f0] mb-4">Actions</p>
						<div className="flex flex-col gap-3">
							<Button
								onClick={handleRedeploy}
								className={
									newChanges
										? "landing-build-blue hover:opacity-95 text-white"
										: "border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50"
								}
								disabled={isDeploying}
							>
								{isDeploying ? "Redeploying…" : deployStatus == "success" ? "Deployment success!" : "Redeploy"}
							</Button>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button className="hidden" variant="outline">
										{deployment.status == "running" ? "Pause" : "Resume"}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent className="border-[#1e3a5f] bg-[#132f4c] text-[#e2e8f0]">
									<AlertDialogHeader>
										<AlertDialogTitle>Are you sure?</AlertDialogTitle>
										<AlertDialogDescription className="text-[#94a3b8]">
											This action will prevent you from accessing the website until you resume it.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50">
											Cancel
										</AlertDialogCancel>
										<AlertDialogAction
											className="landing-build-blue text-white"
											onClick={() => handleDeploymentControl(deployment.status == "running" ? "pause" : "resume")}
										>
											Continue
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button className="bg-[#dc2626]/90 hover:bg-[#dc2626] text-white border-0">Stop / Delete</Button>
								</AlertDialogTrigger>
								<AlertDialogContent className="border-[#1e3a5f] bg-[#132f4c] text-[#e2e8f0]">
									<AlertDialogHeader>
										<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
										<AlertDialogDescription className="text-[#94a3b8]">
											This action cannot be undone. This will permanently delete your service and remove service data from our servers.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50">
											Cancel
										</AlertDialogCancel>
										<AlertDialogAction
											className="bg-[#dc2626] text-white hover:bg-[#dc2626]/90"
											onClick={() => handleDeploymentControl("stop")}
										>
											Continue
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<Button
								onClick={() => setEditMode((prev) => !prev)}
								variant={editMode ? "destructive" : "default"}
								className={editMode ? "bg-[#dc2626]/90 hover:bg-[#dc2626]" : "landing-build-blue hover:opacity-95 text-white"}
							>
								{editMode ? "Cancel changes" : "Edit config"}
							</Button>
						</div>
					</div>
				</aside>
				{/* Main */}
				<div className="flex-1 min-h-0 overflow-y-auto py-6 px-8 lg:px-12">
					<ConfigTabs
						editMode={editMode}
						onSubmit={onSubmit}
						onScanComplete={onScanComplete}
						service_name={service_name}
						repo={repo}
						deployment={deployment}
						id={deployment.id}
						isDeploying={isDeploying}
						serviceLogs={serviceLogs}
						steps={steps}
					/>
				</div>
			</div>
		</div>
	);
}
