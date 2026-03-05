"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import type { AIGenProjectMetadata, CoreDeploymentInfo, DeployConfig, DetectedServiceInfo, repoType } from "@/app/types";
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

const DEFAULT_PORT: Record<string, number> = {
	node: 3000,
	python: 8000,
	go: 8080,
	java: 8080,
	rust: 8080,
	dotnet: 5000,
	php: 8000,
};

function nonEmpty(value: string | null | undefined): string | undefined {
	if (value == null) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function fallbackCoreDeploymentInfo(selectedService?: DetectedServiceInfo): CoreDeploymentInfo {
	const language = (selectedService?.language || "node").toLowerCase();
	const framework = selectedService?.framework ?? "";
	const workdir = nonEmpty(selectedService?.path) ?? ".";

	if (language === "python") {
		return {
			language: "python",
			framework,
			install_cmd: "pip install -r requirements.txt",
			build_cmd: "",
			run_cmd: "python main.py",
			workdir,
			port: DEFAULT_PORT.python,
		};
	}

	if (language === "go") {
		return {
			language: "go",
			framework,
			install_cmd: "go mod download",
			build_cmd: "go build -o app .",
			run_cmd: "./app",
			workdir,
			port: DEFAULT_PORT.go,
		};
	}

	if (language === "java") {
		return {
			language: "java",
			framework,
			install_cmd: "mvn dependency:go-offline -B",
			build_cmd: "mvn package -DskipTests -B",
			run_cmd: "java -jar target/*.jar",
			workdir,
			port: DEFAULT_PORT.java,
		};
	}

	if (language === "rust") {
		return {
			language: "rust",
			framework,
			install_cmd: "cargo fetch",
			build_cmd: "cargo build --release",
			run_cmd: "./target/release/app",
			workdir,
			port: DEFAULT_PORT.rust,
		};
	}

	if (language === "dotnet") {
		return {
			language: "dotnet",
			framework,
			install_cmd: "dotnet restore",
			build_cmd: "dotnet publish -c Release -o out",
			run_cmd: "dotnet out/app.dll",
			workdir,
			port: DEFAULT_PORT.dotnet,
		};
	}

	if (language === "php") {
		return {
			language: "php",
			framework,
			install_cmd: "composer install --no-dev --optimize-autoloader",
			build_cmd: "",
			run_cmd: "php -S 0.0.0.0:8000 -t public",
			workdir,
			port: DEFAULT_PORT.php,
		};
	}

	return {
		language: language || "node",
		framework,
		install_cmd: "npm install",
		build_cmd: "npm run build || true",
		run_cmd: "npm start",
		workdir,
		port: DEFAULT_PORT.node,
	};
}

export default function NewDeploySheet({ open, onClose, repo, selectedService }: NewDeploySheetProps) {
	const { data: session } = useSession();
	const { updateDeploymentById, deployments } = useAppData();
	const [isDeploying, setIsDeploying] = React.useState(false);
	const prefilledCoreInfo = React.useMemo(
		() => selectedService?.core_deployment_info ?? fallbackCoreDeploymentInfo(selectedService),
		[selectedService]
	);
	const prefilledServiceName = React.useMemo(
		() => (selectedService ? selectedService.name : "."),
		[selectedService]
	);

	const existingDeployment = React.useMemo(() => {
		return deployments.find(
			(d) => d.repo_id === repo.id.toString() && d.service_name === prefilledServiceName
		);
	}, [deployments, repo.id, prefilledServiceName]);

	const prefilledDeployment = React.useMemo<DeployConfig | undefined>(() => {
		if (!selectedService) return undefined;
		return {
			id: existingDeployment?.id || crypto.randomUUID(),
			repo_id: repo.id.toString(),
			url: repo.html_url,
			branch: repo.default_branch || repo.branches?.[0]?.name || "main",
			use_custom_dockerfile: false,
			service_name: prefilledServiceName,
			core_deployment_info: prefilledCoreInfo,
		};
	}, [prefilledCoreInfo, prefilledServiceName, repo.html_url, repo.id, selectedService, existingDeployment?.id]);
	const { sendDeployConfig, deployConfigRef, deployStatus, deployError, serviceLogs, deployLogEntries } = useDeployLogs(prefilledServiceName);

	React.useEffect(() => {
		if (deployStatus === "success" && deployConfigRef.current) {
			updateDeploymentById(deployConfigRef.current);
			setIsDeploying(false);

			const url = deployConfigRef.current.custom_url || deployConfigRef.current.deployUrl;
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
	}, [deployStatus, deployConfigRef, updateDeploymentById, onClose]);

	if (!open) return null;


	const showDeployLogs = isDeploying || deployStatus === "running" || deployStatus === "success" || deployStatus === "error";

	function handleClose() {
		if (isDeploying) return;
		onClose();
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

		const ruleBasedCoreInfo = prefilledCoreInfo;
		const coreInfo = values.core_deployment_info;
		const effectiveCoreInfo: CoreDeploymentInfo = {
			language: nonEmpty(coreInfo?.language) ?? ruleBasedCoreInfo.language,
			framework: nonEmpty(coreInfo?.framework) ?? ruleBasedCoreInfo.framework,
			install_cmd: nonEmpty(values.install_cmd) ?? nonEmpty(coreInfo?.install_cmd) ?? ruleBasedCoreInfo.install_cmd,
			build_cmd: nonEmpty(values.build_cmd) ?? nonEmpty(coreInfo?.build_cmd) ?? ruleBasedCoreInfo.build_cmd,
			run_cmd: nonEmpty(values.run_cmd) ?? nonEmpty(coreInfo?.run_cmd) ?? ruleBasedCoreInfo.run_cmd,
			workdir: nonEmpty(values.workdir) ?? nonEmpty(coreInfo?.workdir ?? undefined) ?? ruleBasedCoreInfo.workdir,
			...(coreInfo?.port != null ? { port: coreInfo.port } : ruleBasedCoreInfo.port != null ? { port: ruleBasedCoreInfo.port } : {}),
		};

		const payload: DeployConfig = {
			id: existingDeployment?.id || crypto.randomUUID(),
			repo_id: repo.id.toString(),
			deploymentTarget,
			...(deployment_target_reason && { deployment_target_reason }),
			url: values.url,
			service_name: values.service_name,
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
			core_deployment_info: effectiveCoreInfo,
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
							service_name={prefilledServiceName}
							onSubmit={handleSubmit}
							onScanComplete={() => undefined}
							repo={repo}
							deployment={prefilledDeployment}
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
