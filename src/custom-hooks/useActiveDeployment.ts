import { DeployConfig, DetectedServiceInfo } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import config from "@/config";
import { getDeploymentForService } from "@/lib/utils";
import { withDeployInfraDefaults } from "@/lib/deployInfraDefaults";

function createDefaultDeployment(
	repoName: string,
	serviceName: string,
	repoUrl?: string,
	branch?: string,
	kind: DeployConfig["kind"] = "container"
): DeployConfig {
	return withDeployInfraDefaults({
		id: `draft-${repoName}-${serviceName}`,
		repoName,
		serviceName,
		url: repoUrl || "",
		branch: branch || "",
		kind,
		responseId: null,
		commitSha: null,
		envVars: null,
		liveUrl: null,
		screenshotUrl: null,
		status: "didnt_deploy",
		firstDeployment: null,
		lastDeployment: null,
		revision: null,
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		awsRegion: process.env.NEXT_PUBLIC_AWS_REGION || config.AWS_REGION || "",
		ec2: null,
		cloudRun: null,
		scanResults: {},
	});
}

export function useActiveDeployment(): DeployConfig {
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);
	const deployments = useAppData((s) => s.deployments);
	const repoServices = useAppData((s) => s.repoServices);
	const getDetectedRepoCache = useAppData((s) => s.getDetectedRepoCache);

	if (!activeRepo?.name || !activeServiceName) {
		return createDefaultDeployment("", "", "");
	}

	const found = getDeploymentForService(
		deployments,
		activeRepo.html_url,
		activeServiceName,
		activeRepo.name
	);

	if (found) return withDeployInfraDefaults(found);

	const resolveDetectedService = (services: DetectedServiceInfo[] | undefined) => {
		if (!services?.length) return null;
		if (activeServiceName === "." && services.length === 1) {
			return services[0] ?? null;
		}
		return services.find((service) => service.name === activeServiceName) ?? null;
	};

	const cachedDetection = resolveDetectedService(
		getDetectedRepoCache(activeRepo.html_url, activeRepo.default_branch)?.services
	);
	const persistedDetection =
		cachedDetection ??
		resolveDetectedService(
			repoServices.find(
				(record) =>
					record.repo_url.replace(/\.git$/, "").toLowerCase() === activeRepo.html_url.replace(/\.git$/, "").toLowerCase() &&
					(record.branch || "") === (activeRepo.default_branch || "")
			)?.services
		);
	const detectedKind = persistedDetection?.deployMode === "direct-static" ? "direct-static" : "container";

	return createDefaultDeployment(
		activeRepo.name,
		activeServiceName,
		activeRepo.html_url,
		activeRepo.default_branch,
		detectedKind
	);
}
