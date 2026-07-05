import { DeployConfig, repoType } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import config from "@/config";
import { getDeploymentForService } from "@/lib/utils";
import { withDeployInfraDefaults } from "@/lib/deployInfraDefaults";
import { hostedSubdomainOrDefault } from "@/lib/hostedUrl";

export function createDefaultDeployment(
	repoName: string,
	serviceName: string,
	repoUrl: string,
	branch: string
): DeployConfig {
	return withDeployInfraDefaults({
		id: `draft-${repoName}-${serviceName}`,
		repoName,
		serviceName,
		repoUrl: repoUrl || "",
		branch: branch || "",
		responseId: null,
		commitSha: null,
		envVars: null,
		hostedSubdomain: hostedSubdomainOrDefault(repoName, null) || null,
		screenshotUrl: null,
		activeRunId: null,
		status: "didnt_deploy",
		firstDeployment: null,
		lastDeployment: null,
		revision: null,
		cloudProvider: "aws",
		deploymentTarget: "ecs",
		region: process.env.NEXT_PUBLIC_AWS_REGION || config.AWS_REGION || "",
		cloudResources: null,
		scanResults: {},
	});
}

export function resolveActiveDeployment(args: {
	activeRepo: repoType | null;
	activeServiceName: string | null;
	deployments: DeployConfig[];
}): DeployConfig | null {
	const { activeRepo, activeServiceName, deployments } = args;
	if (!activeRepo || !activeServiceName) return null;
	const found = getDeploymentForService(
		deployments,
		activeRepo.html_url,
		activeServiceName,
		activeRepo.name
	);

	return found ? withDeployInfraDefaults(found) : null;
}

export function useActiveDeployment(): DeployConfig {
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);
	const deployments = useAppData((s) => s.deployments);

	const deployment = resolveActiveDeployment({
		activeRepo,
		activeServiceName,
		deployments,
	});

	if (!deployment) {
		throw new Error("useActiveDeployment requires an active repo, service name, and deployment");
	}

	return deployment;
}
