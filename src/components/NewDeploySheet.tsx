"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import type { DeployConfig, repoType } from "@/app/types";
import { Button } from "@/components/ui/button";
import ConfigTabs, { FormSchemaType } from "@/components/ConfigTabs";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";

type NewDeploySheetProps = {
	open: boolean;
	onClose: () => void;
	repo: repoType;
};

export default function NewDeploySheet({ open, onClose, repo }: NewDeploySheetProps) {
	const { data: session } = useSession();
	const { updateDeploymentById } = useAppData();
	const [isDeploying, setIsDeploying] = React.useState(false);
	const { steps, sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs } = useDeployLogs(repo.name);

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

	if (!open) return null;


	const showDeployLogs = isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error";

	function handleClose() {
		if (isDeploying) return;
		onClose();
	}

	async function handleSubmit(values: FormSchemaType & { commitSha?: string }) {
		if (!session?.accessToken || !repo) return;

		const payload: DeployConfig = {
			id: repo.id,
			url: values.url,
			service_name: values.service_name,
			branch: values.branch,
			use_custom_dockerfile: values.use_custom_dockerfile,
			env_vars: values.env_vars ? parseEnvVarsToStore(values.env_vars) : "",
			status: "didnt_deploy",
			...(values.commitSha && { commitSha: values.commitSha }),
			...(values.custom_url && { custom_url: values.custom_url }),
			core_deployment_info: {
				language: "",
				framework: "",
				install_cmd: values.install_cmd ?? "",
				build_cmd: values.build_cmd ?? "",
				run_cmd: values.run_cmd ?? "",
				workdir: values.workdir ?? null,
			},
		};

		setIsDeploying(true);
		sendDeployConfig(payload, session.accessToken, session.userID);
	}

	return (
		<div className="fixed inset-0 z-50">
			<div className="absolute inset-0 bg-black/50" onClick={handleClose} />
			<div className="absolute inset-0 bg-background text-foreground overflow-y-auto">
				<div className="mx-auto w-full max-w-6xl px-6 py-6">
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-xs uppercase tracking-wider text-muted-foreground">New deployment</p>
							<h2 className="text-2xl font-semibold text-foreground">Configure and deploy</h2>
						</div>
						<Button variant="outline" onClick={handleClose} disabled={isDeploying}>
							<X className="size-4" />
						</Button>
					</div>

					<div className="mt-6 rounded-xl border border-border bg-card p-4">
						<span>Repository Name: </span>
						<span className="font-semibold">{repo.name}</span>
					</div>

					<div className="mt-6 rounded-xl border border-border bg-card p-4">
						<ConfigTabs
							service_name={repo.name}
							onSubmit={handleSubmit}
							onScanComplete={() => undefined}
							repo={repo}
							editMode={true}
							isDeploying={isDeploying}
						/>
					</div>

					{showDeployLogs && (
						<div className="mt-6 rounded-xl border border-border bg-card p-4">
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
