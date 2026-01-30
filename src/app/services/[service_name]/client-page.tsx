"use client"
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { formatTimestamp, parseEnvVarsToStore, readDockerfile } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { useState } from "react";
import * as React from "react"
import { z } from "zod"
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
} from "@/components/ui/alert-dialog"
import { isEqual } from 'lodash'

import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation'
import { AIGenProjectMetadata, DeployConfig } from "@/app/types";
import ConfigTabs, { formSchema, FormSchemaType } from "@/components/ConfigTabs";

export default function Page({ service_name }: { service_name: string }) {
	const { deployments, updateDeploymentById, repoList } = useAppData();
	const router = useRouter();
	const searchParams = useSearchParams();
	const new_change = searchParams.get('new-change')

	const { steps, sendDeployConfig, deployStatus, deployConfigRef, serviceLogs } = useDeployLogs(service_name);
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();

	const [editMode, setEditMode] = useState(false);
	const [newChanges, setNewChanges] = useState(new_change ?? false);
	const [dockerfile, setDockerfile] = useState<File | null>(null);

	const deployment = deployments.find((dep) => dep.service_name == service_name);
	const repo = repoList.find((rep) => rep.id == deployment?.id)

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
		readDockerfile(dockerfile)
			.then(res => setDockerfileContent(res))

	}, [dockerfile])

	if (!deployment || !repo) return (
		<div>Service Not Found</div>
	)

	async function onSubmit(values: FormSchemaType & Partial<AIGenProjectMetadata>) {
		setEditMode(false)

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}

		if (deployment?.id) {
			const newDeployment = { ...deployment, ...values }
			updateDeployment(newDeployment);
		} else {
			console.log("Could not update")
		}

	}

	async function updateDeployment(newDeployment: DeployConfig) {
		if (!deployment || isEqual(deployment, newDeployment)) return;


		newDeployment.last_deployment = new Date().toISOString();
		newDeployment.revision = newDeployment.revision ? newDeployment.revision + 1 : 2
		await updateDeploymentById(newDeployment)
		setNewChanges(true)
		if (newDeployment.service_name != deployment.service_name) {
			router.replace(`/services/${newDeployment.service_name}?new-change=true`)
		}

		if (newDeployment.status == 'stopped') {
			router.replace("/")
		}
	}

	async function onScanComplete(data: FormSchemaType & Partial<AIGenProjectMetadata> & { deploymentTarget?: DeployConfig["deploymentTarget"]; deployment_target_reason?: string }) {
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
			return console.log("Unauthorized")
		}

		if (!deployment) return;


		setIsDeploying(true);
		setNewChanges(false);

		if (deployment.env_vars) {
			deployment.env_vars = parseEnvVarsToStore(deployment.env_vars)
		}

		sendDeployConfig(deployment, session?.accessToken)
	}

	function handleDeploymentControl(action: string) {
		if (!deployment) return;


		console.log(action, service_name, deployment?.id)
		fetch('/api/deployment-control', {
			method: "PUT",
			body: JSON.stringify({ action, serviceName: service_name, id: deployment.id }),
			headers: {
				"Content-Type": "application/json",
			}
		}).then(res => res.json())
			.then(response => {
				if (response.status == "success") {
					let newStatus: "running" | "paused" | "stopped" | undefined;
					if (action == 'resume') {
						newStatus = 'running'
					} else if (action == 'pause') {
						newStatus = 'paused'
					} else {
						newStatus = 'stopped'
					}
					const newDeployment: DeployConfig = { ...deployment, status: newStatus }
					updateDeployment(newDeployment)
				}
			})

	}

	return (
		<>
			<Header />
			<div className="flex flex-row">
				<div id="Sidebar" className="w-1/4 h-full py-4 px-4">
					<p className="font-bold text-3xl mb-8">Service Overview</p>
					<p className="font-semibold text-xl mb-1">{deployment.service_name}</p>
					<p className="font-light text-xs text-slate-400 mb-4">{deployment.status}</p>
					<p className="text-sm text-slate-300 mb-4">Live URL:
						<a target="_blank" href={deployment.deployUrl} className="hover:underline"> {deployment.deployUrl}</a>
					</p>
					<p className="text-sm text-slate-300 mb-4">Last Deployed : {formatTimestamp(deployment.last_deployment)}</p>
					<p className="text-sm text-slate-300 mb-4">Revision : {deployment.revision ?? 1}</p>
					<p className="text-xl font-bold mb-6">Actions</p>
					<div className="flex flex-col space-y-4">
						<Button onClick={handleRedeploy} variant={newChanges ? "default" : "outline"}>
							{isDeploying ? "Redeploying" : deployStatus == "success" ? "Deployment Success!" : "Redeploy"}
						</Button>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button className="hidden"
									variant={'outline'}>
									{deployment.status == 'running' ? "Pause" : "Resume"}
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Are you sure?</AlertDialogTitle>
									<AlertDialogDescription>
										This action will prevent you from accessing the website until you resume it
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction onClick={() => handleDeploymentControl(deployment.status == 'running' ? "pause" : "resume")}>Continue</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button
									variant={'destructive'}>
									Stop/Delete
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
									<AlertDialogDescription>
										This action cannot be undone. This will permanently delete your service and remove service data from our servers.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Cancel</AlertDialogCancel>
									<AlertDialogAction variant="destructive" onClick={() => handleDeploymentControl("stop")}>Continue</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
						<Button onClick={() => { setEditMode(prev => !prev) }} variant={editMode ? 'destructive' : 'default'}>
							{editMode ? "Cancel Changes" : "Edit Config"}
						</Button>
					</div>
				</div>
				<div id="main" className="w-3/4 h-full py-4 px-24">
					<ConfigTabs editMode={editMode} onSubmit={onSubmit} onScanComplete={onScanComplete} service_name={service_name} repo={repo} deployment={deployment}
					id={deployment.id} isDeploying={isDeploying} serviceLogs={serviceLogs} steps={steps}/>					
				</div>

			</div>

		</>
	)
}