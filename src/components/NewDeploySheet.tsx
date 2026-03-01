"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import type { AIGenProjectMetadata, DeployConfig, repoType } from "@/app/types";
import { Button } from "@/components/ui/button";
import ConfigTabs, { FormSchemaType } from "@/components/ConfigTabs";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";

const ANIMATION_MS = 300;

type NewDeploySheetProps = {
	open: boolean;
	onClose: () => void;
	repo: repoType;
	/** When set, deploy only this service from a monorepo (e.g. "web", "backend"). */
	selectedServiceName?: string | null;
	/** Relative path for the service (e.g. "apps/web") for workdir prefill. */
	selectedServicePath?: string | null;
};

export default function NewDeploySheet({ open, onClose, repo, selectedServiceName, selectedServicePath }: NewDeploySheetProps) {
	const { data: session } = useSession();
	const { updateDeploymentById } = useAppData();
	const [isDeploying, setIsDeploying] = React.useState(false);
	const [isExiting, setIsExiting] = React.useState(false);
	/** When false after open, panel is off-screen; flip to true after paint to trigger slide-in. */
	const [isEntered, setIsEntered] = React.useState(false);
	const deployKey = selectedServiceName ? `${repo.name}-${selectedServiceName}` : repo.name;
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs } = useDeployLogs(deployKey);

	React.useEffect(() => {
		if (!open) {
			setIsEntered(false);
			return;
		}
		setIsExiting(false);
		setIsEntered(false);
		const id = requestAnimationFrame(() => {
			requestAnimationFrame(() => setIsEntered(true));
		});
		return () => cancelAnimationFrame(id);
	}, [open]);

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

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			updateDeploymentById(deployConfigRef.current);
			setIsDeploying(false);
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
		}
	}, [deployStatus, deployConfigRef, updateDeploymentById]);

	const showDeployLogs = isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error";

	if (!open && !isExiting) return null;

	function handleClose() {
		if (isDeploying) return;
		setIsExiting(true);
		setTimeout(() => {
			onClose();
			setIsExiting(false);
		}, ANIMATION_MS);
	}

	async function handleSubmit(
		values: FormSchemaType &
			Partial<AIGenProjectMetadata> & {
				commitSha?: string;
				deploymentTarget?: DeployConfig["deploymentTarget"];
				deployment_target_reason?: string;
			}
	) {
		if (!session?.accessToken || !repo) return;

		let deploymentTarget = values.deploymentTarget;
		let deployment_target_reason = values.deployment_target_reason;

		// Always use EC2 for AWS deployments
		if (!deploymentTarget) {
			deploymentTarget = "ec2";
			deployment_target_reason = "Using EC2.";
		}

		const coreInfo = values.core_deployment_info;

		const serviceNameForDeploy = selectedServiceName
			? `${repo.name}-${selectedServiceName}`
			: (values.service_name || repo.name);
		const deploymentId = selectedServiceName
			? `${repo.id}-${selectedServiceName}`
			: repo.id;

		const payload: DeployConfig = {
			id: deploymentId,
			deploymentTarget,
			...(deployment_target_reason && { deployment_target_reason }),
			url: values.url,
			service_name: serviceNameForDeploy,
			...(selectedServiceName && { monorepo_service_name: selectedServiceName }),
			branch: values.branch,
			use_custom_dockerfile: values.use_custom_dockerfile,
			env_vars: values.env_vars ? parseEnvVarsToStore(values.env_vars) : "",
			status: "didnt_deploy",
			...(values.commitSha && { commitSha: values.commitSha }),
			...(values.custom_url && { custom_url: values.custom_url }),
			...(values.features_infrastructure && { features_infrastructure: values.features_infrastructure }),
			...(values.final_notes && { final_notes: values.final_notes }),
			...((values as any).monorepo_services?.length && { monorepo_services: (values as any).monorepo_services }),
			...((values as any).deployment_hints && { deployment_hints: (values as any).deployment_hints }),
			core_deployment_info: {
				language: coreInfo?.language ?? "",
				framework: coreInfo?.framework ?? "",
				install_cmd: values.install_cmd ?? coreInfo?.install_cmd ?? "",
				build_cmd: values.build_cmd ?? coreInfo?.build_cmd ?? "",
				run_cmd: values.run_cmd ?? coreInfo?.run_cmd ?? "",
				workdir: values.workdir ?? coreInfo?.workdir ?? selectedServicePath ?? null,
				...(coreInfo?.port != null && { port: coreInfo.port }),
			},
		};

		setIsDeploying(true);
		sendDeployConfig(payload, session.accessToken, session.userID);
	}

	return (
		<div className="fixed inset-0 z-50 flex" aria-hidden={!open && isExiting}>
			{/* Backdrop: click to close, fades in/out */}
			<div
				className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ease-out ${
					isExiting ? "opacity-0" : "opacity-100"
				}`}
				onClick={handleClose}
				aria-hidden
			/>
			{/* Panel: slides in from left, 75% width */}
			<div
				className="absolute left-0 top-0 bottom-0 w-[75%] h-full max-h-screen bg-background text-foreground shadow-xl flex flex-col overflow-hidden transition-[transform] duration-300 ease-out"
				style={{
					transform: isExiting ? "translateX(-100%)" : isEntered ? "translateX(0)" : "translateX(-100%)",
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="shrink-0 flex items-center justify-between gap-3 border-b border-border px-6 py-4">
					<div>
						<p className="text-xs uppercase tracking-wider text-muted-foreground">New deployment</p>
						<h2 className="text-xl font-semibold text-foreground">Configure and deploy</h2>
					</div>
					<Button variant="outline" size="icon" onClick={handleClose} disabled={isDeploying} aria-label="Close">
						<X className="size-4" />
					</Button>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4">
					<div className="rounded-xl border border-border bg-card p-4">
						<span>Repository: </span>
						<span className="font-semibold">{repo.full_name}</span>
						{selectedServiceName && (
							<>
								<span className="text-muted-foreground mx-2">/</span>
								<span className="font-semibold text-primary">@{repo.name}/{selectedServiceName}</span>
							</>
						)}
					</div>

					<div className="mt-4 rounded-xl border border-border bg-card p-4">
						<ConfigTabs
							service_name={deployKey}
							onSubmit={handleSubmit}
							onScanComplete={() => undefined}
							repo={repo}
							editMode={true}
							isDeploying={isDeploying}
							initialWorkdir={selectedServicePath ?? undefined}
						/>
					</div>

					{showDeployLogs && (
						<div className="mt-4 rounded-xl border border-border bg-card p-4">
							<DeployLogsView
								showDeployLogs={true}
								deployLogEntries={deployLogEntries}
								serviceLogs={serviceLogs}
								deployStatus={deployStatus}
								deployError={deployError}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
