"use client";

import * as React from "react";
import { X, Rocket } from "lucide-react";
import { useSession } from "next-auth/react";
import type { AIGenProjectMetadata, DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";
import { Button } from "@/components/ui/button";
import ConfigTabs, { FormSchemaType } from "@/components/ConfigTabs";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { toast } from "sonner";

type NewDeploySheetProps = {
	open: boolean;
	onClose: () => void;
	repo: repoType;
	selectedService?: DetectedServiceInfo;
};

export default function NewDeploySheet({ open, onClose, repo, selectedService }: NewDeploySheetProps) {
	const { data: session } = useSession();
	const { updateDeploymentById, deployments } = useAppData();

	const prefilledServiceName = React.useMemo(
		() => (selectedService ? selectedService.name : "."),
		[selectedService]
	);
	const { sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } = useDeployLogs(prefilledServiceName);


	const existingDeployment = React.useMemo(() => {
		return deployments.find(
			(d) => d.repo_name === repo.name && d.service_name === prefilledServiceName
		);
	}, [deployments, repo.name, prefilledServiceName]);

	const [isDeploying, setIsDeploying] = React.useState(false);
	const [deployment, setDeployment] = React.useState<DeployConfig>(existingDeployment ?? {
		id: crypto.randomUUID(),
		repo_name: repo.name,
		url: repo.html_url,
		service_name: prefilledServiceName,
		branch: repo.default_branch,
		status: "didnt_deploy"
	});


	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			updateDeploymentById(deployConfigRef.current);
			setIsDeploying(false);

			const url = deployConfigRef.current.custom_url ?? deployConfigRef.current.deployUrl;
			if (url) {
				const fullUrl = url.startsWith("http") ? url : `https://${url}`;
				toast.success("Deployment completed successfully!", {
					description: `Your application is now live.`,
					action: {
						label: "Open App",
						onClick: () => window.open(fullUrl, "_blank", "noopener,noreferrer"),
					},
					duration: 10000,
				});
			} else {
				toast.success("Deployment completed successfully!");
			}
			onClose();
		}
		if (deployStatus === "error") {
			setIsDeploying(false);
		}
	}, [deployStatus, deployConfigRef]);

	const showDeployLogs = isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error";

	function handleClose() {
		if (isDeploying) return;
		onClose();
	}

	async function handleSubmit(
		values: FormSchemaType &
			Partial<AIGenProjectMetadata> & {
				commitSha?: string;
			}
	) {
		if (!session?.accessToken) return;

		const payload: DeployConfig = {
			...deployment,
			...values,
			env_vars: values.env_vars ? parseEnvVarsToStore(values.env_vars) : "",
		};

		setDeployment(payload);
		setIsDeploying(true);
		sendDeployConfig(payload, session.accessToken, (session as any).userID);
	}

	return (
		<div className="fixed inset-0 z-50">
			<div className="absolute inset-0 bg-black/50" onClick={handleClose} />
			<div className="absolute inset-0 bg-background text-foreground overflow-y-auto">
				<div className="mx-auto w-full max-w-4xl px-6 py-10">
					<div className="flex items-center justify-between gap-3 border-b border-border/50 pb-4 mb-6">
						<div className="flex items-center gap-2">
							<div className="bg-primary/20 p-1.5 rounded-md">
								<Rocket className="size-4 text-primary" />
							</div>
							<h2 className="text-base font-semibold text-foreground">Deploy Sheet</h2>
						</div>
						<Button variant="ghost" size="icon" onClick={handleClose} disabled={isDeploying} className="h-8 w-8 bg-card border border-border/50">
							<X className="size-4" />
						</Button>
					</div>

					<div className="mb-6">
						<h1 className="text-3xl font-bold tracking-tight text-foreground mb-1">Setup Project</h1>
						<p className="text-primary/80">Configure your deployment environment to begin.</p>
					</div>
					<ConfigTabs
						onSubmit={handleSubmit}
						onConfigChange={(partial) => {
							updateDeploymentById({ ...deployment, ...partial });
							setDeployment({ ...deployment, ...partial });
						}}
						branches={repo.branches.length > 0 ? repo.branches.map((b) => b.name) : ["main"]}
						deployment={deployment}
						repoFullName={repo.full_name}
					/>

					{showDeployLogs && (
						<div className="mt-8 rounded-2xl border border-white/5 bg-white/[0.02] p-6 shadow-2xl">
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
